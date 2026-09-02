import fs from 'fs-extra'
import { throttle } from 'lodash-es'

/*
 * The world's save file.
 *
 * Everything a player earns lives here — the fishing ledger, CashCoin, the
 * Chibi Rating and what is on their shelf, house condition. Three things were
 * wrong with how it reached disk, and a deploy restarts this process four
 * times, so they were not theoretical.
 *
 *   Nothing flushed on shutdown. Writes are throttled with a trailing edge,
 *   so the last second of play sat in a pending timer that SIGTERM discarded.
 *
 *   Writes were not atomic. writeJson opens the real file and truncates it,
 *   so a process killed mid-write leaves a half-written save — and the reader
 *   below used to treat unparseable as empty, which turns one bad shutdown
 *   into a wiped world.
 *
 *   A failed read was silently an empty book. Any error at all — a permission
 *   problem, a truncated file, a disk fault — produced {} with no message, and
 *   the next set() wrote that emptiness over the top. The one case that really
 *   is empty is "the file does not exist yet", and that is the only one now
 *   allowed through.
 */
export class Storage {
  #seq = 0
  #closed = false

  constructor(file) {
    this.file = file
    try {
      this.data = fs.readJsonSync(this.file)
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.data = {}            // first boot: genuinely nothing saved yet
      } else {
        // Refuse to start rather than overwrite a save we could not read.
        console.error(`[storage] cannot read ${this.file}:`, err.message)
        console.error('[storage] refusing to start on top of an unreadable save.')
        throw err
      }
    }
    this.save = throttle(() => this.persist(), 1000, { leading: true, trailing: true })
  }

  get(key) {
    return this.data[key]
  }

  /*
   * Store the reference. Do NOT deep-clone here.
   *
   * This used to be `JSON.parse(JSON.stringify(value))` on every call, which
   * is O(everything ever saved under that key) per player action. Every app
   * here keeps one book of all players and re-sets the whole thing after each
   * change, so one cat catching one fish cloned the entire fishing ledger,
   * twice, synchronously, on the server's only busy thread. At the 37 players
   * on the box today that is 8KB and free. At ten thousand it is 2.2MB a
   * catch, and twenty people fishing stalls the world.
   *
   * The clone was there to stop later mutation of the caller's object leaking
   * into the save. It never bought that: the caller holds the same book and
   * mutates it again a moment later anyway, so the snapshot was stale before
   * it was written. Persisting what the object looks like at write time is
   * both cheaper and more current.
   *
   * The other thing the round-trip did was fail loudly on an unserialisable
   * value. persist() below does that instead, per key, so one bad key cannot
   * take every other key's save down with it.
   */
  set(key, value) {
    this.data[key] = value
    this.save()
  }

  /*
   * The save file as text, or null if it cannot be made.
   *
   * A cycle or a BigInt anywhere in the data made writeJson throw, which read
   * as "failed to persist storage" once a second forever while every player's
   * progress quietly stopped reaching disk. Now the bad key is named and
   * dropped from that write, and everything else still saves.
   */
  #serialize() {
    try {
      return JSON.stringify(this.data)
    } catch (err) {
      const safe = {}
      for (const key in this.data) {
        try {
          JSON.stringify(this.data[key])
          safe[key] = this.data[key]
        } catch (e) {
          console.error(`[storage] key "${key}" cannot be saved: ${e.message}`)
        }
      }
      try {
        return JSON.stringify(safe)
      } catch (e) {
        console.error('[storage] nothing could be serialised:', e.message)
        return null
      }
    }
  }

  /*
   * Every write gets its own temp name.
   *
   * A single `${file}.tmp` looks fine until two writes overlap, which they do:
   * set() fires persist() on the throttle's leading edge and flush() writes
   * synchronously on the way out, so a shutdown lands mid-persist and whichever
   * renames second finds its tmp already moved. Harmless to the save — the data
   * is identical — but it throws ENOENT and logs "failed to persist storage" on
   * every clean shutdown, which is a false alarm about the one thing here you
   * would want to be able to trust.
   */
  #tmpName() {
    return `${this.file}.${process.pid}.${this.#seq++}.tmp`
  }

  async persist() {
    // Write beside the target and rename onto it. rename is atomic within a
    // filesystem, so a reader either sees the whole old file or the whole new
    // one — never the half-written middle.
    if (this.#closed) return
    const text = this.#serialize()
    if (text === null) return
    const tmp = this.#tmpName()
    try {
      await fs.writeFile(tmp, text)
      // Checked again after the await, not just before it. flush() can land
      // while this write is in flight, and then this rename would drop an
      // older snapshot on top of the newer one flush just wrote — losing
      // exactly the last writes that flush exists to save. Measured: set a,
      // set b, flush, and the file came back holding only a.
      if (this.#closed) return fs.remove(tmp).catch(() => {})
      await fs.rename(tmp, this.file)
    } catch (err) {
      console.error(err)
      console.log('failed to persist storage')
      try { await fs.remove(tmp) } catch {}
    }
  }

  /*
   * Called on the way out. Cancels the pending throttle so it cannot fire
   * against a half-dead process, then writes synchronously — the event loop is
   * about to stop, so an await here would simply not finish.
   */
  flush() {
    try {
      this.#closed = true
      this.save.cancel()
      const text = this.#serialize()
      if (text === null) return
      const tmp = this.#tmpName()
      fs.writeFileSync(tmp, text)
      fs.renameSync(tmp, this.file)
    } catch (err) {
      console.error('[storage] flush on shutdown failed:', err.message)
    }
  }
}
