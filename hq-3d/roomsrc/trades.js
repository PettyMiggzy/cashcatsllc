/*
 * World of CashCats — the Trades
 *
 * Three things to actually do on the grounds, and one ledger that records
 * them. On lore, because everything in this world is bookkeeping: you do not
 * "get loot", you file a return, and the board on the plaza is the register of
 * who has filed the most.
 *
 *   FISHING  at the Docks   cast, then fight what takes it — hold to lift
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
  { key:'rodSilver', name:'Silver Rod', window:1800, how:'crafted at the Docks shop' },
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

// How long a fight may run, and the shortest one that can be believed. The
// floor is what stops a forged "landed" arriving the instant the fish bites.
const FIGHT_MAX = 40000
// The floor has to sit UNDER the fastest honest catch or it rejects real ones.
// Tension runs 0.35 to 1.0 and the quickest fill is the common's 0.70/sec, so
// a perfect fight is 0.93s and nothing legitimate lands sooner.
const FIGHT_MIN = 500
// The Exchange's limits. Shared rather than server-only: the desk prints the
// listing cap on its own board, and a cap the player is told is not the cap the
// server enforces is worse than not saying.
const MAX_LISTINGS = 6        // per seller, so one whale cannot wallpaper the board
const MAX_PRICE = 1000000

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
/*
 * PARKED GROUND — same switch as lands.js.
 *
 * "Just make a simple world and release it." The Grove, the Seam and the Cat
 * Park are parked; the Docks and the Exchange stay. The helpers below build
 * their node either way and only skip PUTTING it in the world, because
 * callers chain straight off the return -- spotAct.push(action(...)) then
 * set .label on it, text(panel(...)) and so on. Gating creation instead of
 * placement threw on the first one of those.
 */
let BUILDING = true

