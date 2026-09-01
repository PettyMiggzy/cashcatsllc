/*
 * World of CashCats — the Trades
 *
 * Three things to actually do on the grounds, and one ledger that records
 * them. On lore, because everything in this world is bookkeeping: you do not
 * "get loot", you file a return, and the board on the plaza is the register of
 * who has filed the most.
 *
 *   FISHING  at the Docks   a timing check — cast, wait for the bite, strike
 *                           inside the window. Skill, not a countdown.
 *   FORAGING at the Grove   walk the clearing, gather nodes, they regrow
 *   MINING   at the Seam    veins take several swings; better picks take fewer
 *
 * House rules, same as the Workshop and the Homestead:
 *
 *   - Nothing here is bought. Every rod, pick and basket is earned by doing
 *     the trade. The dev's spec gates the Gold Cash Cat behind a Silver or
 *     Gold rod and that is kept exactly: 0.5%, rod tier 1 or better. What is
 *     NOT kept is any way to *buy* that rod — paying money for a better roll
 *     at a rare drop is a loot box, and this is a token project that would be
 *     selling one to its own holders. The rods come at 60 and 250 catches.
 *   - The server owns every number. The client sends "I cast" and "I struck";
 *     it never sends "I caught a Gold Cash Cat".
 *   - The ledger persists. world.storage is a real file on the server, keyed
 *     by userId rather than the per-session network id, so a tally survives a
 *     reconnect the way anyone would expect it to.
 */

const isServer = world.isServer
const now = () => Date.now()

const GOLD='#a9812a', GOLD_L='#e8c25a', CREAM='#e8f2ec', DIM='#8fa39a'
const PAPER='#f4f0e3', LIME='#2ecc71', RED='#c0392b', BLUE='#4fb3d9'
const INK='#16150f'

/* ------------------------------------------------------------------ *
 * the tables                                                          *
 * ------------------------------------------------------------------ */
/*
 * The dev's spec, implemented as written:
 *
 *   - Only the Silver and Gold rods can land a Gold Cash Cat, at 0.5%, and
 *     only when fishing WITH BAIT.
 *   - The Gold Rod is the only rod that can land Ultra Rare fish, also at
 *     0.5%, and it lands the bigger common fish more often.
 *   - The Silver Rod is CRAFTED from materials the other two trades produce.
 *   - The Gold Rod is BOUGHT with a Gold Cash Cat — so the first one is luck
 *     and after that it compounds.
 *   - Bait is bought with CashCoin, which is only earned by playing.
 *
 * Nothing in this loop is bought with the traded token. That is the whole
 * point of it and it should stay that way.
 *
 * Weights are percentages and sum to 100, so the rate on the sheet in the
 * world is the rate in the world.
 */
/*
 * Rarity is four levels — Common, Uncommon, Rare, Ultra Rare — and the fish
 * inside them are placeholders. The dev is naming the real ones, so the table
 * is built to be swapped: a fish is one row, and rarity, weight, value, the
 * rod it needs and the model it shows are all on that row. Adding the real
 * list later touches nothing but this array.
 *
 * Weights are percentages and sum to 100.
 */
const COMMON = 0, UNCOMMON = 1, RARE = 2, ULTRA = 3
const RARITY = ['Common', 'Uncommon', 'Rare', 'Ultra Rare']
const RARITY_COLOR = ['#a9c4b6', '#7ec8a9', '#4fb3d9', '#e8c25a']

const FISH = [
  { key:'fishPerch', name:'Penny Perch',    r:COMMON,   w:30.0, v:1,   rod:0 },
  { key:'fishCarp',  name:'Copper Carp',    r:COMMON,   w:26.0, v:2,   rod:0 },
  { key:'fishTrout', name:'Paper Trout',    r:COMMON,   w:22.0, v:4,   rod:0 },
  { key:'fishBass',  name:'Silver Bass',    r:UNCOMMON, w:14.0, v:9,   rod:0, big:1 },
  { key:'fishEel',   name:'Ledger Eel',     r:RARE,     w: 7.0, v:20,  rod:0, big:1 },
  { key:'fishTuna',  name:'Blue Chip Tuna', r:ULTRA,    w: 0.5, v:120, rod:2, big:1 },
  { key:'fishGold',  name:'GOLD CASH CAT',  r:ULTRA,    w: 0.5, v:500, rod:1, bait:1 },
]

/*
 * Baits all cost the same and each one draws different species — so choosing
 * bait is aiming, not paying for a better roll. That distinction is the whole
 * reason this economy is not a loot box, and it should survive contact with
 * whatever the final fish list turns out to be.
 *
 * A bait multiplies the weight of what it draws and everything renormalises,
 * so bait never *guarantees* anything and the printed odds stay true.
 */
const BAIT_DRAW = 4.0
const BAITS = [
  { key:'worm',   name:'Worm',       draws:['fishPerch', 'fishCarp'] },
  { key:'shrimp', name:'Shrimp',     draws:['fishTrout', 'fishBass'] },
  { key:'minnow', name:'Minnow',     draws:['fishEel'] },
  { key:'roe',    name:'Salmon Roe', draws:['fishBass', 'fishEel'] },
]
/*
 * Baits draw SPECIES, not rarity tiers — which is what the spec says, and the
 * first cut got it wrong in a way only a simulation showed. Drawing a tier
 * meant the Glitter Lure, which drew Ultra Rare, did precisely nothing: Ultra
 * Rare is rolled as its own flat 0.5% before the weighted table is touched, so
 * the bait was multiplying the weight of fish that were never in that pool. It
 * cost twelve CashCoin and changed no number in the game.
 *
 * Naming species also means the real fish list can give each bait its own
 * quarry without any of this logic changing.
 */
const baitDraws = (bait, f) => !!bait && bait.draws.indexOf(f.key) !== -1

const baitByKey = k => { for (let i = 0; i < BAITS.length; i++) if (BAITS[i].key === k) return BAITS[i]; return null }

const RODS = [
  { key:'rodWood',   name:'Wooden Rod', window:1500, how:'yours from the first cast' },
  { key:'rodSilver', name:'Silver Rod', window:1800, how:'crafted at the Workshop' },
  { key:'rodGold',   name:'Gold Rod',   window:2150, how:'bought with a Gold Cash Cat' },
]
// what the Silver Rod costs to craft, in what the other two trades produce
const SILVER_ORE = 40, SILVER_FORAGE = 25
// what the Gold Rod costs, in Gold Cash Cats landed
const GOLD_ROD_COST = 1
// bait, bought with CashCoin, one consumed per cast
const BAIT_COST = 12, BAIT_LOT = 5
// the Gold Rod's edge on the bigger commons, as a multiplier on their weight
const BIG_BONUS = 1.8

/*
 * Herbs and ores carry the same four rarities as fish, and the same rule: the
 * Ultra Rare ones are visible on the ground and refuse to be taken without a
 * Gold tool. Seeing something you cannot have yet is a better hook than not
 * knowing it exists.
 */
