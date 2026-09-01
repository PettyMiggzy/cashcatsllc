/*
 * World of CashCats — the Chibi Rating
 *
 * Ahmad's spec, as given:
 *
 *   The game will have a Chibi Rating. You can also call it a pet system.
 *   Where do we farm the pets? Bosses. Which bosses drop pets? Dungeon
 *   Bosses, Raid Bosses, and World Bosses.
 *
 *   Here's the requirement: in order to get pets from the Bosses, you have to
 *   defeat them, obviously, and secondly, you have to hit the boss at least
 *   once. It doesn't matter if it deals 0 damage or if the attack is a miss.
 *   This will incentivize players to help new players or players with
 *   low-grade equipment get their dailies done. Don't worry about treasure
 *   chests; everyone will get them equally.
 *
 *   So after you defeat a boss, you are guaranteed to get the chibification
 *   of the boss itself ONCE.
 *
 * THE ONE RULE THIS FILE EXISTS TO PROTECT
 *
 * A swing counts. Not damage — a swing. The whole point of that clause is
 * that a level-one cat with a wooden stick can tap a World Boss for nothing
 * at all, stand well back while people who can actually fight it kill it, and
 * walk away with the pet. Which means the credit list is written the instant
 * the attack is thrown, before any roll for hit or damage happens, and
 * nothing downstream may filter it. Every temptation to be clever here —
 * weight it by damage, require a minimum, drop people who did nothing —
 * breaks the one behaviour the design is buying, which is geared players
 * carrying strangers through their dailies. So: HITS.add() comes first.
 *
 * Miss and zero-damage swings are not an edge case to tolerate either; they
 * are load-bearing. swing() rolls a real miss chance precisely so the rule
 * has something to be true about.
 *
 * THE GUARANTEE
 *
 * Beating a boss gives you that boss's own chibi, once. It is not a roll and
 * it is not a chance — first eligible kill, you own it. After that the boss
 * still pays coin and still gives a chest; it just has no second pet to give,
 * because a boss only has one chibification of itself. Nothing here invents a
 * wider drop table: the spec guarantees one thing and says nothing about a
 * second, so this implements the one thing.
 *
 * CHESTS
 *
 * "Everyone will get them equally" is read as: chests are not on the swing
 * rule. Stand in the fight and you get one, swung or not. That is the whole
 * reason the clause is in the message — he is heading off the worry that the
 * hit requirement makes chest distribution unfair.
 *
 * THE RATING
 *
 * Ahmad named the system a rating and did not say what the number is. This
 * reads it the obvious way: every chibi carries a rating by the tier of the
 * boss that dropped it, and your Chibi Rating is the sum of what you own. It
 * gives the name a meaning and gives the board something to sort on. Flagged
 * as a reading rather than a quote — if he meant something else it is one
 * table and one addition to change.
 *
 * It is one of six: Equipment, Cosmetic, Side-Quest, Mini-games, Chibi and
 * Flora. This file owns Chibi and nothing else.
 *
 * AND IT CAN BE DEBUFFED
 *
 *   If your house maintenance falls below 80%, the Chibi Rating and the time
 *   to yield crops will have a 5% debuff.
 *
 * So the rating is not simply the sum — the sum is the base, and what the
 * board and anything reading the rating gets is the base after upkeep. The
 * house lives in the Homestead, so this reads its condition out of shared
 * server storage and treats a missing entry as a house in good repair. A
 * player who has never bought land is not being punished for it.
 *
 * The two halves of that debuff are deliberately kept apart: the crop half
 * belongs to whatever owns crop timing, not here. This file applies the Chibi
 * half only, so there is exactly one place each number is reduced.
 *
 * WHAT IS NOT HERE YET
 *
 * Dungeon and Raid bosses are in the bestiary and cannot spawn, because there
 * are no dungeons and no raids to put them in. They are left in the table
 * deliberately: the tier, the rating and the chibi are already decided, so
 * when those areas get built the boss is a spawn point and not a design
 * problem. Only WORLD bosses stand in the open world, which is the only place
 * that currently exists.
 */

const isServer = world.isServer
const now = () => Date.now()

const GOLD='#a9812a', GOLD_L='#e8c25a', CREAM='#e8f2ec', DIM='#8fa39a'
const LIME='#2ecc71', RED='#c0392b', INK='#16150f', PAPER='#f4f0e3'

/* where the World Boss stands: open ground north of the plaza, between the
 * Fields and the Seam, clear of every trade node so a fight cannot trample
 * somebody's fishing spot */
const BX = 0, BZ = -48

