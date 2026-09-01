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
/* Weights are percentages and sum to 100, so the rate on the sheet is the
 * rate in the world — 0.5 means 0.5%, not "0.5 shares of some total". */
const FISH = [
  { key:'fishPerch', name:'Penny Perch',    w:34.0, v:1,   min:0 },
  { key:'fishCarp',  name:'Copper Carp',    w:26.0, v:2,   min:0 },
  { key:'fishTrout', name:'Paper Trout',    w:20.0, v:4,   min:0 },
  { key:'fishBass',  name:'Silver Bass',    w:12.0, v:9,   min:0 },
  { key:'fishEel',   name:'Ledger Eel',     w: 5.0, v:20,  min:0 },
  { key:'fishTuna',  name:'Blue Chip Tuna', w: 2.5, v:55,  min:1 },
  { key:'fishGold',  name:'GOLD CASH CAT',  w: 0.5, v:500, min:1 },
]
/* `min` is the rod tier a fish needs. Anything a player cannot yet catch has
 * its weight folded back into the common end, so the odds always add to 100
 * and nobody is quietly fishing an 8%-of-nothing hole. */

const RODS = [
  { key:'rodWood',   name:'Wooden Rod', at:0,   window:1500 },
  { key:'rodSilver', name:'Silver Rod', at:60,  window:1800 },
  { key:'rodGold',   name:'Gold Rod',   at:250, window:2150 },
]

const FORAGE = [
  { key:'n_mushRed', name:'Red Cap',    v:3 },
  { key:'n_mushTan', name:'Tan Cap',    v:3 },
  { key:'n_flowerY', name:'Gold Aster', v:2 },
  { key:'n_flowerP', name:'Violet',     v:2 },
  { key:'n_bushS',   name:'Sweetberry', v:4 },
]
const REGROW = 40000          // ms before a gathered node comes back
const BUNDLE = 15             // bonus for filing one of every kind

