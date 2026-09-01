import fs from 'fs-extra'
import { cloneDeep, throttle } from 'lodash-es'

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

  set(key, value) {
    try {
      value = JSON.parse(JSON.stringify(value))
      this.data[key] = value
      this.save()
    } catch (err) {
      console.error(err)
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
    const tmp = this.#tmpName()
    try {
      await fs.writeJson(tmp, this.data)
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
      const tmp = this.#tmpName()
      fs.writeJsonSync(tmp, this.data)
      fs.renameSync(tmp, this.file)
    } catch (err) {
      console.error('[storage] flush on shutdown failed:', err.message)
    }
  }
}