const FORAGE = [
  { key:'n_mushRed',  name:'Red Cap',    r:COMMON,   v:3  },
  { key:'n_mushTan',  name:'Tan Cap',    r:COMMON,   v:3  },
  { key:'n_flowerY',  name:'Gold Aster', r:UNCOMMON, v:6  },
  { key:'n_flowerP',  name:'Violet',     r:UNCOMMON, v:6  },
  { key:'n_bushS',    name:'Sweetberry', r:RARE,     v:14 },
  { key:'n_mushTall', name:'Embercap',   r:ULTRA,    v:70 },
]
/*
 * The Cat Park. The one ground that is not a trade.
 *
 * Everything else in this world pays for labour. This pays for doing what cats
 * do, which is the joke and also the point — a world of cats where the only
 * verbs are mine, forage and fish is missing something. It pays less than the
 * trades, deliberately: it is a thing to enjoy, not a better grind.
 *
 * A box is claimed for as long as you are in it, so the yard behaves like a
 * yard — nine boxes, and if someone is in the one you want you take another.
 */
const PARK_X = 0, PARK_Z = 56
const BOX_PAY = 4, BOX_HOLD = 25000      // ms a box stays yours after sitting
const SUN_PAY = 6, SUN_MOVE = 180000     // the sunbeams move every three minutes
const KNOCK_PAY = 3, KNOCK_BACK = 20000

const BOXES = []
for (let i = 0; i < 9; i++)
  BOXES.push({ x: PARK_X - 17 + (i % 3) * 3.6, z: PARK_Z - 8 + Math.floor(i / 3) * 3.6 })

// where a sunbeam can fall. Which three are lit rotates on the clock.
const SUNSPOTS = []
for (let i = 0; i < 8; i++) {
  const a = i * 0.7854 + 0.4
  SUNSPOTS.push({ x: PARK_X + Math.cos(a) * 12, z: PARK_Z + Math.sin(a) * 9 })
}
const SUN_LIT = 3

const SHELF_X = PARK_X + 15, SHELF_Z = PARK_Z - 2
const KNOCKS = []
for (let i = 0; i < 5; i++) KNOCKS.push({ x: SHELF_X - 2.6 + i * 1.3, y: 9.9, z: SHELF_Z })

const REGROW = 40000          // ms before a gathered node comes back
const BUNDLE = 15             // bonus for filing one of every kind

const SEAMS = [
  { name:'Copper Seam', r:COMMON,   hits:3,  v:4   },
  { name:'Silver Seam', r:UNCOMMON, hits:5,  v:12  },
  { name:'Gold Seam',   r:RARE,     hits:8,  v:40  },
  { name:'Cinderlode',  r:ULTRA,    hits:12, v:180 },
]

/*
 * Shovels and Pickaxes, four tiers each, exactly as the rod works: Common,
 * Copper and Silver are crafted from what the other trades produce, and only
 * the Gold one is bought — with a Gold Cash Cat, never with the traded token.
 *
 * Crafting across trades on purpose. A better pickaxe wants herbs and a better
 * shovel wants ore, so the three grounds pull on each other instead of being
 * three separate grinds in three separate fields.
 */
const TOOLS = ['Common', 'Copper', 'Silver', 'Gold']
const GOLD_TIER = 3           // the tier an Ultra Rare node demands

const SHOVELS = [
  { name:'Common Shovel', ore:0,  forage:0,  gold:0, yield:1.00 },
  { name:'Copper Shovel', ore:15, forage:10, gold:0, yield:1.30 },
  { name:'Silver Shovel', ore:45, forage:35, gold:0, yield:1.70 },
  { name:'Gold Shovel',   ore:0,  forage:0,  gold:1, yield:2.20 },
]
const PICKS = [
  { name:'Common Pickaxe', ore:0,  forage:0,  gold:0, off:0 },
  { name:'Copper Pickaxe', ore:12, forage:12, gold:0, off:1 },
  { name:'Silver Pickaxe', ore:40, forage:40, gold:0, off:2 },
  { name:'Gold Pickaxe',   ore:0,  forage:0,  gold:1, off:3 },
]
const RESEAM = 50000

/* ------------------------------------------------------------------ *
 * where things are                                                    *
 * ------------------------------------------------------------------ */
const DX = -47, SHORE = 38, DECK = 0.73
// the three jetty heads, matching lands.js
const SPOTS = [
  { x: DX - 16, z: SHORE + 18.0, y: DECK, name: 'West Jetty'   },
  { x: DX,      z: SHORE + 26.0, y: DECK, name: 'Long Jetty'   },
  { x: DX + 16, z: SHORE + 14.0, y: DECK, name: 'East Jetty'   },
]

const GX = 47, GZ = 52
const NODES = []
for (let i = 0; i < 12; i++) {
  const a = i * 0.5236 + 0.31, r = 7.5 + (i % 3) * 1.9
  // two Ultra Rare herbs in the ring, and they are meant to be seen and
  // refused until someone owns a Gold Shovel
  const kind = (i === 3 || i === 9) ? FORAGE.length - 1 : i % (FORAGE.length - 1)
  NODES.push({ x: GX + Math.cos(a) * r, z: GZ + Math.sin(a) * r, kind: kind })
}

const SX = 47, SZ = -27
const VEINS = []
for (let i = 0; i < 8; i++) {
  // one Cinderlode, at the far end of the face
  const kind = i === 7 ? 3 : (i % 3 === 2 ? 2 : (i % 2))
  VEINS.push({ x: SX - 11 + i * 3.1, z: SZ - 11.4, y: 1.5, kind: kind })
}

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
  if (opts.rough !== undefined) n.roughness = opts.rough
  if (opts.metal !== undefined) n.metalness = opts.metal
  if (opts.opacity !== undefined) n.opacity = opts.opacity
  app.add(n); return n
}
function model(key, pos, rotY, scale) {
  const prop = props[key]
  if (!prop || !prop.url) return null
  const holder = app.create('group')
  holder.position.set(pos[0], pos[1], pos[2])
  if (rotY) holder.rotation.y = rotY
  app.add(holder)
  world.load('model', prop.url).then(node => {
    const k = scale === undefined ? 1 : scale
    node.scale.set(k, k, k)
    holder.add(node)
  }).catch(() => {})
  return holder
}
/*
 * A world-space panel, sized in METRES.
 *
 * `ui.width` and `ui.height` are the CANVAS size in pixels; `size` is the
 * metres-per-pixel that maps it onto the quad. Passing metres straight in
 * makes a two-pixel canvas, which renders as nothing at all — the dedication
 * stone stood on the plaza with a blank bronze plate on it for exactly this
 * reason. Take metres, convert here, and it cannot be got wrong per call.
 */