function prim(type, size, color, pos, opts) {
  opts = opts || {}
  const n = app.create('prim')
  n.type = type; n.size = size; n.color = color
  n.position.set(pos[0], pos[1], pos[2])
  if (opts.rotX) n.rotation.x = opts.rotX
  if (opts.rotY) n.rotation.y = opts.rotY
  if (opts.rotZ) n.rotation.z = opts.rotZ
  if (opts.emissive) n.emissive = opts.emissive
  if (opts.rough !== undefined) n.roughness = opts.rough
  if (opts.metal !== undefined) n.metalness = opts.metal
  if (opts.opacity !== undefined) n.opacity = opts.opacity
  if (opts.tex && props[opts.tex]) n.texture = props[opts.tex].url
  if (opts.solid) n.physics = 'static'
  if (BUILDING) app.add(n)
  return n
}
function model(key, pos, rotY, scale) {
  const prop = props[key]
  if (!prop || !prop.url) return null
  const holder = app.create('group')
  holder.position.set(pos[0], pos[1], pos[2])
  if (rotY) holder.rotation.y = rotY
  if (BUILDING) app.add(holder)
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
  if (BUILDING) app.add(u)
  return u
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
  if (BUILDING) app.add(a)
  return a
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
    // Before the generic backfill, not after. blank() carries coin: 0, so by
    // the time the loop below had run, a ledger written before CashCoin existed
    // already had a coin of 0 and this line could never see it missing -- every
    // player from before the currency landed was being handed a zero balance
    // instead of the total they had already filed.
    if (typeof L.coin !== 'number' || L.coin !== L.coin) L.coin = L.filed || 0
    for (const k in base) if (L[k] === undefined || L[k] === null) L[k] = base[k]
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
  let topRows = []            // recomputed only when the ledger actually moves
  let lastWorld = ''          // last payload broadcast, to skip identical ones
  const pushWorld = (pid) => {
    const nb = [], vb = []
    for (let i = 0; i < NODES.length; i++) nb.push((nodeBack[i] || 0) > now() ? 0 : 1)
    // base36, one character per vein. Cinderlode takes 12 hits and this is a
    // positional string the client reads a character at a time -- as decimal,
    // '12' was two entries and every vein after it was reading its neighbour's
    // state. Anything up to 35 hits now fits in the one slot it is given.
    for (let i = 0; i < VEINS.length; i++) {
      const left = veinState[i].backAt > now() ? 0 : veinState[i].left
      vb.push(Math.min(left, 35).toString(36))
    }
    const bb = [], kk = []
    for (let i = 0; i < BOXES.length; i++) bb.push((boxHold[i] && boxHold[i].until > now()) ? 0 : 1)
    for (let i = 0; i < KNOCKS.length; i++) kk.push((knockBack[i] || 0) > now() ? 0 : 1)
    if (dirty) { topRows = top(); dirty = false }
    const msg = { n: nb.join(''), v: vb.join(''), top: topRows,
                  b: bb.join(''), k: kk.join(''), sun: sunLit.join(',') }
    // A player who just joined needs the state whatever it is; everyone else
    // only needs it when something moved. `book` holds every player who has
    // ever worked a trade, and this was sorting the whole of it and
    // broadcasting the result once a second to a world where, most seconds,
    // nothing at all had changed.
    if (pid) return app.sendTo(pid, 'world', msg)
    const line = JSON.stringify(msg)
    if (line === lastWorld) return
    lastWorld = line
    app.send('world', msg)
  }
  const pushYou = (pid, L) => {
    app.sendTo(pid, 'you', {
      fish: L.fish, forage: L.forage, ore: L.ore, filed: L.filed, best: L.best,
      rod: rodTier(L), pick: pickTier(L), shovel: shovelTier(L), coin: L.coin, gold: L.gold || 0,
      bait: L.bait, onLine: L.onLine,
      kinds: Object.keys(L.kinds).length,
      // What you are holding, per species. The Exchange desk needs this: a
      // seller picks from what they actually have, and there is no keyboard in
      // this engine to type an item name into.
      bags: { fish: L.catches || {}, forage: L.kinds || {} },
      // Told to the client so the VIP room can explain itself, never so the
      // client can decide. Every bet handler re-reads p.tier on the server.
      vip: (world.getPlayer(pid) || {}).tier === 'vip',
    })
  }

  app.on('hello', (d, pid) => {
    const p = world.getPlayer(pid); if (!p) return
    pushYou(pid, ledgerFor(p)); pushWorld(pid); pushMarket(pid); pushVipBook()
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

  /*
   * A bite is the start of a fight, not a reaction test.
   *
   * It used to be: wait, then press E inside a window. That is a metronome,
   * not a game. Now the bite puts a fish on the line with a difficulty and the
   * player has to actually land it -- see the fight loop on the client.
   *
   * The fish is rolled HERE, at the bite, not when it lands. Two reasons: the
   * difficulty being fought has to belong to the fish that is actually on the
   * line, and bait is spent because something took it, which is this moment.
   */
  const beginFight = (pid, p, c, t) => {
    const L = ledgerFor(p)
    let bait = null
    if (L.onLine && (L.bait[L.onLine] || 0) > 0) {
      bait = baitByKey(L.onLine)
      L.bait[L.onLine] -= 1
      if (L.bait[L.onLine] <= 0) {
        delete L.bait[L.onLine]
        // Move to whatever else is in the box rather than leaving the line
        // bare -- the flat Gold Cash Cat chance needs a baited line.
        L.onLine = Object.keys(L.bait)[0] || null
        app.sendTo(pid, 'shop', { msg: L.onLine
          ? 'Last one gone — ' + baitByKey(L.onLine).name + ' on the line now.'
          : 'That was your last bait. The line is bare.' })
      }
    }
    const f = rollFish(rodTier(L), bait)
    c.phase = 'fight'
    c.fish = f
    c.startedAt = t
    c.endAt = t + FIGHT_MAX
    touch()
    app.sendTo(pid, 'bite', { name: f.name, r: f.r, d: fightDifficulty(f, rodTier(L)) })
    pushYou(pid, L)
  }

  /*
   * How hard a fish is to land.
   *
   * Rarity sets it and the rod softens it. `hook` is the share of the track
   * your bar covers, `speed` is how fast the fish swims and `jitter` is how
   * often it changes its mind -- a Penny Perch drifts, a Gold Cash Cat will
   * not sit still for a second. A better rod widens the hook rather than
   * slowing the fish, so gear makes you steadier without making it boring.
   */
  const fightDifficulty = (f, tier) => {
    const byRarity = {}
    // Tuned against a simulated player, not by feel. The first pass landed an
    // Ultra Rare 1% of the time, which -- on top of the 0.5% chance of hooking
    // one at all -- made the Gold Cash Cat a lottery inside a lottery. The
    // fight is meant to be the fun part, not a second gate.
    //
    // Where it sits now, over 400 simulated fights each, wooden rod:
    //   common 84%   uncommon 86%   rare 74%   ultra 50%
    // and with the Gold Rod's wider hook, ultra goes 50% -> 79%. So gear is
    // worth having, every fish can be landed, and the hard ones are a fight.
    byRarity[COMMON]   = { hook: 0.33, speed: 0.38, jitter: 0.9, fill: 0.70, drain: 0.27 }
    byRarity[UNCOMMON] = { hook: 0.32, speed: 0.46, jitter: 1.1, fill: 0.66, drain: 0.28 }
    byRarity[RARE]     = { hook: 0.28, speed: 0.58, jitter: 1.5, fill: 0.58, drain: 0.32 }
    byRarity[ULTRA]    = { hook: 0.25, speed: 0.70, jitter: 1.9, fill: 0.52, drain: 0.36 }
    const b = byRarity[f.r] || byRarity[COMMON]
    return { hook: Math.min(0.42, b.hook + tier * 0.035), speed: b.speed,
             jitter: b.jitter, fill: b.fill, drain: b.drain }
  }

  /*
   * The client reports whether it landed the fish.
   *
   * It cannot be trusted to say yes, so the two things a forged message would
   * get wrong are checked: a fight has to be in progress, and it has to have
   * lasted long enough to have been fought. Everything of value -- which fish,
   * what it pays -- was decided on the server at the bite and is not in this
   * message, so the worst a liar gets is the fish they already hooked.
   */
  app.on('land', (d, pid) => {
    const c = casts[pid]
    const p = world.getPlayer(pid)
    if (!c || !p) return
    if (c.phase !== 'fight') {
      delete casts[pid]
      app.sendTo(pid, 'missed', { why: 'Too early — you spooked it.' })
      return
    }
    const held = now() - c.startedAt
    delete casts[pid]
    if (!(d && d.ok) || held < FIGHT_MIN) {
      app.sendTo(pid, 'missed', { why: held < FIGHT_MIN ? 'It shook the hook.' : 'It got away.' })
      return
    }
    const L = ledgerFor(p)
    const f = c.fish
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
    /*
     * Pay per swing, not on the last one.
     *
     * A vein's progress is one shared number for the whole server, and the
     * whole seam.v went to whoever happened to land the killing blow. So four
     * people chipping a vein down and a fifth walking up to tap it once meant
     * the fifth took everything and the four got nothing at all — and ore
     * gates the Silver Rod, so it is not a rounding matter.
     *
     * Splitting by contribution needs a per-vein ledger of who hit what;
     * paying each swing its share gets the same answer for anyone who works a
     * vein alone, gives a thief exactly one swing's worth, and needs no state.
     */
    grant(L, Math.round(seam.v / seam.hits))
    if (st.left > 0) {
      app.sendTo(pid, 'chip', { left: st.left, name: seam.name })
      touch()
      pushYou(pid, L)
    } else {
      st.backAt = now() + RESEAM
      st.left = seam.hits
      L.ore += 1
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
    const L = ledgerFor(p)
    // Per player, not just per box. The box hold on its own only stopped you
    // sitting in the SAME box twice, and there are nine of them in a row -- a
    // lap of the park paid 36 CashCoin for thirty seconds of walking, which is
    // two to three times what any of the three trades pays for the same time.
    if ((L.sitAt || 0) > now()) {
      app.sendTo(pid, 'shop', { msg: 'You have only just got out of a box.' })
      return
    }
    L.sitAt = now() + BOX_HOLD
    boxHold[i] = { until: now() + BOX_HOLD, who: pid }
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
    const L = ledgerFor(p)
    if ((L.knockAt || 0) > now()) {
      app.sendTo(pid, 'shop', { msg: 'Let it settle first.' })
      return
    }
    L.knockAt = now() + KNOCK_BACK
    knockBack[i] = now() + KNOCK_BACK
    L.park = (L.park || 0) + 1
    grant(L, KNOCK_PAY)
    touch()
    app.sendTo(pid, 'shop', { msg: 'It fell off. +' + KNOCK_PAY + ' CashCoin.' })
    pushYou(pid, L); dirty = true
  })

  /* ================================================================== *
   * THE EXCHANGE — brokers, and the first player-to-player trade         *
   * ==================================================================
   *
   * Everything in this world until now was player-to-NPC: you sold to a
   * counter at a fixed price the code decided. A world of brokers is the other
   * thing entirely -- players setting their own prices and buying from each
   * other -- and none of that existed.
   *
   * WHY IT LIVES IN trades.js AND NOT ITS OWN ROOM FILE.
   *
   * The market moves goods and coin between ledgers, and the ledger is
   * ccl.ledger.v1, which this app owns. Two apps writing one storage key
   * clobber each other: each holds its own copy in memory and saves on its own
   * clock, so the later save silently reverts the earlier one. A market in a
   * separate app would lose trades at random and look like theft. One app, one
   * writer. The listings get their own key, which is fine -- one app writing
   * two keys is safe, two apps writing one key is not.
   *
   * ESCROW. Listing removes the goods from the seller's ledger immediately.
   * Without that a seller can list the same fish on ten stalls and sell it ten
   * times, and the tenth buyer pays for nothing. The goods sit in the listing
   * until it sells or is cancelled.
   */
  const MKT = 'ccl.market.v1'
  let market = world.get(MKT) || { seq: 1, rows: [] }
  const saveMkt = () => world.set(MKT, market)

  // What can be brokered, and where it lives on a ledger. Coin is deliberately
  // absent -- coin is the price, not the goods.
  const GOODS = {
    fish:   { bag: 'catches', label: k => (FISH.find(f => f.key === k) || {}).name || k },
    forage: { bag: 'kinds',   label: k => (FORAGE.find(f => f.key === k) || {}).name || k },
  }

  const held = (L, kind, key) => {
    const g = GOODS[kind]
    if (!g) return 0
    const bag = L[g.bag] || {}
    return bag[key] || 0
  }
  const take = (L, kind, key, n) => {
    const bag = L[GOODS[kind].bag] || (L[GOODS[kind].bag] = {})
    bag[key] = (bag[key] || 0) - n
    if (bag[key] <= 0) delete bag[key]
  }
  const give = (L, kind, key, n) => {
    const bag = L[GOODS[kind].bag] || (L[GOODS[kind].bag] = {})
    bag[key] = (bag[key] || 0) + n
  }

  /*
   * A player id is not a user id.
   *
   * app.sendTo() and world.getPlayer() both key on the ENTITY id -- the
   * per-session network id -- while the ledger and every market row key on the
   * userId, so a tally survives a reconnect. Handing one to the other returns
   * undefined and returns quietly, which is exactly what the seller's "your
   * fish sold" notice was doing: nothing, every time, with no error.
   */
  const playerByUser = uid => {
    if (!uid) return null
    const ps = world.getPlayers()
    for (let i = 0; i < ps.length; i++) if ((ps[i].userId || ps[i].id) === uid) return ps[i]
    return null
  }

  // Eight, because there are eight stalls on the floor to put them on. The
  // OLDEST listings are the ones that show -- surfacing the newest would let a
  // seller bump their own row to the front by relisting.
  //
  // `mine` is worked out here, per recipient, rather than shipping every row's
  // owner to every client and letting each one compare. The stall needs to know
  // whose listing it is showing; nobody else's account id needs to be on the
  // wire for that.
  const marketRows = uid => market.rows.slice(0, 8).map(r => ({
    id: r.id, name: r.name, qty: r.qty, price: r.price,
    seller: r.byName, kind: r.kind, key: r.key, mine: r.by === uid,
  }))
  const pushMarket = pid => {
    if (pid) {
      const p = world.getPlayer(pid)
      return app.sendTo(pid, 'market', { rows: marketRows(p && (p.userId || p.id)) })
    }
    const ps = world.getPlayers()
    for (let i = 0; i < ps.length; i++) {
      app.sendTo(ps[i].id, 'market', { rows: marketRows(ps[i].userId || ps[i].id) })
    }
  }

  app.on('list', (d, pid) => {
    const p = world.getPlayer(pid); if (!p) return
    const uid = p.userId || p.id
    const kind = d && d.kind, key = d && d.key
    const qty = Math.max(1, Math.min(999, Math.floor(Number(d && d.qty) || 0)))
    const price = Math.max(1, Math.min(MAX_PRICE, Math.floor(Number(d && d.price) || 0)))
    if (!GOODS[kind] || !key || !qty || !price) return
    const L = ledgerFor(p)
    if (held(L, kind, key) < qty)
      return app.sendTo(pid, 'shop', { msg: 'You do not have ' + qty + ' of those.' })
    if (market.rows.filter(r => r.by === uid).length >= MAX_LISTINGS)
      return app.sendTo(pid, 'shop', { msg: 'Six listings at a time. Cancel one first.' })
    take(L, kind, key, qty)                       // escrow, before anything else
    market.rows.push({ id: market.seq++, by: uid, byName: p.name || '?',
                       kind, key, name: GOODS[kind].label(key), qty, price, at: now() })
    saveMkt(); touch()
    app.sendTo(pid, 'shop', { msg: 'Listed ' + qty + ' x ' + GOODS[kind].label(key) +
                                   ' at ' + price + ' each.' })
    pushYou(pid, L); pushMarket()
  })

  app.on('unlist', (d, pid) => {
    const p = world.getPlayer(pid); if (!p) return
    const uid = p.userId || p.id
    const i = market.rows.findIndex(r => r.id === (d && d.id | 0))
    if (i < 0) return
    const r = market.rows[i]
    if (r.by !== uid) return app.sendTo(pid, 'shop', { msg: 'Not your listing.' })
    market.rows.splice(i, 1)
    give(ledgerFor(p), r.kind, r.key, r.qty)      // escrow comes home
    saveMkt(); touch()
    app.sendTo(pid, 'shop', { msg: 'Pulled ' + r.qty + ' x ' + r.name + ' off the board.' })
    pushYou(pid, ledgerFor(p)); pushMarket()
  })

  app.on('buy_listing', (d, pid) => {
    const p = world.getPlayer(pid); if (!p) return
    const uid = p.userId || p.id
    const i = market.rows.findIndex(r => r.id === (d && d.id | 0))
    if (i < 0) return app.sendTo(pid, 'shop', { msg: 'Gone — someone got there first.' })
    const r = market.rows[i]
    if (r.by === uid) return app.sendTo(pid, 'shop', { msg: 'That is your own listing.' })
    const B = ledgerFor(p)
    const total = r.qty * r.price
    if (B.coin < total)
      return app.sendTo(pid, 'shop', { msg: 'That costs ' + comma(total) + ' CashCoin. You have ' + comma(B.coin) + '.' })
    // Remove the row BEFORE moving anything. Two buyers hitting the same
    // listing in one tick would otherwise both pass the checks above and both
    // get paid out of one escrow.
    market.rows.splice(i, 1)
    B.coin -= total
    give(B, r.kind, r.key, r.qty)
    // The seller is credited whether or not they are online -- the goods left
    // their ledger when they listed, so not paying them would be taking it.
    if (!book[r.by]) book[r.by] = blank()
    book[r.by].coin = (book[r.by].coin || 0) + total
    saveMkt(); touch()
    app.sendTo(pid, 'shop', { msg: 'Bought ' + r.qty + ' x ' + r.name + ' for ' + comma(total) + '.' })
    const sp = playerByUser(r.by)
    if (sp) app.sendTo(sp.id, 'shop', { msg: p.name + ' bought your ' + r.name + ' — ' + comma(total) + ' CashCoin.' })
    pushYou(pid, B); if (sp) pushYou(sp.id, book[r.by])
    pushMarket(); dirty = true
  })


  /* ================================================================== *
   * THE VIP FLOOR — three tables, and the only tier check that is real  *
   * ==================================================================
   *
   * The room is drawn by vip.js. The money is here, because the money is
   * always here: ccl.ledger.v1 has one writer and this is it. See the header
   * of vip.js for why a second app touching that key loses people's balances
   * on a fresh world.
   *
   * WHAT "VIP" MEANS. holderGate reads the wallet's balance once, at the door,
   * and puts 'vip' on the socket at 10,000,000 $CASHCATSLLC. Until now nothing
   * could read that, so the Vault's gate was a prop. p.tier reads it now, and
   * every handler below checks it before it moves a coin -- not the client,
   * not the rope, not the walls. A player who walks in through the wall finds
   * three tables that will not deal to them.
   *
   * With the gate switched off (GATE_ENABLED unset, which is every dev box)
   * ServerNetwork hands everyone 'vip'. That is right: a world with no gate
   * should not have one room nobody can enter.
   *
   * WHAT IS AT STAKE. CashCoin and Gold Cash Cats, both earned by playing,
   * both living only in this server's ledger. Nothing here reads or writes a
   * chain. The token is checked at the door and never touched again, and there
   * is deliberately no path from a pile of CashCoin back out to anything.
   */
  const VIP = 'ccl.vip.v1'
  let vipBook = world.get(VIP) || { staked: 0, paid: 0, plays: 0, goldIn: 0, goldOut: 0 }
  const saveVip = () => world.set(VIP, vipBook)

  /*
   * Stakes are multiples of 20 for a reason: every payout below is an exact
   * whole number of CashCoin at every one of them. The wheel's trio pays 2.85x
   * and 50 x 2.85 is 142.5, which either rounds -- quietly handing the player
   * or the house half a coin a spin -- or turns the ledger into floats. 40,
   * 200, 1000, 5000 and 25000 all divide cleanly by 20, so nothing rounds.
   */
  const VIP_STAKES = [40, 200, 1000, 5000, 25000]
  const DICE_PAY = 1.9              // on a win; a tie returns the stake
  const HIGH_ANTE = 1               // Gold Cash Cats, per hand
  const VIP_COOL = 600              // ms between plays, per player

  /*
   * The wheel. Twelve pockets, and three ways to back one.
   *
   * Every payout is set so the return is 95% of the stake whichever way you
   * bet -- 1.9x on a 6-in-12, 2.85x on a 4-in-12, 11.4x on a 1-in-12. A wheel
   * whose outside bets are safer than its inside bets is a wheel that punishes
   * people for the bet they find exciting, and there is no reason for it here.
   */
  const WHEEL_N = 12
  const WHEEL_BETS = [
    { key: 'gold',  label: 'Gold',   pay: 1.9,  hits: n => n % 2 === 1 },
    { key: 'black', label: 'Black',  pay: 1.9,  hits: n => n % 2 === 0 },
    { key: 't1',    label: '1 to 4', pay: 2.85, hits: n => n <= 4 },
    { key: 't2',    label: '5 to 8', pay: 2.85, hits: n => n >= 5 && n <= 8 },
    { key: 't3',    label: '9 to 12', pay: 2.85, hits: n => n >= 9 },
    { key: 'one',   label: 'One number', pay: 11.4, hits: (n, pick) => n === pick },
  ]

  const d6 = () => 1 + Math.floor(Math.random() * 6)
  const roll2 = () => d6() + d6()
  const roll3 = () => d6() + d6() + d6()

  const vipCool = {}

  /*
   * One gate, one place. Returns the ledger to play off, or null having
   * already told the player why not.
   */
  const vipSeat = (pid, cool) => {
    const p = world.getPlayer(pid)
    if (!p) return null
    if (p.tier !== 'vip') {
      app.sendTo(pid, 'vip', { msg: 'The tables only deal to 10,000,000 holders.' })
      return null
    }
    if (cool !== false) {
      const t = now()
      if ((vipCool[pid] || 0) > t) return null
      vipCool[pid] = t + VIP_COOL
    }
    return { p: p, L: ledgerFor(p) }
  }

  const stakeAt = i => VIP_STAKES[Math.max(0, Math.min(VIP_STAKES.length - 1, i | 0))]

  app.on('vip_dice', (d, pid) => {
    const seat = vipSeat(pid); if (!seat) return
    const L = seat.L
    const stake = stakeAt(d && d.s)
    if (L.coin < stake)
      return app.sendTo(pid, 'vip', { msg: 'That is ' + comma(stake) + ' CashCoin. You have ' + comma(L.coin) + '.' })

    const you = roll2(), them = roll2()
    let delta = 0, outcome = 'push'
    if (you > them) { delta = Math.round(stake * DICE_PAY) - stake; outcome = 'win' }
    else if (you < them) { delta = -stake; outcome = 'lose' }

    L.coin += delta
    // The book counts the whole stake through it, not the net -- a table that
    // reports only its winnings is not reporting its edge.
    vipBook.plays += 1
    vipBook.staked += stake
    vipBook.paid += stake + delta
    saveVip(); touch()
    app.sendTo(pid, 'vip', {
      table: 'dice', you: you, them: them, delta: delta, outcome: outcome,
      msg: outcome === 'win' ? 'You rolled ' + you + ' against ' + them + '. +' + comma(delta) + '.'
         : outcome === 'lose' ? 'You rolled ' + you + ' against ' + them + '. -' + comma(stake) + '.'
         : 'Both rolled ' + you + '. Your stake comes back.',
    })
    pushYou(pid, L); pushVipBook(); dirty = true
  })

  app.on('vip_wheel', (d, pid) => {
    const seat = vipSeat(pid); if (!seat) return
    const L = seat.L
    const stake = stakeAt(d && d.s)
    const bet = WHEEL_BETS[Math.max(0, Math.min(WHEEL_BETS.length - 1, (d && d.b) | 0))]
    const pick = Math.max(1, Math.min(WHEEL_N, (d && d.n) | 0 || 1))
    if (L.coin < stake)
      return app.sendTo(pid, 'vip', { msg: 'That is ' + comma(stake) + ' CashCoin. You have ' + comma(L.coin) + '.' })

    const pocket = 1 + Math.floor(Math.random() * WHEEL_N)
    const won = bet.hits(pocket, pick)
    const delta = won ? Math.round(stake * bet.pay) - stake : -stake

    L.coin += delta
    vipBook.plays += 1
    vipBook.staked += stake
    vipBook.paid += stake + delta
    saveVip(); touch()
    app.sendTo(pid, 'vip', {
      table: 'wheel', pocket: pocket, delta: delta, outcome: won ? 'win' : 'lose',
      msg: 'Pocket ' + pocket + ' — ' + (pocket % 2 ? 'Gold' : 'Black') + '. ' +
           (won ? '+' + comma(delta) + '.' : '-' + comma(stake) + '.'),
    })
    pushYou(pid, L); pushVipBook(); dirty = true
  })

  app.on('vip_high', (d, pid) => {
    const seat = vipSeat(pid); if (!seat) return
    const L = seat.L
    if ((L.gold || 0) < HIGH_ANTE)
      return app.sendTo(pid, 'vip', { msg: 'The High Table wants a Gold Cash Cat. You have none.' })

    const you = roll3(), them = roll3()
    let delta = 0, outcome = 'push'
    if (you > them) { delta = HIGH_ANTE; outcome = 'win' }
    else if (you < them) { delta = -HIGH_ANTE; outcome = 'lose' }

    L.gold = (L.gold || 0) + delta
    vipBook.plays += 1
    if (delta > 0) vipBook.goldOut += delta
    if (delta < 0) vipBook.goldIn += -delta
    saveVip(); touch()
    app.sendTo(pid, 'vip', {
      table: 'high', you: you, them: them, delta: delta, outcome: outcome,
      msg: outcome === 'win' ? you + ' against ' + them + '. A Gold Cash Cat to you.'
         : outcome === 'lose' ? you + ' against ' + them + '. The house takes it.'
         : 'Both on ' + you + '. Nobody moves.',
    })
    if (outcome === 'win') world.chat(seat.p.name + ' took a Gold Cash Cat off the High Table.', true)
    pushYou(pid, L); pushVipBook(); dirty = true
  })

  const pushVipBook = () => app.send('vipbook', {
    plays: vipBook.plays, staked: vipBook.staked, paid: vipBook.paid,
    goldIn: vipBook.goldIn, goldOut: vipBook.goldOut,
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
        beginFight(pid, p, c, t)
      } else if (c.phase === 'fight' && t >= c.endAt) {
        delete casts[pid]
        app.sendTo(pid, 'missed', { why: 'You lost it. The line went slack.' })
      }
    }
    if (now() > sunAt) { rollSun(); dirty = true }
    acc += dt
    if (acc >= 1.0) {
      acc = 0
      pushWorld()
      if (saveAt && now() > saveAt) { world.set(KEY, book); saveAt = 0 }
    }
  })
}

/* ================================================================== *
 * CLIENT — draws it, and sends only intent                            *
 * ================================================================== */
if (!isServer) {

  const me = { fish:0, forage:0, ore:0, filed:0, best:0, rod:0, pick:0, kinds:0, coin:0, bait:{}, onLine:null, gold:0, shovel:0, bags:{}, vip:false }
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
    // Cast, and nothing else. The fight that follows is played with the mouse,
    // not with this -- pressing E mid-fight used to send a 'strike' the server
    // no longer has a handler for, which would have been a dead key and a
    // silent nothing. During a fight the action stands down.
    spotAct.push(action('Cast', [s.x, s.y + 1.2, s.z], 4.5, 0.35, () => {
      if (phase !== 'idle') return
      fishing = i
      app.send('cast', { s: i })
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
  // One holder per species, kept and reused. Every catch used to build a fresh
  // group, load the model into it again, and hide the previous one without
  // ever removing it -- an hour on the jetty left a few hundred invisible fish
  // parented to the app, each holding its own loaded tree.
  const heldPool = {}
  let held = null, heldUntil = 0
  const showCatch = key => {
    if (held) held.active = false
    if (!heldPool[key]) heldPool[key] = model(key, [0, -50, 0], 0, 1.1)
    held = heldPool[key]
    if (!held) return
    const s = SPOTS[Math.max(fishing, 0)]
    held.position.set(s.x, s.y + 2.2, s.z - 0.6)
    held.active = true
    heldUntil = now() + 4200
  }

  /*
   * THE GROVE AND THE SEAM STAY OPEN.
   *
   * They were parked with everything else, and parking them broke the game
   * shut. The Silver Rod costs 40 ore and 25 gathered; a Gold Cash Cat needs a
   * Silver rod or better; the Gold Rod costs a Gold Cash Cat; Ultra Rare fish
   * need the Gold Rod. With no ore and nothing to gather, every one of those
   * is unreachable and a player tops out on the Wooden Rod during their first
   * cast. The Exchange had the same hole -- it brokers fish AND forage, and
   * half of it would have had no supply at all.
   *
   * They are also not what made the world feel crowded. Twelve nodes and eight
   * veins, out on their own roads at x +-47, against a village of several
   * hundred props on the plaza. The buildings were the weight.
   */
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

  BUILDING = false   // parked
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
    const g = model('hq_cardboard_box_01', [b.x, 0, b.z], (i % 4) * 0.4, 2.6)
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
  // The Cat Park ends HERE. This switch used to sit two hundred lines further
  // down, past the register and every rule sheet in the world -- so parking the
  // park quietly took the plaza's Register board and all four ground sheets
  // with it. A park switch has to close on the thing it opened on.
  BUILDING = true    // back on

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

  /* ================================================================== *
   * THE EXCHANGE — the trading floor                                    *
   * ==================================================================
   *
   * The market has had working handlers for a while -- list, unlist, buy,
   * escrowed, conserved, tested -- and no way for a player to reach any of
   * them. This is the floor those handlers were always for.
   *
   * It stands where the Workshop used to, on the open plaza rather than behind
   * a door. A market you can see from spawn is a market people use; one you
   * have to be told about is a menu.
   *
   * WHY STALLS AND NOT A LIST. Only ONE action can be active at a time in this
   * engine -- ClientActions picks the single nearest node within its own
   * distance and ignores the rest -- so eight "Buy" buttons stacked down the
   * face of one board would be eight prompts fighting over the same metre of
   * space. Giving every listing its own stall along a street turns choosing
   * what to buy into walking up to it, which is the thing a 3D world can do
   * that a list cannot.
   *
   * WHY EVERY NUMBER IS A CLICK. app.control() cannot bind a keyboard key in
   * this engine -- the `key:` line in ClientControls' controlTypes is commented
   * out -- so there is no way to type a price. The desk cycles through ladders
   * instead: quantities you might actually hold, and prices as multiples of
   * what the Filing Office pays for the same item. That last part is the whole
   * economy in one line -- the Office is the floor, and the Exchange is where
   * you beat it.
   */
  const EX_X = 21                       // the old Workshop's centre line
  /*
   * The aisle has to be wider than the camera is long.
   *
   * A canopied stall measures 2.7 x 3.3 x 2.7 at kit scale, and the chase
   * camera sits about four metres behind the player. With the ranks 7.6m apart
   * that put the camera INSIDE a stall the moment anyone turned to look at one
   * -- the whole screen filled with the back of a green awning. Eleven metres
   * between ranks leaves eight metres of clear aisle, which is the first number
   * here that was measured rather than guessed.
   */
  const EX_L = 15.6, EX_R = 26.4        // the two ranks, 10.8m apart
  const EX_ROW = [5.4, 1.8, -1.8, -5.4] // four stalls a side, eight listings
  const DESK_Z = -9.6
  const KIT = 2.7                       // the town kit's world scale

  /* the street */
  prim('box', [15.4, 0.3, 20.2], '#c8c1ae', [EX_X, -0.10, -1.3], { tex: 'paving', rough: 0.95 })
  prim('box', [16.1, 0.06, 20.8], '#b3ac99', [EX_X, -0.02, -1.3], { rough: 1.0 })
  for (let i = 0; i < 6; i++)
    prim('box', [15.4, 0.04, 0.26], '#b3ac99', [EX_X, 0.06, -9.6 + i * 3.4])

  /* the way in — an arch you walk under, so the street has a threshold */
  for (const sx of [-1, 1]) {
    const x = EX_X + sx * 5.4              // in line with the ranks behind them
    prim('box', [1.15, 0.5, 1.15], '#cfc9b8', [x, 0.25, 7.8], { rough: 0.9 })
    prim('cylinder', [0.42, 0.42, 5.1], '#d6cfbd', [x, 3.05, 7.8], { rough: 0.85 })
    prim('box', [1.05, 0.34, 1.05], '#cfc9b8', [x, 5.77, 7.8], { rough: 0.9 })
    model('t_lantern', [x + sx * 1.0, 0, 7.8], 0, KIT)
  }
  prim('box', [12.4, 0.62, 1.0], '#d6cfbd', [EX_X, 6.25, 7.8], { rough: 0.85 })
  prim('box', [12.8, 0.16, 1.2], GOLD, [EX_X, 6.64, 7.8], { metal: 0.75, rough: 0.35 })

  const exSign = panel(5.6, 0.9, 0.005, [EX_X, 6.25, 8.33], 0, 'rgba(24,20,10,0.94)', GOLD)
  exSign.alignItems = 'center'
  text(exSign, 'THE EXCHANGE', 58, GOLD_L, 800)

  /* what it is, angled at whoever is walking up to it */
  const exHow = panel(3.6, 2.9, 0.005, [EX_X - 9.6, 2.7, 7.2], 0.55, 'rgba(12,18,15,0.93)', GOLD)
  text(exHow, 'THE EXCHANGE', 40, GOLD_L, 800)
  text(exHow, 'Players sell to players here.', 22, CREAM, 400, 10)
  text(exHow, 'Every stall on the street is one', 21, CREAM, 400, 10)
  text(exHow, 'listing. Walk up to it and buy it.', 21, CREAM, 400, 2)
  text(exHow, 'The desk at the end is where you', 21, CREAM, 400, 10)
  text(exHow, 'put something up yourself.', 21, CREAM, 400, 2)
  text(exHow, 'The Filing Office pays a fixed price', 20, LIME, 400, 12)
  text(exHow, 'for everything. That is the floor.', 20, LIME, 400, 2)
  text(exHow, 'This is where you beat it.', 20, LIME, 700, 2)
  text(exHow, 'Listing holds the goods in escrow', 19, DIM, 400, 10)
  text(exHow, 'until it sells or you take it back.', 19, DIM, 400, 2)

  /* ---- the stalls, one per listing ---- */
  const EX_KIT = ['t_stallGrn', 't_stallRed', 't_stall', 't_stallGrn']
  const exStall = []
  let mrows = []

  const exBuy = i => {
    const r = mrows[i]; if (!r) return
    // Your own stall is where you take it back from. A separate "cancel"
    // control at the desk would need you to remember which of six rows you
    // meant, with no way to point at one.
    if (r.mine) app.send('unlist', { id: r.id })
    else app.send('buy_listing', { id: r.id })
  }

  for (let side = 0; side < 2; side++) {
    const sx = side ? 1 : -1
    const x = side ? EX_R : EX_L
    /*
     * A UI plane and a kit model do NOT share a forward axis.
     *
     * A ui node is a plane whose normal is +Z, so at rotY 0 it faces +Z. The
     * town kit's stalls are modelled facing -Z, so the same rotY turns them the
     * opposite way. Rotating both by one angle put every awning's back to the
     * aisle: a long beige wall behind eight readable price boards.
     */
    const rot = sx * -Math.PI / 2          // panels: face the aisle
    const mrot = rot + Math.PI             // models: same heading, other axis
    for (let j = 0; j < EX_ROW.length; j++) {
      const z = EX_ROW[j], idx = side * EX_ROW.length + j
      model(EX_KIT[j], [x, 0, z], mrot, KIT)
      // No bench in front of each one. Rotated, the kit bench is 2.5m long and
      // reached halfway across the aisle, and eight of them in two facing rows
      // made the street read as a waiting room rather than a market.
      // The stall's own counter is what the player walks up to.
      // Mounted ON the stall's front, not hung two metres out in the aisle.
      // At 2.7 x 1.8 and standing proud of the canopy these boards hid the
      // stalls they were labelling -- the street read as eight black slabs
      // floating over empty paving. The canopy face is 1.35m from the rank
      // line, so 1.5 clears it by a hand's width and no more.
      // 3.6, not 2.85: the awning peaks at 3.3, and a board hung at counter
      // height covered the one part of the stall that says which stall it is.
      // A market sign goes above the canopy.
      const u = panel(2.4, 1.35, 0.0038, [x - sx * 1.5, 3.6, z], rot,
                      'rgba(18,26,22,0.92)', GOLD)
      const s = {
        name: text(u, '', 34, GOLD_L, 800),
        qty:  text(u, '', 26, CREAM, 700, 8),
        tot:  text(u, '', 22, DIM, 400, 4),
        who:  text(u, '', 20, DIM, 400, 6),
        act:  action('', [x - sx * 2.3, 1.3, z], 2.6, 0.4, () => exBuy(idx)),
      }
      exStall.push(s)
    }
  }

  /* ---- the desk, at the head of the street ---- */
  model('t_stall',     [EX_X, 0, DESK_Z], 0, KIT)
  model('t_stallBnch', [EX_X, 0, DESK_Z + 1.5], 0, KIT)
  model('crate',  [EX_X - 3.4, 0, DESK_Z + 0.6], 0.4, 1.0)
  model('barrel', [EX_X + 3.4, 0, DESK_Z + 0.6], 0.2, 1.05)

  const desk = panel(4.6, 3.5, 0.005, [EX_X, 3.1, DESK_Z + 0.35], 0,
                     'rgba(24,20,10,0.94)', GOLD)
  text(desk, 'THE DESK', 46, GOLD_L, 800)
  text(desk, 'Put something on a stall.', 22, DIM, 400, 4)
  const dItem  = text(desk, '', 32, CREAM, 700, 14)
  const dHave  = text(desk, '', 22, DIM, 400, 4)
  const dDeal  = text(desk, '', 28, LIME, 700, 12)
  const dFloor = text(desk, '', 21, DIM, 400, 4)
  const dSlots = text(desk, '', 21, DIM, 400, 10)
  const dMsg   = text(desk, 'Nothing listed yet.', 21, CREAM, 400, 10)

  /*
   * The ladders. Quantity in steps someone might actually hold, price as a
   * multiple of what the Office pays -- so the seller is choosing a margin
   * rather than guessing at a number in the dark.
   */
  const EX_QTY = [1, 3, 5, 10, 25, 0]        // 0 means all of them
  const EX_MULT = [0.5, 0.8, 1, 1.25, 1.5, 2, 3, 5, 10]
  let selItem = 0, selQty = 0, selMult = 4

  // Walk the tables, not the bag: the order stays put as counts change, so
  // "next item" does not jump around underneath you mid-click. Anything in the
  // bag that is not a listed good simply never appears, which is correct.
  const stock = () => {
    const out = []
    const bags = me.bags || {}
    const add = (kind, table) => {
      const bag = bags[kind] || {}
      for (let i = 0; i < table.length; i++) {
        const t = table[i]
        if (bag[t.key] > 0) out.push({ kind: kind, key: t.key, name: t.name, v: t.v, r: t.r, have: bag[t.key] })
      }
    }
    add('fish', FISH)
    add('forage', FORAGE)
    return out
  }
  const askQty = it => {
    const n = EX_QTY[selQty]
    return Math.max(1, Math.min(it.have, n === 0 ? it.have : n))
  }
  const askPrice = it => Math.max(1, Math.round(it.v * EX_MULT[selMult]))

  const cycle = (which) => {
    const st = stock()
    if (which === 'item') selItem = st.length ? (selItem + 1) % st.length : 0
    if (which === 'qty') selQty = (selQty + 1) % EX_QTY.length
    if (which === 'price') selMult = (selMult + 1) % EX_MULT.length
    paint()
  }
  action('Show me the next thing I have', [EX_X - 3.3, 1.3, DESK_Z + 2.1], 2.4, 0.2, () => cycle('item'))
  action('Change how many',               [EX_X - 1.1, 1.3, DESK_Z + 2.1], 2.4, 0.2, () => cycle('qty'))
  action('Change the price',              [EX_X + 1.1, 1.3, DESK_Z + 2.1], 2.4, 0.2, () => cycle('price'))
  action('Put it on a stall',             [EX_X + 3.3, 1.3, DESK_Z + 2.1], 2.4, 0.5, () => {
    const st = stock()
    const it = st[selItem]
    if (!it) return
    app.send('list', { kind: it.kind, key: it.key, qty: askQty(it), price: askPrice(it) })
  })

  const paintEx = () => {
    /* the stalls */
    let mine = 0
    for (let i = 0; i < exStall.length; i++) {
      const s = exStall[i], r = mrows[i]
      if (!r) {
        s.name.value = '— OPEN —'; s.name.color = DIM
        s.qty.value = 'Anything listed at the'
        s.tot.value = 'desk shows up here.'
        s.who.value = ''
        s.act.active = false
        continue
      }
      if (r.mine) mine++
      const total = r.qty * r.price
      s.name.value = r.name
      s.name.color = r.mine ? LIME : GOLD_L
      s.qty.value = r.qty + ' at ' + comma(r.price) + ' each'
      s.tot.value = comma(total) + ' CashCoin the lot'
      s.who.value = r.mine ? 'yours' : r.seller
      s.act.active = true
      s.act.label = r.mine ? ('Take your ' + r.name + ' back')
                           : ('Buy ' + r.qty + ' × ' + r.name + ' — ' + comma(total))
    }

    /* the desk */
    const st = stock()
    if (selItem >= st.length) selItem = 0
    const it = st[selItem]
    if (!it) {
      dItem.value = 'Nothing to sell yet'
      dItem.color = DIM
      dHave.value = 'Fish at the Docks, gather at the Grove.'
      dDeal.value = ''
      dFloor.value = ''
    } else {
      const q = askQty(it), pr = askPrice(it)
      dItem.value = it.name
      dItem.color = RARITY_COLOR[it.r] || CREAM
      dHave.value = it.have + ' in hand' + (st.length > 1 ? '  ·  ' + st.length + ' kinds to choose from' : '')
      dDeal.value = q + ' at ' + comma(pr) + ' each  —  ' + comma(q * pr) + ' CashCoin'
      dFloor.value = 'The Office pays ' + comma(it.v) + ' each, so ' +
                     comma(it.v * q) + ' for the same lot.'
    }
    dSlots.value = mine + ' of your ' + MAX_LISTINGS + ' stalls in use'
  }

  // The server answers every market action on the 'shop' channel, and the only
  // place that showed was the sign at the Docks -- forty metres from where the
  // player who caused it is standing. Both boards say it now.
  app.on('shop', d => { if (d && d.msg) dMsg.value = d.msg })
  app.on('market', d => {
    const uid = (world.getPlayer() || {}).userId
    mrows = (d && d.rows) || []
    for (let i = 0; i < mrows.length; i++) mrows[i].mine = !!uid && mrows[i].by === uid
    paintEx()
    paintVip()
  })

  /* ================================================================== *
   * THE VIP FLOOR — the tables                                          *
   * ==================================================================
   *
   * vip.js draws the room: walls, floor, roof, rope, the rules on the wall.
   * Everything that can CHANGE is here, next to the handlers that change it.
   *
   * The room is 16 x 16 at the origin with its door in the +Z wall, and the
   * rope crosses at z 4.6. Those numbers are shared with vip.js by being
   * written down in both places; moving one without the other puts a table
   * through a wall.
   *
   * WHY THE CONTROLS ARE SPREAD OUT. Only one action is ever live -- the
   * engine picks the single nearest node within its own distance and ignores
   * every other -- so a neat cluster of buttons is a cluster you cannot pick
   * from. Each table gets a rail: controls 2.4m apart with a 1.6m reach, so
   * standing in front of one selects it and nothing else.
   */
  const VIP_STAKES_C = [40, 200, 1000, 5000, 25000]
  const WHEEL_LABELS = ['Gold', 'Black', '1 to 4', '5 to 8', '9 to 12', 'One number']
  const WHEEL_PAYS   = ['1.9x', '1.9x', '2.85x', '2.85x', '2.85x', '11.4x']
  const WHEEL_N_C = 12
  const GOLD_D_C = '#6b4f16', BLACK_C = '#26221b', FELT_C = '#123a2a'

  const vipSel = { stake: 0, bet: 0, num: 7 }
  let vipBookC = null

  const stakeText = () => comma(VIP_STAKES_C[vipSel.stake]) + ' CashCoin'

  /* ---------------- the dice pit ---------------- */
  const DICE_X = -4.6, DICE_Z = 0.5
  prim('cylinder', [0.55, 0.7, 0.95], GOLD_D_C, [DICE_X, 0.48, DICE_Z], { metal: 0.7, rough: 0.42 })
  prim('cylinder', [1.65, 1.65, 0.16], '#3a2f1e', [DICE_X, 1.02, DICE_Z], { rough: 0.8, solid: true })
  prim('cylinder', [1.5, 1.5, 0.06], FELT_C, [DICE_X, 1.11, DICE_Z], { rough: 0.95 })
  // A torus is modelled in the XY plane, so it stands up like a wheel unless
  // it is laid down. This is the rim of a table.
  prim('torus', [1.62, 0.09], GOLD, [DICE_X, 1.12, DICE_Z],
       { metal: 0.85, rough: 0.3, rotX: Math.PI / 2 })
  // two dice sitting on the felt, turned so they read as objects and not pips
  const diceVis = []
  for (let i = 0; i < 2; i++) {
    diceVis.push(prim('box', [0.3, 0.3, 0.3], '#f2ece0',
                      [DICE_X - 0.4 + i * 0.8, 1.29, DICE_Z + 0.3], { rough: 0.5, rotY: 0.5 + i }))
  }

  const dBoard = panel(3.5, 2.5, 0.0044, [DICE_X, 2.85, DICE_Z - 1.9], 0, 'rgba(20,17,10,0.94)', GOLD)
  text(dBoard, 'THE DICE PIT', 44, GOLD_L, 800)
  text(dBoard, 'Two dice against the house.', 21, DIM, 400, 4)
  const dStake = text(dBoard, '', 30, CREAM, 700, 14)
  const dRoll  = text(dBoard, 'No hand played yet.', 26, CREAM, 400, 12)
  const dGain  = text(dBoard, '', 24, LIME, 700, 4)
  text(dBoard, 'A win pays 1.9x. A tie comes back.', 19, DIM, 400, 12)

  action('Change the stake', [DICE_X - 2.4, 1.2, DICE_Z + 1.8], 1.6, 0.2, () => {
    vipSel.stake = (vipSel.stake + 1) % VIP_STAKES_C.length
    paintVip()
  })
  action('Roll the dice', [DICE_X, 1.2, DICE_Z + 1.8], 1.6, 0.35,
         () => app.send('vip_dice', { s: vipSel.stake }))

  /* ---------------- the wheel ---------------- */
  const WH_X = 4.6, WH_Z = 0.5
  prim('cylinder', [0.6, 0.75, 0.95], GOLD_D_C, [WH_X, 0.48, WH_Z], { metal: 0.7, rough: 0.42 })
  prim('cylinder', [1.85, 1.85, 0.14], '#3a2f1e', [WH_X, 1.02, WH_Z], { rough: 0.8, solid: true })
  prim('cylinder', [1.72, 1.72, 0.05], BLACK_C, [WH_X, 1.10, WH_Z], { rough: 0.7 })
  prim('sphere', [0.22], GOLD_L, [WH_X, 1.2, WH_Z], { metal: 0.9, rough: 0.25 })
  // the pointer, at the door side of the rim
  // A cone's tip is +Y; -90 degrees about X lays it over to point -Z, which
  // from the rim is inwards at the pockets.
  prim('cone', [0.16, 0.34], GOLD_L, [WH_X, 1.32, WH_Z + 1.62],
       { metal: 0.85, rough: 0.3, rotX: -Math.PI / 2 })

  const pocketPos = []
  for (let i = 1; i <= WHEEL_N_C; i++) {
    // pocket 1 at the pointer and running round, so the number the board names
    // is the one the marker is sitting in
    const a = (i - 1) * (Math.PI * 2 / WHEEL_N_C) + Math.PI / 2
    const px = WH_X + Math.cos(a) * 1.32, pz = WH_Z + Math.sin(a) * 1.32
    pocketPos.push([px, pz])
    // metal 0 on the dark pockets. A near-black metallic disc under an open
    // roof is a mirror pointed at the sky, and six of the twelve came out blue.
    prim('cylinder', [0.24, 0.24, 0.06], i % 2 ? GOLD_L : '#151310',
         [px, 1.14, pz], { metal: i % 2 ? 0.8 : 0, rough: i % 2 ? 0.35 : 0.8 })
  }
  // one marker, moved onto the winning pocket, rather than recolouring twelve
  // prims every spin
  const wMark = prim('cylinder', [0.31, 0.31, 0.04], '#ff5a3a',
                     [pocketPos[0][0], 1.19, pocketPos[0][1]], { emissive: '#ff4a2a' })
  wMark.active = false

  const wBoard = panel(3.5, 2.8, 0.0044, [WH_X, 2.95, WH_Z - 2.1], 0, 'rgba(20,17,10,0.94)', GOLD)
  text(wBoard, 'THE WHEEL', 44, GOLD_L, 800)
  text(wBoard, 'Twelve pockets. Every bet pays back 95%.', 20, DIM, 400, 4)
  const wStake = text(wBoard, '', 28, CREAM, 700, 14)
  const wBet   = text(wBoard, '', 26, GOLD_L, 700, 6)
  const wSpin  = text(wBoard, 'The wheel has not turned yet.', 24, CREAM, 400, 12)
  const wGain  = text(wBoard, '', 24, LIME, 700, 4)

  action('Change the stake', [WH_X - 2.4, 1.2, WH_Z + 1.8], 1.6, 0.2, () => {
    vipSel.stake = (vipSel.stake + 1) % VIP_STAKES_C.length
    paintVip()
  })
  action('Change what you back', [WH_X, 1.2, WH_Z + 1.8], 1.6, 0.2, () => {
    vipSel.bet = (vipSel.bet + 1) % WHEEL_LABELS.length
    paintVip()
  })
  action('Spin the wheel', [WH_X + 2.4, 1.2, WH_Z + 1.8], 1.6, 0.35,
         () => app.send('vip_wheel', { s: vipSel.stake, b: vipSel.bet, n: vipSel.num }))
  // Round the back, so it is 3.6m from the nearest of the three above and
  // cannot steal their prompt. It only means anything on the single-number bet.
  action('Change the number', [WH_X + 2.4, 1.2, WH_Z - 1.8], 1.6, 0.2, () => {
    vipSel.num = vipSel.num % WHEEL_N_C + 1
    vipSel.bet = WHEEL_LABELS.length - 1        // picking a number means backing one
    paintVip()
  })

  /* ---------------- the high table ---------------- */
  const HI_X = 0, HI_Z = -5.0
  for (const sx of [-1, 1]) {
    prim('cylinder', [0.28, 0.36, 0.95], GOLD, [HI_X + sx * 0.95, 0.48, HI_Z], { metal: 0.85, rough: 0.3 })
  }
  prim('box', [3.0, 0.16, 1.6], '#3a2f1e', [HI_X, 1.03, HI_Z], { rough: 0.8, solid: true })
  prim('box', [2.8, 0.05, 1.42], FELT_C, [HI_X, 1.13, HI_Z], { rough: 0.95 })
  prim('box', [3.12, 0.07, 1.72], GOLD, [HI_X, 1.05, HI_Z], { metal: 0.85, rough: 0.3 })
  const hiVis = []
  for (let i = 0; i < 3; i++) {
    hiVis.push(prim('box', [0.26, 0.26, 0.26], '#f2ece0',
                    [HI_X - 0.5 + i * 0.5, 1.29, HI_Z + 0.35], { rough: 0.5, rotY: i * 0.7 }))
  }

  const hBoard = panel(3.8, 2.4, 0.0044, [HI_X, 2.85, HI_Z - 1.2], 0, 'rgba(20,17,10,0.94)', GOLD)
  text(hBoard, 'THE HIGH TABLE', 44, GOLD_L, 800)
  text(hBoard, 'One Gold Cash Cat a hand. Three dice a side.', 20, DIM, 400, 4)
  const hGold = text(hBoard, '', 28, GOLD_L, 700, 14)
  const hHand = text(hBoard, 'The table is waiting.', 24, CREAM, 400, 12)
  text(hBoard, 'Win one, lose one, a tie is a push.', 19, DIM, 400, 12)
  text(hBoard, 'The house takes nothing from this table.', 19, LIME, 400, 2)

  action('Play a hand', [HI_X, 1.2, HI_Z + 1.7], 1.7, 0.4, () => app.send('vip_high', {}))

  /* ---------------- the house's book ----------------
   * On the wall, unprompted. A room that takes stakes and will not show its
   * own numbers is asking to be taken at its word, and it has not earned that.
   */
  const bBoard = panel(3.4, 2.2, 0.0044, [-8 + 0.25 + 0.06, 2.6, -4.0], Math.PI / 2,
                       'rgba(18,24,20,0.94)', LIME)
  text(bBoard, "THE HOUSE'S BOOK", 34, LIME, 800)
  text(bBoard, 'Live, and not rounded in our favour.', 19, DIM, 400, 4)
  const bPlays = text(bBoard, '', 24, CREAM, 700, 12)
  const bTake  = text(bBoard, '', 24, CREAM, 400, 6)
  const bEdge  = text(bBoard, '', 22, LIME, 700, 6)
  const bGold  = text(bBoard, '', 21, GOLD_L, 400, 8)

  /* ---------------- what it says when you are not a member ---------------- */
  const vipMsg = panel(4.6, 1.1, 0.005, [0, 1.9, 4.5], Math.PI, 'rgba(20,17,10,0.92)', GOLD)
  vipMsg.alignItems = 'center'
  const vipLine = text(vipMsg, '', 26, CREAM, 600)

  const paintVip = () => {
    dStake.value = 'Stake: ' + stakeText()
    wStake.value = 'Stake: ' + stakeText()
    wBet.value = 'Backing: ' + (vipSel.bet === WHEEL_LABELS.length - 1
      ? 'number ' + vipSel.num : WHEEL_LABELS[vipSel.bet]) + '   ' + WHEEL_PAYS[vipSel.bet]
    hGold.value = (me.gold || 0) + ' Gold Cash Cat' + (me.gold === 1 ? '' : 's') + ' in hand'
    vipLine.value = me.vip
      ? comma(me.coin) + ' CashCoin on you. Good luck.'
      : 'Members only — 10,000,000 $CASHCATSLLC. The tables will not deal.'
    vipLine.color = me.vip ? CREAM : '#e0a080'

    if (vipBookC) {
      const b = vipBookC
      bPlays.value = comma(b.plays) + ' hands played'
      bTake.value = comma(b.staked) + ' staked  ·  ' + comma(b.paid) + ' paid out'
      const kept = b.staked - b.paid
      bEdge.value = b.staked
        ? 'The house is ' + (kept >= 0 ? 'up ' : 'down ') + comma(Math.abs(kept)) +
          '  (' + (kept / b.staked * 100).toFixed(1) + '%)'
        : 'Nothing staked yet.'
      bGold.value = (b.goldIn || b.goldOut)
        ? 'Gold Cash Cats: ' + b.goldIn + ' in, ' + b.goldOut + ' out'
        : ''
    }
  }

  app.on('vipbook', d => { vipBookC = d; paintVip() })
  app.on('vip', d => {
    if (!d) return
    if (d.msg) vipLine.value = d.msg
    if (d.table === 'dice') {
      dRoll.value = 'You ' + d.you + '   ·   House ' + d.them
      dGain.value = d.outcome === 'win' ? '+' + comma(d.delta) + ' CashCoin'
                  : d.outcome === 'lose' ? comma(d.delta) + ' CashCoin' : 'Push'
      dGain.color = d.outcome === 'win' ? LIME : d.outcome === 'lose' ? '#e0705a' : DIM
    }
    if (d.table === 'wheel') {
      const pp = pocketPos[d.pocket - 1]
      if (pp) { wMark.position.set(pp[0], 1.19, pp[1]); wMark.active = true }
      wSpin.value = 'Pocket ' + d.pocket + '   ·   ' + (d.pocket % 2 ? 'Gold' : 'Black')
      wGain.value = d.outcome === 'win' ? '+' + comma(d.delta) + ' CashCoin'
                                        : comma(d.delta) + ' CashCoin'
      wGain.color = d.outcome === 'win' ? LIME : '#e0705a'
    }
    if (d.table === 'high') {
      hHand.value = 'You ' + d.you + '   ·   House ' + d.them
    }
  })


  /* a sheet at each ground, so the rules are posted where you play */
  const dk = panel(3.8, 5.0, 0.005, [DX + 8.5, 2.6, SHORE - 5.6], Math.PI, 'rgba(10,26,34,0.92)', BLUE)
  text(dk, 'THE DOCKS', 42, BLUE, 800)
  text(dk, 'Cast. When it bites, HOLD to lift your line', 21, CREAM, 400, 10)
  text(dk, 'and let go to drop it. Keep the bar on the', 21, CREAM, 400, 2)
  text(dk, 'fish to tighten it. Lose the tension and', 21, CREAM, 400, 2)
  text(dk, 'it is gone. Rarer fish fight harder.', 21, CREAM, 400, 2)
  // The numbers here are the ones the roll actually uses, not the raw table
  // weights. The ordinary fish are shares of their own table, which sums to 99
  // and renormalises, and the two Ultra Rares are flat independent rolls made
  // before it -- printing w for all seven had the commons a point light and
  // implied the ultras competed with them. Bait and the big-fish bonus move the
  // ordinary shares, so the sheet says so rather than pretending to a number.
  let baseTotal = 0
  for (let i = 0; i < FISH.length; i++) if (FISH[i].r !== ULTRA) baseTotal += FISH[i].w
  for (let i = 0; i < FISH.length; i++) {
    const f = FISH[i]
    const flat = f.r === ULTRA
    const share = flat ? f.w : (f.w / baseTotal) * 100
    const pct = (share < 10 ? share.toFixed(1) : share.toFixed(0)) + '%'
    text(dk, RARITY[f.r].toUpperCase().slice(0, 8).padEnd(9) + f.name, 19,
         RARITY_COLOR[f.r], flat ? 700 : 400, i ? 3 : 12)
    text(dk, '          ' + pct + (flat ? ' flat' : ' base') + '   ·   ' + f.v + ' CashCoin',
         18, DIM, 400, 1)
  }
  text(dk, 'Flat rates roll first and on their own. Base', 18, DIM, 400, 6)
  text(dk, 'rates are shares of the rest — bait and a bigger', 18, DIM, 400, 1)
  text(dk, 'rod move them.', 18, DIM, 400, 1)
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
  // Read off the tables. This line said five kinds and a +15 bonus; there are
  // six kinds, and both numbers are constants three lines up in this file.
  text(gv, 'File one of all ' + FORAGE.length + ' kinds: +' + BUNDLE + ' bonus.', 20, LIME, 400, 10)

  const sv = panel(3.4, 2.6, 0.005, [SX, 2.6, SZ - 2.5], Math.PI, 'rgba(26,20,12,0.92)', '#c98b3a')
  text(sv, 'THE SEAM', 42, '#c98b3a', 800)
  text(sv, 'Veins take several swings.', 21, CREAM, 400, 10)
  // Generated, because the hand-written version had dropped the Cinderlode
  // entirely and then advertised a Steel Pick at 40 ore and a Gold Pick at 150.
  // There is no Steel Pick, 40 ore is the Silver, and the Gold is not bought
  // with ore at all -- it costs a Gold Cash Cat.
  text(sv, SEAMS.map(k => k.name.replace(' Seam', '') + ' ' + k.hits).join(' · '),
       20, CREAM, 400, 2)
  const nextPick = PICKS[1]
  text(sv, nextPick.name + ' at ' + nextPick.ore + ' ore and ' +
       nextPick.forage + ' gathered.', 20, LIME, 400, 10)
  text(sv, 'Cinderlode needs the Gold Pickaxe, and that', 19, LIME, 400, 2)
  text(sv, 'costs a Gold Cash Cat.', 19, LIME, 400, 1)

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
    paintEx()
  }
  paint()

  app.on('you', d => {
    me.fish = d.fish; me.forage = d.forage; me.ore = d.ore; me.filed = d.filed
    me.best = d.best; me.rod = d.rod; me.pick = d.pick; me.kinds = d.kinds
    me.coin = d.coin || 0; me.bait = d.bait || {}; me.onLine = d.onLine; me.gold = d.gold || 0
    me.shovel = d.shovel || 0
    me.bags = d.bags || {}
    me.vip = !!d.vip
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
      const left = parseInt(d.v.charAt(i), 36) || 0
      if (veinVis[i]) {
        veinVis[i].active = left > 0
        const s = 0.55 + left * 0.13
        veinVis[i].scale.set(s, s, s)
      }
    }
    paint()
  })

  const say = (i, msg) => { if (spotUI[i]) spotUI[i].value = msg }

  /* ================================================================== *
   * THE FIGHT — the actual fishing game                                 *
   * ==================================================================
   *
   * A vertical track. The fish swims up and down it. You hold the left mouse
   * button to lift your hook and let go to drop it, and while the hook is over
   * the fish the line tightens; while it is not, the fish works itself loose.
   * Fill the tension bar and it is yours, empty it and it is gone.
   *
   * WHY THIS INPUT. app.control() can bind mouseLeft and touchA and nothing
   * else -- the keyboard line in ClientControls' controlTypes is commented
   * out, so no app can claim a key. Hold-and-release is therefore the only
   * gesture available, and it happens to be exactly the right one: it works
   * unchanged on a phone, and holding is a continuous choice rather than a
   * reaction test, which is what the old press-E-in-a-window was.
   *
   * The hook has weight. Lift is an acceleration, not a position, so it
   * overshoots and has to be caught -- that is the whole skill, and it is why
   * a nervous fish is hard even though the hook is not small.
   */
  const F = {
    on: false, name: '', hook: 0.5, vel: 0, fish: 0.5, target: 0.5,
    tension: 0.35, d: null, nextJitter: 0, ctl: null,
  }
  const LIFT = 2.2          // upward acceleration while held
  const GRAV = 1.7          // downward when not
  const DAMP = 0.86         // so it settles instead of oscillating forever

  // screen-space, right of centre, out of the way of the world
  const fightUI = app.create('ui')
  fightUI.space = 'screen'
  fightUI.width = 300; fightUI.height = 420
  fightUI.size = 1
  fightUI.pivot = 'center-right'
  fightUI.position.set(0.93, 0.5, 0)
  // MUST be off. A screen-space UI mounts a real DOM canvas, and with pointer
  // events on it swallows every click that lands on it -- including the
  // hold-to-lift this whole game is played with. The panel would have sat
  // exactly where the player is looking and eaten its own input.
  fightUI.pointerEvents = false
  // Nearly opaque on purpose. At 0.86 the Register board behind it read
  // straight through the header and the panel looked like a printing error.
  fightUI.backgroundColor = 'rgba(7,17,23,0.96)'
  fightUI.borderRadius = 14
  fightUI.padding = 14
  fightUI.flexDirection = 'column'
  fightUI.alignItems = 'center'
  fightUI.active = false
  app.add(fightUI)

  const fName = app.create('uitext')
  fName.fontSize = 22; fName.color = BLUE; fName.fontWeight = 700
  fightUI.add(fName)
  const fHint = app.create('uitext')
  fHint.fontSize = 15; fHint.color = DIM; fHint.value = 'hold to lift'
  fightUI.add(fHint)

  // the track, drawn as stacked cells so a bar can be built without a shader
  const CELLS = 26
  const track = app.create('uiview')
  track.flexDirection = 'column'; track.width = 92; track.height = 300
  track.backgroundColor = 'rgba(0,0,0,0.62)'; track.borderRadius = 10
  track.margin = [10, 0, 0, 0]
  fightUI.add(track)
  const cells = []
  for (let i = 0; i < CELLS; i++) {
    const c = app.create('uiview')
    c.width = 92; c.height = 300 / CELLS
    c.backgroundColor = 'rgba(0,0,0,0)'   // repainted every frame below
    track.add(c); cells.push(c)
  }
  const tension = app.create('uiview')
  tension.width = 260; tension.height = 16
  tension.backgroundColor = LIME; tension.borderRadius = 8
  tension.margin = [12, 0, 0, 0]
  fightUI.add(tension)

  const paintFight = () => {
    const hookHalf = (F.d ? F.d.hook : 0.3) / 2
    const fishCell = Math.round((1 - F.fish) * (CELLS - 1))
    for (let i = 0; i < CELLS; i++) {
      const v = 1 - i / (CELLS - 1)
      const inHook = Math.abs(v - F.hook) <= hookHalf
      cells[i].backgroundColor = i === fishCell
        ? (inHook ? '#eaf7a1' : '#f2b34a')          // the fish, lit when held
        : (inHook ? 'rgba(46,204,113,0.62)' : 'rgba(255,255,255,0.04)')
    }
    tension.width = Math.max(6, Math.round(260 * F.tension))
    tension.backgroundColor = F.tension > 0.55 ? LIME : (F.tension > 0.25 ? GOLD_L : '#e0553f')
  }

  const endFight = ok => {
    if (!F.on) return
    F.on = false
    fightUI.active = false
    if (F.ctl) { F.ctl.release(); F.ctl = null }
    app.send('land', { ok: !!ok })
  }

  const startFight = d => {
    F.on = true
    F.name = d.name || 'Something'
    F.d = d.d || { hook: 0.3, speed: 0.5, jitter: 1.2, fill: 0.6, drain: 0.35 }
    F.hook = 0.35; F.vel = 0; F.fish = 0.6; F.target = 0.6
    F.tension = 0.35; F.nextJitter = 0
    fName.value = F.name
    fHint.value = 'hold  ·  keep the bar on it'
    fightUI.active = true
    // Claimed only for the length of the fight. A permanent claim on the mouse
    // would eat every click in the world, including the ones that open doors.
    F.ctl = app.control({ mouseLeft: true })
    paintFight()
  }

  app.on('update', dt => {
    if (!F.on) return
    const d = F.d
    const held = !!(F.ctl && F.ctl.mouseLeft && F.ctl.mouseLeft.down)
    // hook: an acceleration, so it overshoots and has to be caught
    F.vel += (held ? LIFT : -GRAV) * dt
    F.vel *= Math.pow(DAMP, dt * 60)
    F.hook += F.vel * dt
    if (F.hook < 0) { F.hook = 0; F.vel = Math.max(0, F.vel) }
    if (F.hook > 1) { F.hook = 1; F.vel = Math.min(0, F.vel) }
    // fish: swims toward a target it keeps changing its mind about
    F.nextJitter -= dt
    if (F.nextJitter <= 0) {
      F.nextJitter = 0.25 + Math.random() * (1.6 / d.jitter)
      F.target = Math.random()
    }
    const step = d.speed * dt
    F.fish += Math.max(-step, Math.min(step, F.target - F.fish))
    F.fish = Math.max(0, Math.min(1, F.fish))
    // tension
    const on = Math.abs(F.fish - F.hook) <= d.hook / 2
    F.tension += (on ? d.fill : -d.drain) * dt
    paintFight()
    if (F.tension >= 1) { F.tension = 1; endFight(true) }
    else if (F.tension <= 0) { F.tension = 0; endFight(false) }
  })

  app.on('cast',   d => { phase = 'wait'; if (fishing >= 0) say(fishing, 'Line out — wait for it…') })
  app.on('bite',   d => {
    phase = 'fight'
    if (fishing >= 0) { say(fishing, 'ON! — hold to fight it'); if (spotAct[fishing]) spotAct[fishing].label = 'Fighting…' }
    startFight(d)
  })
  app.on('missed', d => {
    phase = 'idle'
    if (F.on) { F.on = false; fightUI.active = false; if (F.ctl) { F.ctl.release(); F.ctl = null } }
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