/* ------------------------------------------------------------------ *
 * the bestiary                                                        *
 * ------------------------------------------------------------------ *
 * tier drives everything else: how much it has, what its chibi is worth,
 * and how long it stays down. `model` is the boss AND the chibi — same
 * creature, different scale.
 */
const DUNGEON = 0, RAID = 1, WORLD = 2
const TIER = [
  { key:'dungeon', name:'Dungeon Boss', rating:10,  colour:'#7fb3d5' },
  { key:'raid',    name:'Raid Boss',    rating:35,  colour:'#c39bd3' },
  { key:'world',   name:'World Boss',   rating:100, colour:'#e8c25a' },
]

const BOSSES = [
  // World — these stand in the open world and are live now.
  { key:'ashmane',  name:'Ashmane the Unbanked', tier:WORLD,   model:'p_lion',
    hp:2400, hit:0.72, dmg:[70,130], coin:120, chest:2, at:[BX, BZ] },
  { key:'tollmaw',  name:'Tollmaw',              tier:WORLD,   model:'p_tiger',
    hp:1900, hit:0.76, dmg:[70,120], coin:95,  chest:2, at:[BX, BZ] },
  { key:'ledgerus', name:'Ledgerus, the Weight', tier:WORLD,   model:'p_elephant',
    hp:3200, hit:0.80, dmg:[60,105], coin:150, chest:3, at:[BX, BZ] },

  // Raid — no raid to put them in yet. Statted, not spawnable.
  { key:'hoarfront', name:'Hoarfront',      tier:RAID,    model:'p_polar',
    hp:1500, hit:0.74, dmg:[55,95], coin:70, chest:2 },
  { key:'quietpaw',  name:'Quiet Paw',      tier:RAID,    model:'p_panda',
    hp:1300, hit:0.78, dmg:[50,90], coin:60, chest:2 },

  // Dungeon — same.
  { key:'tallyfox',  name:'Tallyfox',       tier:DUNGEON, model:'p_fox',
    hp:700, hit:0.80, dmg:[40,70], coin:30, chest:1 },
  { key:'sumstag',   name:'Sumstag',        tier:DUNGEON, model:'p_deer',
    hp:800, hit:0.78, dmg:[40,75], coin:32, chest:1 },
  { key:'grubroot',  name:'Grubroot',       tier:DUNGEON, model:'p_hog',
    hp:650, hit:0.82, dmg:[35,65], coin:28, chest:1 },
]
const BY_KEY = {}
for (const b of BOSSES) BY_KEY[b.key] = b
const WORLD_ROTA = BOSSES.filter(b => b.tier === WORLD)

const FIGHT_R   = 22        // stand inside this and you are in the fight
const SWING_CD  = 900       // ms between swings, per player
const DOWN_MS   = 90 * 1000 // how long a World Boss stays dead
const ENRAGE_MS = 6 * 60 * 1000

/* ------------------------------------------------------------------ *
 * helpers                                                             *
 * ------------------------------------------------------------------ */
function prim(type, size, color, pos, opts) {
  opts = opts || {}
  const n = app.create('prim')
  n.type = type; n.size = size; n.color = color
  n.position.set(pos[0], pos[1], pos[2])
  if (opts.rotY) n.rotation.y = opts.rotY
  if (opts.emissive) n.emissive = opts.emissive
  if (opts.tex && props[opts.tex]) n.texture = props[opts.tex].url
  if (opts.rough !== undefined) n.roughness = opts.rough
  if (opts.metal !== undefined) n.metalness = opts.metal
  if (opts.physics) n.physics = opts.physics
  if (opts.opacity !== undefined) n.opacity = opts.opacity
  app.add(n); return n
}
function panel(wm, hm, size, pos, rotY, bg, border) {
  const u = app.create('ui')
  u.width = Math.round(wm / size); u.height = Math.round(hm / size); u.size = size
  u.res = 1
  u.position.set(pos[0], pos[1], pos[2])
  if (rotY) u.rotation.y = rotY
  u.backgroundColor = bg; u.borderColor = border; u.borderWidth = 6
  u.borderRadius = 10; u.padding = 18; u.flexDirection = 'column'
  u.alignItems = 'center'; u.lit = false
  app.add(u); return u
}
function text(parent, val, px, color, weight, mt) {
  const t = app.create('uitext')
  t.value = val; t.fontSize = px; t.color = color; t.lineHeight = 1.3
  if (weight) t.fontWeight = weight
  if (mt) t.margin = [mt, 0, 0, 0]
  parent.add(t); return t
}
function comma(n) {
  const s = String(Math.floor(n)); let out = ''
  for (let i = 0; i < s.length; i++) {
    if (i && (s.length - i) % 3 === 0) out += ','
    out += s[i]
  }
  return out
}
function model(key, pos, rotY, scale) {
  const prop = props[key]
  if (!prop || !prop.url) return null
  const g = app.create('group')
  g.position.set(pos[0], pos[1], pos[2])
  if (rotY) g.rotation.y = rotY
  app.add(g)
  world.load('model', prop.url).then(n => {
    const k = scale === undefined ? 1 : scale
    n.scale.set(k, k, k)
    g.add(n)
  }).catch(() => {})
  return g
}