const SEAMS = [
  { name:'Copper Seam', hits:3, v:4  },
  { name:'Silver Seam', hits:5, v:12 },
  { name:'Gold Seam',   hits:8, v:40 },
]
const PICKS = [
  { name:'Iron Pick',  at:0,   off:0 },
  { name:'Steel Pick', at:40,  off:1 },
  { name:'Gold Pick',  at:150, off:2 },
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
for (let i = 0; i < 10; i++) {
  const a = i * 0.6283 + 0.31, r = 7.5 + (i % 3) * 1.9
  NODES.push({ x: GX + Math.cos(a) * r, z: GZ + Math.sin(a) * r, kind: i % FORAGE.length })
}

const SX = 47, SZ = -27
const VEINS = []
for (let i = 0; i < 7; i++) {
  VEINS.push({ x: SX - 10 + i * 3.4, z: SZ - 11.4, y: 1.5, kind: i % 3 === 2 ? 2 : (i % 2) })
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
function panel(w, h, size, pos, rotY, bg, border) {
  const u = app.create('ui')
  u.space = 'world'; u.width = w; u.height = h; u.size = size
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

  const blank = () => ({ name:'?', fish:0, catches:{}, forage:0, kinds:{}, ore:0, best:0, filed:0 })
  const ledgerFor = p => {
    const id = p.userId || p.id
    if (!book[id]) book[id] = blank()
    book[id].name = p.name || '?'
    return book[id]
  }
  const save = () => { world.set(KEY, book); saveAt = now() + 4000 }
  const touch = () => { if (now() > saveAt) save() }

  const rodTier = L => { let t = 0; for (let i = 0; i < RODS.length; i++) if (L.fish >= RODS[i].at) t = i; return t }
  const pickTier = L => { let t = 0; for (let i = 0; i < PICKS.length; i++) if (L.ore >= PICKS[i].at) t = i; return t }

  /* roll the catch table, folding locked weight down into the commons so the
   * printed rates stay honest whatever rod you hold */
  const rollFish = tier => {
    let locked = 0
    for (let i = 0; i < FISH.length; i++) if (FISH[i].min > tier) locked += FISH[i].w
    const r = num(0, 100, 4)
    let acc = 0
    for (let i = 0; i < FISH.length; i++) {
      const f = FISH[i]
      if (f.min > tier) continue
      acc += f.w + (i < 3 ? locked / 3 : 0)
      if (r <= acc) return f
    }
    return FISH[0]
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
    app.send('world', { n: nb.join(''), v: vb.join(''), top: top() })
  }
  const pushYou = (pid, L) => {
    app.sendTo(pid, 'you', {
      fish: L.fish, forage: L.forage, ore: L.ore, filed: L.filed, best: L.best,
      rod: rodTier(L), pick: pickTier(L),
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
    const f = rollFish(rodTier(L))
    L.fish += 1
    L.catches[f.key] = (L.catches[f.key] || 0) + 1
    L.filed += f.v
    if (f.v > L.best) L.best = f.v
    touch()
    app.sendTo(pid, 'caught', { key: f.key, name: f.name, v: f.v, gold: f.key === 'fishGold' })
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
    nodeBack[i] = now() + REGROW
    const kind = FORAGE[nd.kind]
    const L = ledgerFor(p)
    L.forage += 1
    L.filed += kind.v
    let bonus = 0
    if (!L.kinds[kind.key]) {
      L.kinds[kind.key] = 1
      if (Object.keys(L.kinds).length === FORAGE.length) { bonus = BUNDLE; L.filed += BUNDLE }
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
    const need = Math.max(1, seam.hits - PICKS[pickTier(L)].off)
    st.left = Math.min(st.left, need)
    st.left -= 1
    if (st.left > 0) {
      app.sendTo(pid, 'chip', { left: st.left, name: seam.name })
    } else {
      st.backAt = now() + RESEAM
      st.left = seam.hits
      L.ore += 1
      L.filed += seam.v
      touch()
      app.sendTo(pid, 'ore', { name: seam.name, v: seam.v })
      pushYou(pid, L)
    }
    dirty = true
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

  const me = { fish:0, forage:0, ore:0, filed:0, best:0, rod:0, pick:0, kinds:0 }
  let board = []
  let nodeOn = [], veinLeft = []
  let fishing = -1, phase = 'idle', biteEnds = 0
  const nodeVis = [], veinVis = []

  /* ---------------- the Docks ---------------- */
  const spotUI = [], spotAct = []
  for (let i = 0; i < SPOTS.length; i++) {
    const s = SPOTS[i]
    const u = panel(2.4, 0.9, 0.005, [s.x, s.y + 2.5, s.z - 1.2], Math.PI,
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
  // the rod on the rack at the head of the middle jetty
  model('rodWood', [DX + 6.5, 0.9, SHORE - 3.2], 0.6, 1.0)

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
    const g = model(kind.key, [nd.x, 0, nd.z], i * 0.9, 3.4)
    nodeVis.push(g)
    prim('cylinder', [1.5, 1.5, 0.06], '#6a8f4a', [nd.x, 0.03, nd.z], { rough: 1 })
    action('Gather ' + kind.name, [nd.x, 1.0, nd.z], 3.2, 0.55, () => app.send('gather', { i }))
  }

  /* ---------------- the Seam ---------------- */
  for (let i = 0; i < VEINS.length; i++) {
    const vn = VEINS[i], seam = SEAMS[vn.kind]
    const col = vn.kind === 2 ? '#e8c25a' : (vn.kind === 1 ? '#d8dde2' : '#c07a3a')
    const g = prim('sphere', [0.85], col, [vn.x, vn.y, vn.z],
                   { metal: 0.75, rough: 0.3, emissive: vn.kind === 2 ? '#6b5210' : null })
    veinVis.push(g)
    model('oreChunk', [vn.x, vn.y - 1.4, vn.z + 0.4], i * 1.3, 1.1)
    action('Mine ' + seam.name, [vn.x, vn.y, vn.z + 1.0], 3.4, 0.45, () => app.send('swing', { i }))
  }
  model('pickaxe', [SX - 6, 0.9, SZ - 4], 0.7, 1.0)

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
  const dk = panel(3.6, 2.9, 0.005, [DX + 8.5, 2.6, SHORE - 5.6], Math.PI, 'rgba(10,26,34,0.92)', BLUE)
  text(dk, 'THE DOCKS', 42, BLUE, 800)
  text(dk, 'Cast, wait for the bite, strike inside', 21, CREAM, 400, 10)
  text(dk, 'the window. Early spooks it.', 21, CREAM, 400, 2)
  text(dk, 'Penny Perch  34%   ·   1', 20, DIM, 400, 12)
  text(dk, 'Copper Carp  26%   ·   2', 20, DIM, 400, 2)
  text(dk, 'Paper Trout  20%   ·   4', 20, DIM, 400, 2)
  text(dk, 'Silver Bass  12%   ·   9', 20, DIM, 400, 2)
  text(dk, 'Ledger Eel    5%   ·  20', 20, DIM, 400, 2)
  text(dk, 'Blue Chip Tuna 2.5% ·  55', 20, CREAM, 400, 2)
  text(dk, 'GOLD CASH CAT 0.5% · 500', 20, GOLD_L, 700, 2)
  text(dk, 'Tuna and Gold need a Silver Rod (60 catches).', 19, LIME, 400, 10)
  text(dk, 'Rods are earned, never sold.', 19, LIME, 700, 2)

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
    rMine.value = comma(me.filed) + ' filed  ·  ' + me.fish + ' fish  ·  ' +
                  me.forage + ' gathered  ·  ' + me.ore + ' ore'
    rGear.value = RODS[me.rod].name + '  ·  ' + PICKS[me.pick].name
    if (me.rod < RODS.length - 1) {
      rNext.value = 'Next rod: ' + RODS[me.rod + 1].name + ' at ' + RODS[me.rod + 1].at + ' catches'
    } else {
      rNext.value = 'Every rod earned.'
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
    paint()
  })
  app.on('world', d => {
    board = d.top || []
    for (let i = 0; i < nodeVis.length; i++) {
      const on = d.n.charCodeAt(i) !== 48
      if (nodeVis[i] && nodeVis[i].active !== on) nodeVis[i].active = on
    }
    for (let i = 0; i < veinVis.length; i++) {
      const left = d.v.charCodeAt(i) - 48
      if (veinVis[i]) {
        veinVis[i].active = left > 0
        const s = 0.6 + left * 0.16
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