function panel(wm, hm, size, pos, rotY, bg, border) {
  const u = app.create('ui')
  u.space = 'world'
  u.width = Math.round(wm / size)
  u.height = Math.round(hm / size)
  u.size = size
  // res 1, not the engine default of 2. res multiplies the canvas in BOTH
  // axes, so a board that is 1038 px wide allocates 2076x1538 = 3.2M pixels —
  // 12.8 MB of canvas backing store and as much again on the GPU — for signage
  // read from three metres away. Across the 44 panels in this world that was
  // most of half a gigabyte spent on supersampling text nobody stands close
  // enough to see the edges of.
  u.res = 1
  u.backgroundColor = bg; u.borderColor = border; u.borderWidth = 6
  u.borderRadius = 12; u.padding = 22; u.flexDirection = 'column'
  u.lit = false; u.doubleside = false
  u.position.set(pos[0], pos[1], pos[2])
  if (rotY) u.rotation.y = rotY
  app.add(u); return u
}
function text(parent, val, px, color, weight, mt) {
  const t = app.create('uitext')
  t.value = val; t.fontSize = px; t.color = color; t.lineHeight = 1.3
  if (weight) t.fontWeight = weight
  if (mt) t.margin = [mt, 0, 0, 0]
  parent.add(t); return t
}
function action(label, pos, dist, dur, fn) {
  const a = app.create('action')
  a.label = label; a.distance = dist; a.duration = dur
  a.position.set(pos[0], pos[1], pos[2])
  a.onTrigger = fn
  app.add(a); return a
}
// no Intl in the sandbox, so toLocaleString gives unseparated digits
function comma(n) {
  const s = String(Math.floor(n)); let out = ''
  for (let i = 0; i < s.length; i++) {
    if (i && (s.length - i) % 3 === 0) out += ','
    out += s[i]
  }
  return out
}

/* ================================================================== *
 * SERVER — owns every number                                          *
 * ================================================================== */