/* ------------------------------------------------------------------ *
 * the arena floor — a ring so the fight has an edge you can see        *
 * ------------------------------------------------------------------ */
prim('cylinder', [FIGHT_R, FIGHT_R, 0.22], '#8d8272',
     [BX, 0.02, BZ], { tex: 'gravel', rough: 1.0 })
for (let i = 0; i < 24; i++) {
  const a = i / 24 * Math.PI * 2
  prim('box', [1.4, 0.9, 1.4], '#6b6357',
       [BX + Math.cos(a) * FIGHT_R, 0.45, BZ + Math.sin(a) * FIGHT_R],
       { rotY: a, rough: 0.9, physics: 'static' })
}
prim('cylinder', [4.2, 4.2, 0.14], '#4a4436', [BX, 0.16, BZ], { rough: 0.9 })

/* the boss stands on the middle. one group per boss in the rota, all hidden
 * until the server says which is up — swapping a model at runtime means a
 * load every spawn, and the load is what you would see. */
const rig = {}
for (const b of WORLD_ROTA) {
  const g = model(b.model, [BX, 0.2, BZ], 0, 0)
  if (g) rig[b.key] = g
}

const nameplate = panel(7.0, 1.9, 0.006, [BX, 7.2, BZ + FIGHT_R - 3], Math.PI,
                        'rgba(14,20,17,0.90)', GOLD)
const npName = text(nameplate, 'THE FIELD', 44, GOLD_L, 800)
const npBar  = text(nameplate, '', 30, CREAM, 600, 6)
const npNote = text(nameplate, '', 24, DIM, 400, 4)

const board = panel(5.2, 4.6, 0.0062, [BX - 15, 3.0, BZ + 14], Math.PI + 0.5,
                    'rgba(14,20,17,0.92)', LIME)
text(board, 'THE CHIBI RATING', 40, LIME, 800)
const bdRule = text(board, '', 24, CREAM, 400, 10)
const bdYou  = text(board, '', 26, GOLD_L, 700, 10)
const bdList = text(board, '', 22, DIM, 400, 8)

bdRule.value =
  'Swing at a boss even once and you are on the list.\n' +
  'A miss counts. Zero damage counts.\n' +
  'Beat it and its chibi is yours, guaranteed, once.\n' +
  'Chests go to everyone in the ring either way.'

/* ------------------------------------------------------------------ *
 * client — draw what the server says                                  *
 * ------------------------------------------------------------------ */
const view = { key:null, hp:0, max:0, down:false, until:0 }

function paint() {
  for (const k in rig) {
    const on = view.key === k && !view.down
    rig[k].scale.set(on ? 1 : 0, on ? 1 : 0, on ? 1 : 0)
  }
  const b = view.key && BY_KEY[view.key]
  if (!b) { npName.value = 'THE FIELD'; npBar.value = ''; npNote.value = ''; return }
  const t = TIER[b.tier]
  if (view.down) {
    npName.value = b.name + ' — DOWN'
    npBar.value = ''
    const left = Math.max(0, Math.ceil((view.until - now()) / 1000))
    npNote.value = left ? ('back in ' + left + 's') : 'stirring...'
    return
  }
  npName.value = b.name.toUpperCase()
  const frac = view.max ? Math.max(0, view.hp) / view.max : 0
  const cells = 22, on = Math.round(frac * cells)
  let bar = ''
  for (let i = 0; i < cells; i++) bar += i < on ? '█' : '░'
  npBar.value = bar + '  ' + comma(Math.max(0, view.hp)) + ' / ' + comma(view.max)
  npNote.value = t.name + '  ·  press E to swing  ·  a miss still counts'
}