if (isServer) {
  const KEY = 'ccl.ledger.v1'
  let book = world.get(KEY) || {}       // userId -> ledger
  let saveAt = 0

  // `filed` is lifetime CashCoin earned and never goes down — it is the
  // leaderboard. `coin` is the spendable balance and does. Keeping them apart
  // means buying bait does not cost you your place on the board.
  const blank = () => ({ name:'?', fish:0, catches:{}, forage:0, kinds:{}, ore:0,
                         best:0, filed:0, coin:0, gold:0, rods:1, shovel:0, pick:0, park:0, napAt:0,
                         // bait is a bag now: kind -> how many, plus what is on the line
                         bait:{}, onLine:null })
  const grant = (L, n) => { L.filed += n; L.coin += n }
  /*
   * Fetch a ledger, and bring an old one up to the current shape.
   *
   * The stored ledger predates CashCoin, bait and owned rods. Without this
   * backfill an existing player's first catch does `undefined + 4`, writes NaN
   * into their balance, and every number they own is NaN from then on — and it
   * persists, so it survives a restart. A save format that changes needs a
   * migration even when the change looks additive.
   */
  const ledgerFor = p => {
    const id = p.userId || p.id
    if (!book[id]) book[id] = blank()
    const L = book[id], base = blank()
    for (const k in base) if (L[k] === undefined || L[k] === null) L[k] = base[k]
    if (typeof L.coin !== 'number' || L.coin !== L.coin) L.coin = L.filed || 0
    // bait used to be a single count; carry an old stock over as worms
    if (typeof L.bait === 'number') L.bait = L.bait > 0 ? { worm: L.bait } : {}
    if (!L.bait || typeof L.bait !== 'object') L.bait = {}
    L.name = p.name || '?'
    return L
  }
  const save = () => { world.set(KEY, book); saveAt = now() + 4000 }
  const touch = () => { if (now() > saveAt) save() }

  // rods is a count of what you own: 1 = wood, 2 = +silver, 3 = +gold.
  // Not derived from catches any more — the spec makes the Silver Rod
  // something you craft and the Gold Rod something you buy with a Gold Cash
  // Cat, so ownership is a thing the player did, not a threshold they passed.
  const rodTier = L => Math.max(0, Math.min(RODS.length - 1, (L.rods || 1) - 1))
  // Tool tier is owned, not earned by a threshold — the spec makes these
  // things you craft or buy, so they are a thing the player did.
  const pickTier = L => Math.max(0, Math.min(PICKS.length - 1, L.pick || 0))
  const shovelTier = L => Math.max(0, Math.min(SHOVELS.length - 1, L.shovel || 0))

  /* roll the catch table, folding locked weight down into the commons so the
   * printed rates stay honest whatever rod you hold */
  /*
   * Roll the catch table for a given rod and whether the line is baited.
   *
   * Anything the player cannot land right now is dropped and its weight is
   * folded back into the three commons, so the odds always total 100. Without
   * that, a wooden rod with no bait would be fishing a one-percent hole and
   * the printed rates would be lies.
   */
  /*
   * Roll the catch table for a rod and a bait.
   *
   * Bait multiplies the weight of the rarity it draws and everything then
   * renormalises, so bait aims rather than upgrades — it can never guarantee a
   * fish, and the odds on the board stay true whatever is on the line.
   *
   * Anything the player cannot land right now is dropped and its weight folds
   * back into the commons. Without that, a wooden rod on a bare line would be
   * fishing a one-percent hole while the sign claimed otherwise.
   */
  /*
   * Roll the catch.
   *
   * The two headline rates are rolled FIRST and independently, because the
   * spec states them as flat numbers: a Gold Cash Cat is 0.5% on a baited
   * line with a Silver or Gold rod, and an Ultra Rare fish is 0.5% on the
   * Gold Rod. Folding those into the weighted table looked fine and was
   * wrong — a simulation of 400k casts put the Gold Cash Cat at 0.15% on a
   * worm and 1.95% on the glitter lure, because the bait multiplier dragged
   * the jackpot around with the tier it was drawing. Bait is supposed to aim
   * among the fish, not move the headline rate.
   *
   * So: jackpot, then ultra, then the ordinary table — and only that last
   * roll is weighted by bait. The number on the sign is now the number the
   * server rolls, whatever is on the line.
   */
  const GOLD_CAT = FISH.filter(f => f.key === 'fishGold')[0]
  const rollFish = (tier, bait) => {
    // 1. the jackpot: flat, independent, needs a Silver rod and a baited line
    if (GOLD_CAT && tier >= GOLD_CAT.rod && bait && num(0, 100, 4) <= GOLD_CAT.w) return GOLD_CAT

    // 2. Ultra Rare fish: flat, independent, Gold Rod only
    const ultra = FISH.filter(f => f.r === ULTRA && !f.bait && tier >= f.rod)
    if (ultra.length) {
      let uw = 0
      for (let i = 0; i < ultra.length; i++) uw += ultra[i].w
      if (num(0, 100, 4) <= uw) {
        const r = num(0, uw, 4)
        let a = 0
        for (let i = 0; i < ultra.length; i++) { a += ultra[i].w; if (r <= a) return ultra[i] }
        return ultra[0]
      }
    }

    // 3. the ordinary table. This is the only part bait touches: it multiplies
    //    the tier it draws and everything renormalises, so bait can shift what
    //    you catch but never guarantee it.
    const pool = FISH.filter(f => f.r !== ULTRA && !f.bait && tier >= f.rod)
    const weight = f => {
      let w = f.w
      if (f.big && tier >= 2) w *= BIG_BONUS
      if (baitDraws(bait, f)) w *= BAIT_DRAW
      return w
    }
    let total = 0
    for (let i = 0; i < pool.length; i++) total += weight(pool[i])
    const r = num(0, total, 4)
    let acc = 0
    for (let i = 0; i < pool.length; i++) { acc += weight(pool[i]); if (r <= acc) return pool[i] }
    return pool[0] || FISH[0]
  }

  const casts = {}          // playerId -> { spot, biteAt, endAt, phase }
  const nodeBack = {}       // node index -> ms when it regrows
  const veinState = {}      // vein index -> { left, backAt }
  for (let i = 0; i < VEINS.length; i++) veinState[i] = { left: SEAMS[VEINS[i].kind].hits, backAt: 0 }

  const top = () => {
    const rows = []
    for (const id in book) {
      const L = book[id]
      rows.push({ n: L.name, f: L.fish, g: L.forage, o: L.ore, t: L.filed })
    }
    rows.sort((a, b) => b.t - a.t)
    return rows.slice(0, 6)
  }
  let dirty = true
  const pushWorld = () => {
    const nb = [], vb = []
    for (let i = 0; i < NODES.length; i++) nb.push((nodeBack[i] || 0) > now() ? 0 : 1)
    for (let i = 0; i < VEINS.length; i++) vb.push(veinState[i].backAt > now() ? 0 : veinState[i].left)
    const bb = [], kk = []
    for (let i = 0; i < BOXES.length; i++) bb.push((boxHold[i] && boxHold[i].until > now()) ? 0 : 1)
    for (let i = 0; i < KNOCKS.length; i++) kk.push((knockBack[i] || 0) > now() ? 0 : 1)
    app.send('world', { n: nb.join(''), v: vb.join(''), top: top(),
                        b: bb.join(''), k: kk.join(''), sun: sunLit.join(',') })
  }
  const pushYou = (pid, L) => {
    app.sendTo(pid, 'you', {
      fish: L.fish, forage: L.forage, ore: L.ore, filed: L.filed, best: L.best,
      rod: rodTier(L), pick: pickTier(L), shovel: shovelTier(L), coin: L.coin, gold: L.gold || 0,
      bait: L.bait, onLine: L.onLine,
      kinds: Object.keys(L.kinds).length,
    })
  }

  app.on('hello', (d, pid) => {
    const p = world.getPlayer(pid); if (!p) return
    pushYou(pid, ledgerFor(p)); pushWorld()
  })

  /* ---- fishing ---- */
  app.on('cast', (d, pid) => {
    const p = world.getPlayer(pid); if (!p) return
    const spot = SPOTS[d && d.s | 0]; if (!spot) return
    // you have to actually be standing on the jetty
    const q = p.position
    if (Math.abs(q.x - spot.x) > 5 || Math.abs(q.z - spot.z) > 6) return
    const L = ledgerFor(p)
    casts[pid] = {
      s: d.s | 0, phase: 'wait',
      biteAt: now() + num(1400, 4800, 0),
      endAt: 0,
    }
    app.sendTo(pid, 'cast', { spot: spot.name })
  })

  app.on('strike', (d, pid) => {
    const c = casts[pid]
    const p = world.getPlayer(pid)
    if (!c || !p) return
    if (c.phase !== 'bite') {          // struck early — the fish is gone
      delete casts[pid]
      app.sendTo(pid, 'missed', { why: c.phase === 'wait' ? 'Too early — you spooked it.' : 'Gone.' })
      return
    }
    delete casts[pid]
    const L = ledgerFor(p)
    // bait is spent on the strike, not on the cast — a cast that never bit
    // should not cost you anything
    // whichever bait is on the line is what gets spent, and only on a strike
    let bait = null
    if (L.onLine && (L.bait[L.onLine] || 0) > 0) {
      bait = baitByKey(L.onLine)
      L.bait[L.onLine] -= 1
      if (L.bait[L.onLine] <= 0) delete L.bait[L.onLine]
    }
    const f = rollFish(rodTier(L), bait)
    L.fish += 1
    L.catches[f.key] = (L.catches[f.key] || 0) + 1
    grant(L, f.v)
    if (f.key === 'fishGold') L.gold = (L.gold || 0) + 1
    if (f.v > L.best) L.best = f.v
    touch()
    app.sendTo(pid, 'caught', { key: f.key, name: f.name, v: f.v,
                                gold: f.key === 'fishGold' })
    if (f.key === 'fishGold') world.chat(p.name + ' landed a GOLD CASH CAT at the Docks.', true)
    pushYou(pid, L); dirty = true
  })

  /* ---- foraging ---- */
  app.on('gather', (d, pid) => {
    const p = world.getPlayer(pid); if (!p) return
    const i = d && d.i | 0
    const nd = NODES[i]; if (!nd) return
    if ((nodeBack[i] || 0) > now()) return
    const q = p.position
    if (Math.abs(q.x - nd.x) > 4 || Math.abs(q.z - nd.z) > 4) return
    const kind = FORAGE[nd.kind]
    const L = ledgerFor(p)
    // An Ultra Rare herb can be stood over, looked at, and not taken. That is
    // the point of it — the node stays where it is rather than being hidden.
    if (kind.r === ULTRA && shovelTier(L) < GOLD_TIER) {
      app.sendTo(pid, 'shop', { msg: kind.name + ' needs a Gold Shovel. You have the ' + SHOVELS[shovelTier(L)].name + '.' })
      return
    }
    nodeBack[i] = now() + REGROW
    L.forage += 1
    grant(L, Math.round(kind.v * SHOVELS[shovelTier(L)].yield))
    let bonus = 0
    if (!L.kinds[kind.key]) {
      L.kinds[kind.key] = 1
      if (Object.keys(L.kinds).length === FORAGE.length) { bonus = BUNDLE; grant(L, BUNDLE) }
    }
    touch()
    app.sendTo(pid, 'got', { name: kind.name, v: kind.v, bonus })
    pushYou(pid, L); dirty = true
  })

  /* ---- mining ---- */
  app.on('swing', (d, pid) => {
    const p = world.getPlayer(pid); if (!p) return
    const i = d && d.i | 0
    const vn = VEINS[i]; if (!vn) return
    const st = veinState[i]
    if (st.backAt > now()) return
    const q = p.position
    if (Math.abs(q.x - vn.x) > 4 || Math.abs(q.z - vn.z) > 5) return
    const L = ledgerFor(p)
    const seam = SEAMS[vn.kind]
    if (seam.r === ULTRA && pickTier(L) < GOLD_TIER) {
      app.sendTo(pid, 'shop', { msg: seam.name + ' needs a Gold Pickaxe. You have the ' + PICKS[pickTier(L)].name + '.' })
      return
    }
    const need = Math.max(1, seam.hits - PICKS[pickTier(L)].off)
    st.left = Math.min(st.left, need)
    st.left -= 1
    if (st.left > 0) {
      app.sendTo(pid, 'chip', { left: st.left, name: seam.name })
    } else {
      st.backAt = now() + RESEAM
      st.left = seam.hits
      L.ore += 1
      grant(L, seam.v)
      touch()
      app.sendTo(pid, 'ore', { name: seam.name, v: seam.v })
      pushYou(pid, L)
    }
    dirty = true
  })

  /* ---- the Cat Park ---- */
  const boxHold = {}          // box index -> { until, who }
  const knockBack = {}        // pot index -> ms when it comes back
  let sunAt = 0, sunLit = []
  const rollSun = () => {
    sunLit = []
    // deterministic from the clock, so every client lights the same three
    const seed = Math.floor(now() / SUN_MOVE)
    for (let k = 0; k < SUN_LIT; k++) sunLit.push((seed * 7 + k * 3) % SUNSPOTS.length)
    sunAt = now() + SUN_MOVE
  }
  rollSun()

  const near = (p, o, r) => Math.abs(p.position.x - o.x) < r && Math.abs(p.position.z - o.z) < r

  app.on('sit', (d, pid) => {
    const p = world.getPlayer(pid); if (!p) return
    const i = d && d.i | 0
    const b = BOXES[i]; if (!b || !near(p, b, 3.2)) return
    const h = boxHold[i]
    if (h && h.until > now() && h.who !== pid) {
      app.sendTo(pid, 'shop', { msg: 'Occupied. There are eight other boxes.' })
      return
    }
    if (h && h.who === pid && h.until > now()) {
      app.sendTo(pid, 'shop', { msg: 'You are already in this box.' })
      return
    }
    boxHold[i] = { until: now() + BOX_HOLD, who: pid }
    const L = ledgerFor(p)
    L.park = (L.park || 0) + 1
    grant(L, BOX_PAY)
    touch()
    app.sendTo(pid, 'shop', { msg: 'In the box. +' + BOX_PAY + ' CashCoin.' })
    pushYou(pid, L); dirty = true
  })

  app.on('nap', (d, pid) => {
    const p = world.getPlayer(pid); if (!p) return
    const i = d && d.i | 0
    if (sunLit.indexOf(i) === -1) {
      app.sendTo(pid, 'shop', { msg: 'The sun has moved off this one.' })
      return
    }
    const spot = SUNSPOTS[i]; if (!spot || !near(p, spot, 3.0)) return
    const L = ledgerFor(p)
    if ((L.napAt || 0) > now()) {
      app.sendTo(pid, 'shop', { msg: 'Still stretching. Give it a moment.' })
      return
    }
    L.napAt = now() + 20000
    L.park = (L.park || 0) + 1
    grant(L, SUN_PAY)
    touch()
    app.sendTo(pid, 'shop', { msg: 'Warm. +' + SUN_PAY + ' CashCoin.' })
    pushYou(pid, L); dirty = true
  })

  app.on('knock', (d, pid) => {
    const p = world.getPlayer(pid); if (!p) return
    const i = d && d.i | 0
    const k = KNOCKS[i]; if (!k) return
    if ((knockBack[i] || 0) > now()) return
    if (Math.abs(p.position.x - k.x) > 4 || Math.abs(p.position.z - k.z) > 4) return
    knockBack[i] = now() + KNOCK_BACK
    const L = ledgerFor(p)
    L.park = (L.park || 0) + 1
    grant(L, KNOCK_PAY)
    touch()
    app.sendTo(pid, 'shop', { msg: 'It fell off. +' + KNOCK_PAY + ' CashCoin.' })
    pushYou(pid, L); dirty = true
  })

  /* ---- the shop ----
   * Bait costs CashCoin, which is only earned by playing. The Silver Rod is
   * crafted out of what the other two trades produce, so fishing better means
   * having mined and foraged. The Gold Rod costs a Gold Cash Cat, which means
   * the first one is luck and everything after it compounds. None of these
   * take the traded token, and that is deliberate.
   */
  app.on('buy', (d, pid) => {
    const p = world.getPlayer(pid); if (!p) return
    const L = ledgerFor(p)
    const what = d && d.what
    let msg = null
    if (what === 'bait') {
      // every bait costs the same — what differs is what it draws
      const b = baitByKey(d && d.kind)
      if (!b) msg = 'No such bait.'
      else if (L.coin < BAIT_COST) msg = 'Not enough CashCoin — ' + BAIT_COST + ' for ' + BAIT_LOT + '.'
      else {
        L.coin -= BAIT_COST
        L.bait[b.key] = (L.bait[b.key] || 0) + BAIT_LOT
        if (!L.onLine) L.onLine = b.key
        msg = '+' + BAIT_LOT + ' ' + b.name + '.'
      }
    } else if (what === 'online') {
      const b = baitByKey(d && d.kind)
      if (!b) msg = 'No such bait.'
      else if (!(L.bait[b.key] > 0)) msg = 'No ' + b.name + ' in the box.'
      else { L.onLine = b.key; msg = b.name + ' on the line.' }
    } else if (what === 'shovel' || what === 'pick') {
      const set = what === 'shovel' ? SHOVELS : PICKS
      const have = what === 'shovel' ? shovelTier(L) : pickTier(L)
      const next = set[have + 1]
      if (!next) msg = 'You already have the ' + set[have].name + '.'
      else if (next.gold) {
        if ((L.gold || 0) < next.gold) msg = next.name + ' costs ' + next.gold + ' Gold Cash Cat. You have ' + (L.gold || 0) + '.'
        else { L.gold -= next.gold; L[what] = have + 1
               msg = next.name + ' bought. Ultra Rare ' + (what === 'shovel' ? 'herbs' : 'ore') + ' can be taken now.' }
      } else if (L.ore < next.ore || L.forage < next.forage) {
        msg = next.name + ' needs ' + next.ore + ' ore and ' + next.forage + ' gathered. You have ' + L.ore + ' and ' + L.forage + '.'
      } else {
        L.ore -= next.ore; L.forage -= next.forage; L[what] = have + 1
        msg = next.name + ' crafted.'
      }
    } else if (what === 'silver') {
      if (L.rods >= 2) msg = 'You already have the Silver Rod.'
      else if (L.ore < SILVER_ORE || L.forage < SILVER_FORAGE)
        msg = 'Needs ' + SILVER_ORE + ' ore and ' + SILVER_FORAGE + ' gathered. You have ' + L.ore + ' and ' + L.forage + '.'
      else { L.ore -= SILVER_ORE; L.forage -= SILVER_FORAGE; L.rods = 2
             msg = 'Silver Rod crafted. Baited casts can now land a Gold Cash Cat.' }
    } else if (what === 'gold') {
      if (L.rods >= 3) msg = 'You already have the Gold Rod.'
      else if (L.rods < 2) msg = 'Craft the Silver Rod first.'
      else if ((L.gold || 0) < GOLD_ROD_COST) msg = 'Costs ' + GOLD_ROD_COST + ' Gold Cash Cat. You have ' + (L.gold || 0) + '.'
      else { L.gold -= GOLD_ROD_COST; L.rods = 3
             msg = 'Gold Rod bought. Ultra Rare fish are now on your table.' }
    }
    if (msg) { touch(); app.sendTo(pid, 'shop', { msg: msg }); pushYou(pid, L) }
  })

  /* ---- the clock ---- */
  let acc = 0
  app.on('update', dt => {
    const t = now()
    for (const pid in casts) {
      const c = casts[pid]
      if (c.phase === 'wait' && t >= c.biteAt) {
        const p = world.getPlayer(pid)
        if (!p) { delete casts[pid]; continue }
        const w = RODS[rodTier(ledgerFor(p))].window
        c.phase = 'bite'; c.endAt = t + w
        app.sendTo(pid, 'bite', { ms: w })
      } else if (c.phase === 'bite' && t >= c.endAt) {
        delete casts[pid]
        app.sendTo(pid, 'missed', { why: 'It took the bait and left.' })
      }
    }
    if (now() > sunAt) { rollSun(); dirty = true }
    acc += dt
    if (acc >= 1.0) {
      acc = 0
      if (dirty) { dirty = false }
      pushWorld()
      if (saveAt && now() > saveAt) { world.set(KEY, book); saveAt = 0 }
    }
  })
}