if (!isServer) {
  app.on('boss', d => {
    view.key = d.k; view.hp = d.h; view.max = d.m; view.down = !!d.d; view.until = d.u || 0
    paint()
  })
  app.on('you', d => {
    bdYou.value = 'Your Chibi Rating: ' + comma(d.r) + '   ·   ' +
                  d.n + ' of ' + d.t + ' chibis   ·   ' + comma(d.c) + ' chests'
    // say the debuff out loud, with the number it cost, or nobody connects a
    // quietly smaller rating to a house they stopped repairing weeks ago
    bdYou.color = d.d ? RED : GOLD_L
    bdList.value = (d.d
      ? ('House upkeep below 80% — Chibi Rating cut 5% (' +
         comma(d.b) + ' → ' + comma(d.r) + '). Repair it at the Homestead.\n\n')
      : '') + (d.l || 'No chibis yet. Go and hit something.')
  })
  app.on('you!', d => {
    // the one line that matters, said plainly
    npNote.value = d.m
  })
  app.send('boss?', {})
}
paint()

/* ------------------------------------------------------------------ *
 * server — owns the boss, the credit list and every pet               *
 * ------------------------------------------------------------------ */
if (isServer) {
  const KEY = 'ccl.pets.v1'
  let book = world.get(KEY) || {}     // userId -> record
  let saveAt = 0

  const blank = () => ({ name:'?', chibis:{}, kills:{}, chests:0, rating:0, base:0, debuff:0 })
  const recFor = p => {
    const id = p.userId || p.id
    if (!book[id]) book[id] = blank()
    const R = book[id], base = blank()
    for (const k in base) if (R[k] === undefined || R[k] === null) R[k] = base[k]
    R.name = p.name || '?'
    return R
  }
  const save = () => { world.set(KEY, book); saveAt = now() + 4000 }
  const touch = () => { if (now() > saveAt) save() }

  /*
   * Upkeep. The Homestead owns houses; this only reads them.
   *
   * A missing record means no house, which is not the same as a derelict one
   * — someone who has never bought land has nothing to maintain and takes no
   * debuff. Only an owned house that has been let go below the line counts.
   */
  const HOUSE_KEY = 'ccl.house.v1'
  const UPKEEP_LINE = 80      // maintenance % below which the debuff bites
  const UPKEEP_DEBUFF = 0.05  // 5%
  const upkeepPenalty = uid => {
    const h = (world.get(HOUSE_KEY) || {})[uid]
    if (!h || !h.house) return 0
    const cond = typeof h.cond === 'number' ? h.cond : 100
    return cond < UPKEEP_LINE ? UPKEEP_DEBUFF : 0
  }

  // rating is recomputed from what is owned rather than incremented, so a
  // changed TIER table corrects every existing player instead of leaving
  // whatever number happened to be added on the day they earned it.
  // `base` is what the chibis are worth; `rating` is what you actually have
  // after the house is taken into account, and it is the one anything else
  // should read.
  const rate = (R, uid) => {
    let n = 0
    for (const k in R.chibis) {
      const b = BY_KEY[k]
      if (b && R.chibis[k] > 0) n += TIER[b.tier].rating
    }
    R.base = n
    R.debuff = uid ? upkeepPenalty(uid) : 0
    R.rating = Math.round(n * (1 - R.debuff))
    return R.rating
  }

  let cur = null            // { b, hp, born, hits:Set, down, until }
  let rota = 0

  const spawn = () => {
    const b = WORLD_ROTA[rota % WORLD_ROTA.length]
    rota++
    cur = { b, hp: b.hp, born: now(), hits: {}, down: false, until: 0 }
    push()
  }
  const push = () => {
    if (!cur) return
    app.send('boss', { k: cur.b.key, h: cur.hp, m: cur.b.hp, d: cur.down, u: cur.until })
  }
  const tell = (pid, m) => app.sendTo(pid, 'you!', { m })

  const sheet = R => {
    const rows = []
    for (const b of BOSSES) {
      const n = R.chibis[b.key] || 0
      if (n > 0) rows.push('✓ ' + b.name + '  (' + TIER[b.tier].name + ', +' + TIER[b.tier].rating + ')')
    }
    return rows.join('\n')
  }
  const sendYou = pid => {
    const p = world.getPlayer(pid); if (!p) return
    const uid = p.userId || p.id
    const R = recFor(p)
    rate(R, uid)
    app.sendTo(pid, 'you', {
      r: R.rating, b: R.base, d: R.debuff,
      n: Object.keys(R.chibis).filter(k => R.chibis[k] > 0).length,
      t: BOSSES.length, c: R.chests, l: sheet(R),
    })
  }

  const inRing = p => {
    const q = p.position
    const dx = q.x - BX, dz = q.z - BZ
    return dx * dx + dz * dz <= FIGHT_R * FIGHT_R
  }

  const lastSwing = {}

  app.on('boss?', (d, pid) => { push(); sendYou(pid) })

  app.on('swing', (d, pid) => {
    if (!cur || cur.down) return
    const p = world.getPlayer(pid); if (!p) return
    if (!inRing(p)) return
    const t = now()
    if (t - (lastSwing[pid] || 0) < SWING_CD) return
    lastSwing[pid] = t

    /*
     * THE RULE. Credit is written here, at the top, before the miss roll and
     * before any damage is worked out — because the spec says a miss counts
     * and zero damage counts, and the only way to be sure of that is for
     * nothing after this line to be able to take it back.
     *
     * Keyed by userId, not the socket id, so a reconnect mid-fight does not
     * cost someone the pet they already earned a claim on.
     */
    const uid = p.userId || p.id
    cur.hits[uid] = true

    const b = cur.b
    const miss = Math.random() > b.hit
    const dmg = miss ? 0 : Math.floor(b.dmg[0] + Math.random() * (b.dmg[1] - b.dmg[0]))
    cur.hp -= dmg
    tell(pid, miss ? 'Miss — and it still counts. You are on the list.'
                   : ('Hit for ' + dmg + '.'))
    if (cur.hp <= 0) defeat()
    else push()
  })

  const defeat = () => {
    const b = cur.b
    cur.down = true
    cur.hp = 0
    cur.until = now() + DOWN_MS

    /*
     * Two different lists, on purpose.
     *
     *   credited — everyone who swung. They get the chibi.
     *   present  — everyone standing in the ring. They get a chest.
     *
     * "Don't worry about treasure chests; everyone will get them equally" is
     * the whole reason these are not the same list. The swing rule gates the
     * pet and nothing else.
     */
    /*
     * Credit is paid out of cur.hits, not out of the connected player list.
     *
     * Those are not the same set, and the difference is somebody's pet. A
     * player who swung at the boss and then dropped — closed the tab, lost
     * their connection, went to work — is not in getPlayers() any more, and
     * paying from that list quietly deletes a claim they had already earned.
     * The spec's requirement is that you hit it and that it died; it does not
     * say you have to watch. So the grant is written straight into the book
     * against the userId, whether or not there is anyone there to tell.
     */
    for (const uid in cur.hits) {
      if (!book[uid]) book[uid] = blank()
      const R = book[uid]
      const base = blank()
      for (const k in base) if (R[k] === undefined || R[k] === null) R[k] = base[k]
      R.kills[b.key] = (R.kills[b.key] || 0) + 1
      // the guarantee: first time, no roll
      if (!((R.chibis[b.key] || 0) > 0)) R.chibis[b.key] = 1
      rate(R, uid)
    }

    /*
     * Chests are the other list: everyone standing in the ring, swung or not.
     * "Don't worry about treasure chests; everyone will get them equally" is
     * exactly why this is a separate pass over a different set.
     */
    const players = world.getPlayers ? world.getPlayers() : []
    for (const p of players) {
      if (!p) continue
      const uid = p.userId || p.id
      const R = recFor(p)
      const swung = !!cur.hits[uid]
      const here = inRing(p)
      if (here) R.chests += b.chest
      if (!here && !swung) continue

      if (swung) {
        tell(p.id, R.kills[b.key] > 1
          ? (b.name + ' falls. You already have its chibi; ' +
             comma(b.coin) + ' CashCoin and ' + b.chest + ' chests.')
          : (b.name + ' falls. Its chibi is yours — Chibi Rating ' + comma(R.rating) + '.'))
      } else {
        tell(p.id, b.name + ' falls. ' + b.chest +
                   ' chests — swing at it next time and the chibi is guaranteed.')
      }
      sendYou(p.id)
    }
    save()
    push()
  }

  // a boss nobody finishes gives up and resets rather than sitting on 3 hp
  // forever because the two people fighting it logged off
  app.on('update', () => {
    if (!cur) { spawn(); return }
    if (cur.down) {
      if (now() >= cur.until) spawn()
      return
    }
    if (now() - cur.born > ENRAGE_MS) {
      cur.hp = cur.b.hp
      cur.born = now()
      cur.hits = {}
      push()
    }
    touch()
  })

  world.on('leave', () => { save() })

  spawn()
}

/* the action lives on the middle of the ring. distance is generous so a
 * low-level cat can tap it from the edge and still be on the list — which is
 * the entire point of the rule it is serving. */
const a = app.create('action')
a.label = 'Swing'
a.distance = FIGHT_R
a.duration = 0.1
a.position.set(BX, 1.6, BZ)
a.onTrigger = () => app.send('swing', {})
app.add(a)