/* ================================================================== *
 * CLIENT — draws it, and sends only intent                            *
 * ================================================================== */
if (!isServer) {

  const me = { fish:0, forage:0, ore:0, filed:0, best:0, rod:0, pick:0, kinds:0, coin:0, bait:{}, onLine:null, gold:0, shovel:0 }
  let board = []
  let nodeOn = [], veinLeft = []
  let fishing = -1, phase = 'idle', biteEnds = 0
  const nodeVis = [], veinVis = []

  /* ---------------- the Docks ---------------- */
  const spotUI = [], spotAct = []
  for (let i = 0; i < SPOTS.length; i++) {
    const s = SPOTS[i]
    // You walk up the jetty in +Z, so a sign at z-1.2 is one you pass and then
    // have at your back for the whole cast. Put it past the action, over the
    // water, where standing on the spot means looking straight at it.
    const u = panel(2.4, 0.9, 0.005, [s.x, s.y + 2.4, s.z + 1.8], Math.PI,
                    'rgba(10,26,34,0.88)', BLUE)
    text(u, s.name, 40, BLUE, 800)
    const st = text(u, 'Press E to cast', 26, CREAM, 400, 8)
    spotUI.push(st)
    // one action, two meanings: cast when idle, strike when something is on.
    // duration 0.08 keeps the strike a tap rather than a hold, which is the
    // whole point of the timing check.
    spotAct.push(action('Cast', [s.x, s.y + 1.2, s.z], 4.5, 0.08, () => {
      // one action, two meanings. Striking early is a real mistake with a real
      // cost, so an early press is sent as a strike rather than swallowed.
      if (fishing === i && phase !== 'idle') app.send('strike', {})
      else { fishing = i; app.send('cast', { s: i }) }
    }))
    model('m_barrel', [s.x + 1.7, s.y, s.z - 2.4], 0.4, 1.0)
  }
  // the rod rack, and the shop counter beside it
  model('rodWood',   [DX + 6.5, 0.9, SHORE - 3.2], 0.6, 1.0)
  model('rodSilver', [DX + 7.3, 0.9, SHORE - 3.4], 0.5, 1.0)
  model('rodGold',   [DX + 8.1, 0.9, SHORE - 3.6], 0.4, 1.0)

  const shop = panel(3.6, 3.4, 0.005, [DX + 6.0, 2.9, SHORE - 4.6], Math.PI,
                     'rgba(24,20,10,0.93)', GOLD)
  text(shop, 'THE SHOP', 42, GOLD_L, 800)
  const sLine = text(shop, '', 24, CREAM, 700, 8)
  const sBait = text(shop, '', 22, LIME, 400, 4)
  text(shop, 'Every bait is ' + BAIT_COST + ' CashCoin for ' + BAIT_LOT + '.', 21, CREAM, 400, 12)
  text(shop, 'They cost the same. They draw different fish.', 20, DIM, 400, 3)
  for (let i = 0; i < BAITS.length; i++)
    text(shop, '  ' + BAITS[i].name + ' — ' + BAITS[i].draws
           .map(k => { for (let j = 0; j < FISH.length; j++) if (FISH[j].key === k) return FISH[j].name; return k })
           .join(', '), 19, CREAM, 400, 3)
  text(shop, 'Silver Rod — ' + SILVER_ORE + ' ore, ' + SILVER_FORAGE + ' gathered', 21, CREAM, 400, 12)
  text(shop, 'Gold Rod — ' + GOLD_ROD_COST + ' Gold Cash Cat', 21, GOLD_L, 400, 3)
  const sMsg = text(shop, 'CashCoin is only earned by playing.', 20, DIM, 400, 12)

  // one action per bait, laid along the counter, plus the two rods
  for (let i = 0; i < BAITS.length; i++) {
    const b = BAITS[i]
    action('Buy ' + b.name, [DX + 3.2 + i * 1.15, 1.3, SHORE - 4.0], 3.4, 0.35,
           () => app.send('buy', { what: 'bait', kind: b.key }))
    action('Put ' + b.name + ' on the line', [DX + 3.2 + i * 1.15, 2.0, SHORE - 4.0], 3.4, 0.5,
           () => app.send('buy', { what: 'online', kind: b.key }))
  }
  action('Craft the Silver Rod', [DX + 8.2, 1.3, SHORE - 4.0], 3.4, 0.5, () => app.send('buy', { what: 'silver' }))
  action('Buy the Gold Rod',     [DX + 9.3, 1.3, SHORE - 4.0], 3.4, 0.5, () => app.send('buy', { what: 'gold' }))
    app.on('shop', d => { if (d && d.msg) sMsg.value = d.msg })

  /* the catch, held up where you can see it */
  let heldKey = null, held = null, heldUntil = 0
  const showCatch = key => {
    if (held) { held.active = false; held = null }
    held = model(key, [SPOTS[Math.max(fishing, 0)].x, SPOTS[Math.max(fishing, 0)].y + 2.2,
                       SPOTS[Math.max(fishing, 0)].z - 0.6], 0, 1.1)
    heldKey = key
    heldUntil = now() + 4200
  }

  /* ---------------- the Grove ---------------- */
  for (let i = 0; i < NODES.length; i++) {
    const nd = NODES[i], kind = FORAGE[nd.kind]
    const ultra = kind.r === ULTRA
    const g = model(kind.key, [nd.x, 0, nd.z], i * 0.9, ultra ? 4.6 : 3.4)
    nodeVis.push(g)
    prim('cylinder', [ultra ? 1.9 : 1.5, ultra ? 1.9 : 1.5, 0.06],
         ultra ? '#8a6a2a' : '#6a8f4a', [nd.x, 0.03, nd.z], { rough: 1 })
    // an Ultra Rare herb is marked, not hidden — it should read as something
    // worth wanting before the label is close enough to read
    if (ultra) prim('cone', [0.5, 1.5], RARITY_COLOR[ULTRA], [nd.x, 2.4, nd.z],
                    { emissive: RARITY_COLOR[ULTRA], rough: 0.3 })
    action('Gather ' + kind.name, [nd.x, 1.0, nd.z], 3.2, ultra ? 0.9 : 0.55,
           () => app.send('gather', { i }))
  }

  /* the toolsmith at the Grove — a shovel is crafted where it is used */
  model('p_shovel', [GX - 3.4, 0.9, GZ - 5.8], 0.6, 2.0)
  const ts = panel(3.4, 2.4, 0.005, [GX - 3.4, 2.7, GZ - 5.2], Math.PI,
                   'rgba(12,26,14,0.93)', '#8fd07a')
  text(ts, 'SHOVELS', 40, '#8fd07a', 800)
  const tsNow = text(ts, '', 23, CREAM, 700, 8)
  for (let i = 1; i < SHOVELS.length; i++) {
    const k = SHOVELS[i]
    text(ts, k.name + ' — ' + (k.gold ? k.gold + ' Gold Cash Cat'
         : k.ore + ' ore, ' + k.forage + ' gathered'), 20,
         k.gold ? GOLD_L : DIM, 400, i === 1 ? 10 : 3)
  }
  text(ts, 'Embercap needs the Gold Shovel.', 19, RARITY_COLOR[ULTRA], 700, 10)
  action('Craft the next Shovel', [GX - 3.4, 1.2, GZ - 5.8], 3.4, 0.6,
         () => app.send('buy', { what: 'shovel' }))

  /* ---------------- the Seam ---------------- */
  for (let i = 0; i < VEINS.length; i++) {
    const vn = VEINS[i], seam = SEAMS[vn.kind]
    const col = seam.r === ULTRA ? '#ff7a3a'
              : (vn.kind === 2 ? '#e8c25a' : (vn.kind === 1 ? '#d8dde2' : '#c07a3a'))
    const g = prim('sphere', [seam.r === ULTRA ? 0.62 : 0.42], col, [vn.x, vn.y, vn.z],
                   { metal: 0.75, rough: 0.3,
                     emissive: seam.r === ULTRA ? '#8a3a10' : (vn.kind === 2 ? '#6b5210' : null) })
    veinVis.push(g)
    model('oreChunk', [vn.x, vn.y - 1.4, vn.z + 0.4], i * 1.3, 1.1)
    action('Mine ' + seam.name, [vn.x, vn.y, vn.z + 1.0], 3.4, 0.45, () => app.send('swing', { i }))
  }
  model('pickaxe', [SX - 6, 0.9, SZ - 4], 0.7, 1.0)

  /* the toolsmith at the Seam */
  const tp = panel(3.4, 2.4, 0.005, [SX - 6, 2.7, SZ - 3.4], Math.PI,
                   'rgba(26,20,12,0.93)', '#c98b3a')
  text(tp, 'PICKAXES', 40, '#c98b3a', 800)
  const tpNow = text(tp, '', 23, CREAM, 700, 8)
  for (let i = 1; i < PICKS.length; i++) {
    const k = PICKS[i]
    text(tp, k.name + ' — ' + (k.gold ? k.gold + ' Gold Cash Cat'
         : k.ore + ' ore, ' + k.forage + ' gathered'), 20,
         k.gold ? GOLD_L : DIM, 400, i === 1 ? 10 : 3)
  }
  text(tp, 'Cinderlode needs the Gold Pickaxe.', 19, '#ff7a3a', 700, 10)
  action('Craft the next Pickaxe', [SX - 6, 1.2, SZ - 4.4], 3.4, 0.6,
         () => app.send('buy', { what: 'pick' }))

  /* ---------------- the Cat Park ---------------- */
  const boxVis = [], sunVis = [], knockVis = []

  const parkSign = panel(3.6, 2.2, 0.005, [PARK_X, 2.7, PARK_Z - 15], Math.PI,
                         'rgba(14,26,20,0.92)', LIME)
  text(parkSign, 'THE CAT PARK', 44, LIME, 800)
  text(parkSign, 'Sit in a box. Nap in the sun.', 22, CREAM, 400, 10)
  text(parkSign, 'Knock things off the high shelf.', 22, CREAM, 400, 2)
  text(parkSign, 'It pays less than working. That is fine.', 20, DIM, 400, 12)

  /* the boxes */
  for (let i = 0; i < BOXES.length; i++) {
    const b = BOXES[i]
    const g = model('crate', [b.x, 0, b.z], (i % 4) * 0.4, 1.35)
    boxVis.push(g)
    action('Sit in the box', [b.x, 0.9, b.z], 3.0, 0.7, () => app.send('sit', { i }))
  }

  /* the sunbeams — a warm disc that only shows where the sun currently is */
  for (let i = 0; i < SUNSPOTS.length; i++) {
    const sp = SUNSPOTS[i]
    const g = prim('cylinder', [2.1, 2.1, 0.05], '#ffe9a8',
                   [sp.x, 0.06, sp.z], { emissive: '#ffdd7a', rough: 0.6 })
    g.active = false
    sunVis.push(g)
    action('Nap in the sun', [sp.x, 0.8, sp.z], 3.0, 1.1, () => app.send('nap', { i }))
  }

  /* the high shelf, and the things on it */
  for (let i = 0; i < KNOCKS.length; i++) {
    const k = KNOCKS[i]
    const g = model('n_potLarge', [k.x, k.y, k.z], i * 0.9, 1.6)
    knockVis.push(g)
    action('Knock it off', [k.x, k.y + 0.5, k.z], 2.4, 0.3, () => app.send('knock', { i }))
  }

  /* ---------------- the register on the plaza ---------------- */
  /* Beside the Filing Office door, because filing is what this is. */
  const BX = 9.5, BZ = 8.6
  prim('box', [0.4, 3.4, 0.4], '#2a2620', [BX - 2.6, 1.7, BZ], { rough: 0.7 })
  prim('box', [0.4, 3.4, 0.4], '#2a2620', [BX + 2.6, 1.7, BZ], { rough: 0.7 })
  const reg = panel(5.4, 4.0, 0.0052, [BX, 2.35, BZ + 0.06], 0, 'rgba(12,18,15,0.93)', GOLD)
  text(reg, 'THE REGISTER', 46, GOLD_L, 800)
  text(reg, 'Everything filed at CashCats LLC', 22, DIM, 400, 4)
  const rMine  = text(reg, '', 26, CREAM, 700, 16)
  const rGear  = text(reg, '', 22, LIME, 400, 4)
  const rNext  = text(reg, '', 21, DIM, 400, 4)
  text(reg, 'TOP FILERS', 28, GOLD_L, 800, 18)
  const rows = []
  for (let i = 0; i < 6; i++) rows.push(text(reg, '', 22, CREAM, 400, 5))

  /* a sheet at each ground, so the rules are posted where you play */
  const dk = panel(3.8, 4.4, 0.005, [DX + 8.5, 2.6, SHORE - 5.6], Math.PI, 'rgba(10,26,34,0.92)', BLUE)
  text(dk, 'THE DOCKS', 42, BLUE, 800)
  text(dk, 'Cast, wait for the bite, strike inside', 21, CREAM, 400, 10)
  text(dk, 'the window. Early spooks it.', 21, CREAM, 400, 2)
  for (let i = 0; i < FISH.length; i++) {
    const f = FISH[i]
    const pct = (f.w % 1 ? f.w.toFixed(1) : f.w.toFixed(0)) + '%'
    text(dk, RARITY[f.r].toUpperCase().slice(0, 8).padEnd(9) + f.name, 19,
         RARITY_COLOR[f.r], f.r === ULTRA ? 700 : 400, i ? 3 : 12)
    text(dk, '          ' + pct + '   ·   ' + f.v + ' CashCoin', 18, DIM, 400, 1)
  }
  text(dk, 'Bait aims, it does not upgrade — every bait', 19, LIME, 400, 10)
  text(dk, 'costs the same and draws a different tier.', 19, LIME, 400, 2)
  text(dk, 'Ultra Rare fish need the Gold Rod.', 19, LIME, 400, 6)
  text(dk, 'A Gold Cash Cat needs a Silver or Gold rod', 19, LIME, 400, 2)
  text(dk, 'and a baited line.', 19, LIME, 700, 2)
  text(dk, 'Rods are crafted and won, never sold for tokens.', 19, DIM, 400, 8)

  const gv = panel(3.4, 1.9, 0.005, [GX, 2.6, GZ - 12.5], Math.PI, 'rgba(12,26,14,0.92)', '#8fd07a')
  text(gv, 'THE GROVE', 42, '#8fd07a', 800)
  text(gv, 'Gather what grows. It grows back', 21, CREAM, 400, 10)
  text(gv, 'in about forty seconds.', 21, CREAM, 400, 2)
  text(gv, 'File one of all five kinds: +15 bonus.', 20, LIME, 400, 10)

  const sv = panel(3.4, 1.9, 0.005, [SX, 2.6, SZ - 2.5], Math.PI, 'rgba(26,20,12,0.92)', '#c98b3a')
  text(sv, 'THE SEAM', 42, '#c98b3a', 800)
  text(sv, 'Veins take several swings.', 21, CREAM, 400, 10)
  text(sv, 'Copper 3 · Silver 5 · Gold 8', 21, CREAM, 400, 2)
  text(sv, 'Steel Pick at 40 ore, Gold Pick at 150.', 20, LIME, 400, 10)

  const paint = () => {
    rMine.value = comma(me.filed) + ' CashCoin earned  ·  ' + me.fish + ' fish  ·  ' +
                  me.forage + ' gathered  ·  ' + me.ore + ' ore'
    rGear.value = RODS[me.rod].name + '  ·  ' + SHOVELS[me.shovel].name + '  ·  ' + PICKS[me.pick].name +
                  (me.gold ? '  ·  ' + me.gold + ' GOLD' : '')
    if (me.rod < RODS.length - 1) {
      rNext.value = 'Next rod: ' + RODS[me.rod + 1].name + ' — ' + RODS[me.rod + 1].how
    } else {
      rNext.value = 'Every rod in hand.'
    }
    if (sLine) sLine.value = comma(me.coin) + ' CashCoin to spend'
    if (tsNow) tsNow.value = SHOVELS[me.shovel].name + '  ·  ' + me.ore + ' ore, ' + me.forage + ' gathered'
    if (tpNow) tpNow.value = PICKS[me.pick].name + '  ·  ' + me.ore + ' ore, ' + me.forage + ' gathered'
    if (sBait) {
      let held = 0
      for (const k in me.bait) held += me.bait[k]
      const on = me.onLine ? baitByKey(me.onLine) : null
      sBait.value = held
        ? (held + ' bait in the box · ' + (on ? on.name + ' on the line' : 'nothing on the line'))
        : 'No bait — a bare line cannot land a Gold Cash Cat.'
    }
    for (let i = 0; i < rows.length; i++) {
      const b = board[i]
      rows[i].value = b ? ((i + 1) + '. ' + b.n + '   ' + comma(b.t)) : ''
    }
  }
  paint()

  app.on('you', d => {
    me.fish = d.fish; me.forage = d.forage; me.ore = d.ore; me.filed = d.filed
    me.best = d.best; me.rod = d.rod; me.pick = d.pick; me.kinds = d.kinds
    me.coin = d.coin || 0; me.bait = d.bait || {}; me.onLine = d.onLine; me.gold = d.gold || 0
    me.shovel = d.shovel || 0
    paint()
  })
  app.on('world', d => {
    board = d.top || []
    for (let i = 0; i < nodeVis.length; i++) {
      const on = d.n.charCodeAt(i) !== 48
      if (nodeVis[i] && nodeVis[i].active !== on) nodeVis[i].active = on
    }
    if (d.b) for (let i = 0; i < boxVis.length; i++) {
      const free = d.b.charCodeAt(i) !== 48
      if (boxVis[i] && boxVis[i].active !== free) boxVis[i].active = free
    }
    if (d.k) for (let i = 0; i < knockVis.length; i++) {
      const there = d.k.charCodeAt(i) !== 48
      if (knockVis[i] && knockVis[i].active !== there) knockVis[i].active = there
    }
    if (d.sun !== undefined) {
      const lit = String(d.sun).split(',').map(Number)
      for (let i = 0; i < sunVis.length; i++) {
        const on = lit.indexOf(i) !== -1
        if (sunVis[i] && sunVis[i].active !== on) sunVis[i].active = on
      }
    }
    for (let i = 0; i < veinVis.length; i++) {
      const left = d.v.charCodeAt(i) - 48
      if (veinVis[i]) {
        veinVis[i].active = left > 0
        const s = 0.55 + left * 0.13
        veinVis[i].scale.set(s, s, s)
      }
    }
    paint()
  })

  const say = (i, msg) => { if (spotUI[i]) spotUI[i].value = msg }
  app.on('cast',   d => { phase = 'wait'; if (fishing >= 0) say(fishing, 'Line out — wait for it…') })
  app.on('bite',   d => {
    phase = 'bite'; biteEnds = now() + d.ms
    if (fishing >= 0) { say(fishing, 'STRIKE!  press E'); if (spotAct[fishing]) spotAct[fishing].label = 'STRIKE!' }
  })
  app.on('missed', d => {
    phase = 'idle'
    if (fishing >= 0) { say(fishing, d.why + '  Press E to cast'); if (spotAct[fishing]) spotAct[fishing].label = 'Cast' }
    fishing = -1
  })
  app.on('caught', d => {
    phase = 'idle'
    if (fishing >= 0) {
      say(fishing, d.name + '  +' + d.v)
      if (spotAct[fishing]) spotAct[fishing].label = 'Cast'
      showCatch(d.key)
    }
    fishing = -1
  })
  app.on('got', d => {})
  app.on('ore', d => {})
  app.on('chip', d => {})

  app.on('update', dt => {
    if (held && now() > heldUntil) { held.active = false; held = null }
  })
  // Ask once. The server pushes the register every second afterwards, so
  // polling for it would be the same data twice.
  app.send('hello', {})
}
