/*
 * World of CashCats — the Lands
 *
 * The campus is the hub; this is everywhere else. Four grounds hang off the
 * corners of the plaza, each one a place you walk to rather than a menu you
 * open:
 *
 *   THE FIELDS  (NW)  x -70..-22  z -46..-6   cottages, crops, mill, market
 *   THE SEAM    (NE)  x  22..70   z -46..-6   quarry face, mine mouth, ore
 *   THE DOCKS   (SW)  x -72..-22  z  32..72   lake, jetties, boats, fish shack
 *   THE GROVE   (SE)  x  22..70   z  32..72   woodland, camp, forage patches
 *
 * This app only draws. Everything you can *do* on these grounds lives in
 * trades.js, which owns the ledger and is server-authoritative. Splitting them
 * means the set dressing can be re-cut without touching a single tally.
 *
 * Ground is flat at y=0 out to ±300m (the Meadow terrain only starts to roll
 * past that), so nothing here needs to sample a height — but anything a player
 * stands *on* needs physics:'static', because prims have no collider by default
 * and a jetty without one is a picture of a jetty.
 *
 * Kit scales, measured rather than guessed:
 *   fantasy-town-kit  1-unit grid -> x3.6   (a wall is 3.6m wide and 3.6m tall)
 *   nature-kit        1-unit grid -> x3.4
 *   pirate-kit        ~metres     -> x1.5   (barrels and crates x0.65)
 *   modular-cave-kit  already metres -> x1
 */

const NAT = 3.4, TOWN = 3.6, PIR = 1.5, SMALL = 0.65
const Y = 0.02

const GOLD='#a9812a', GOLD_L='#e8c25a', CREAM='#e8f2ec', INK='#16150f'
const DIM='#8fa39a', PAPER='#f4f0e3', GREEN='#1a7f4b'
const SOIL='#5c4630', SAND='#d9c89a', WATER='#2b6f8f', WATER_D='#1d5169'
const STONE='#cfc9b8', STONE_D='#a8a291', GRASS='#4f8f4a'

/* ------------------------------------------------------------------ *
 * helpers                                                             *
 * ------------------------------------------------------------------ */
function prim(type, size, color, pos, opts) {
  opts = opts || {}
  const n = app.create('prim')
  n.type = type; n.size = size; n.color = color
  n.position.set(pos[0], pos[1], pos[2])
  if (opts.rotY) n.rotation.y = opts.rotY
  if (opts.rotX) n.rotation.x = opts.rotX
  if (opts.rotZ) n.rotation.z = opts.rotZ
  if (opts.emissive) n.emissive = opts.emissive
  if (opts.tex && props[opts.tex]) n.texture = props[opts.tex].url
  if (opts.rough !== undefined) n.roughness = opts.rough
  if (opts.metal !== undefined) n.metalness = opts.metal
  if (opts.physics) n.physics = opts.physics
  // there is no `visible` on a prim, but the visual is only built when
  // opacity > 0 — so opacity 0 is an invisible body that still collides.
  if (opts.opacity !== undefined) n.opacity = opts.opacity
  app.add(n); return n
}

// world.load, not app.load — app has no loader. Getting that wrong threw on
// the first model and took the whole script with it, which is how the campus
// shipped with no skyline, no trees and no lamps and nothing said a word.
function model(key, pos, rotY, scale, opts) {
  const prop = props[key]
  if (!prop || !prop.url) return
  opts = opts || {}
  world.load('model', prop.url)
    .then(node => {
      node.position.set(pos[0], pos[1], pos[2])
      if (rotY) node.rotation.y = rotY
      if (opts.rotX) node.rotation.x = opts.rotX
      const k = scale === undefined ? 1 : scale
      node.scale.set(opts.sx || k, opts.sy || k, opts.sz || k)
      app.add(node)
    })
    .catch(() => {})   // one missing pack should cost a prop, not the ground
}

// A tiny deterministic generator. Math.random would scatter the world
// differently on every reload and differently for every player; scenery that
// moves when you look away is worse than scenery that repeats.
let _seed = 20260901
function rnd() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff }
function rr(a, b) { return a + rnd() * (b - a) }
function pick(list) { return list[Math.floor(rnd() * list.length) % list.length] }

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
  u.backgroundColor = bg; u.borderColor = border; u.borderWidth = 6
  u.borderRadius = 12; u.padding = 24; u.flexDirection = 'column'
  u.lit = false; u.doubleside = false
  u.position.set(pos[0], pos[1], pos[2])
  if (rotY) u.rotation.y = rotY
  app.add(u); return u
}
function text(parent, val, px, color, weight, mt) {
  const t = app.create('uitext')
  t.value = val; t.fontSize = px; t.color = color; t.lineHeight = 1.35
  if (weight) t.fontWeight = weight
  if (mt) t.margin = [mt, 0, 0, 0]
  parent.add(t); return t
}
// uitext collapses newlines, so every line is its own node.
function lines(parent, arr, px, color, weight) {
  for (let i = 0; i < arr.length; i++) text(parent, arr[i], px, color, weight, i ? 4 : 0)
}

/* a fingerpost you can read from the plaza */
function marker(title, sub, pos, rotY, accent) {
  model('n_obelisk', [pos[0], 0, pos[2]], rotY, NAT * 0.9)
  const u = panel(2.6, 1.15, 0.0045, [pos[0], 3.9, pos[2] + 0.35], rotY, 'rgba(14,20,17,0.90)', accent)
  text(u, title, 58, accent, 800)
  text(u, sub, 30, CREAM, 400, 10)
}

/* ------------------------------------------------------------------ *
 * roads out of the plaza                                              *
 * ------------------------------------------------------------------ */
/* The plaza runs x -33..31, z 8..25. Four stone roads leave its corners for
 * the four grounds, so nobody has to guess that there is anything out there. */
function road(x1, z1, x2, z2, w) {
  const dx = x2 - x1, dz = z2 - z1
  const len = Math.sqrt(dx * dx + dz * dz)
  const ang = Math.atan2(dx, dz)
  prim('box', [w, 0.26, len], '#ffffff', [(x1 + x2) / 2, Y - 0.13, (z1 + z2) / 2],
       { tex: 'paving', rough: 0.95, rotY: ang })
  prim('box', [w + 0.7, 0.05, len], STONE_D, [(x1 + x2) / 2, Y - 0.015, (z1 + z2) / 2], { rotY: ang })
  // stones scattered along the verge so the edge is not a ruler line
  const n = Math.floor(len / 5)
  for (let i = 1; i < n; i++) {
    const t = i / n
    const px = x1 + dx * t, pz = z1 + dz * t
    const off = (w / 2 + rr(0.9, 2.2)) * (i % 2 ? 1 : -1)
    model(pick(['n_stoneLgA', 'n_rockLgB', 'n_bushS', 'n_grassLeaf']),
          [px + off * Math.cos(ang), 0, pz - off * Math.sin(ang)], rr(0, 6.28), NAT * rr(0.5, 0.9))
  }
}
road(-26,  9, -44,  -8, 6)     // to the Fields
road( 26,  9,  44,  -8, 6)     // to the Seam
road(-26, 24, -44,  40, 6)     // to the Docks
road( 26, 24,  44,  40, 6)     // to the Grove

marker('THE FIELDS', 'Farmland · the Homestead', [-27.5, 0, 10.5], -0.5, '#7ac14a')
marker('THE SEAM',   'Quarry · ore and stone',   [ 27.5, 0, 10.5],  0.5, '#c98b3a')
marker('THE DOCKS',  'The lake · fishing',       [-27.5, 0, 23.0], -2.6, '#4fb3d9')
marker('THE GROVE',  'Woodland · foraging',      [ 27.5, 0, 23.0],  2.6, '#8fd07a')

/* ------------------------------------------------------------------ *
 * THE FIELDS — the land thing, as land                                *
 * ------------------------------------------------------------------ */
/* The Homestead building is the deed office at [-22,0,0]. This is what the
 * deeds are *for*: a working smallholding you can walk through. */
const FX = -47, FZ = -26          // centre of the Fields

// the yard the cottages sit on
prim('box', [46, 0.22, 38], '#ffffff', [FX, Y - 0.11, FZ], { tex: 'paving', rough: 1.0 })

/*
 * A cottage from the town kit. The kit is a 1-unit grid and a wall piece is a
 * slab on the +X edge of its cell, so a rotation of 0 / -90 / 180 / +90 puts
 * one on the +X / +Z / -X / -Z side. Perimeter cells get walls on their
 * outward faces; a roof gable caps each cell.
 */
function cottage(cx, cz, w, d, rot, wood, storeys) {
  const S = TOWN
  storeys = storeys || 1
  const wallK  = wood ? 't_wallWood'  : 't_wall'
  const doorK  = wood ? 't_wallWoodD' : 't_wallDoor'
  const winK   = wood ? 't_wallWoodW' : 't_wallWin'
  const cos = Math.cos(rot), sin = Math.sin(rot)
  const place = (lx, lz, k, r, y) => {
    model(k, [cx + lx * cos + lz * sin, y || 0, cz - lx * sin + lz * cos], rot + r, S)
  }
  let doorDone = false
  for (let s = 0; s < storeys; s++) {
    const y = s * S
    for (let i = 0; i < w; i++) {
      for (let jj = 0; jj < d; jj++) {
        const lx = (i - (w - 1) / 2) * S, lz = (jj - (d - 1) / 2) * S
        // +X face
        if (i === w - 1) place(lx, lz, (s === 0 && jj === 0 && !doorDone) ? (doorDone = true, doorK) : (jj % 2 ? winK : wallK), 0, y)
        if (i === 0)     place(lx, lz, jj % 2 ? wallK : winK, Math.PI, y)
        if (jj === d - 1) place(lx, lz, i % 2 ? wallK : winK, -Math.PI / 2, y)
        if (jj === 0)     place(lx, lz, i % 2 ? winK : wallK,  Math.PI / 2, y)
      }
    }
  }
  // roof: one gable per cell, ends capped
  const ry = storeys * S
  for (let i = 0; i < w; i++) {
    for (let jj = 0; jj < d; jj++) {
      const lx = (i - (w - 1) / 2) * S, lz = (jj - (d - 1) / 2) * S
      const cap = (jj === 0 || jj === d - 1)
      place(lx, lz, cap ? 't_roofGEnd' : 't_roofGable', 0, ry)
    }
  }
  model('t_chimney', [cx + (w * S * 0.28) * cos, ry + S * 0.45, cz - (w * S * 0.28) * sin], rot, S)
  // the box that actually stops you walking through the wall
  prim('box', [w * S, storeys * S, d * S], '#ffffff',
       [cx, storeys * S / 2, cz], { rotY: rot, physics: 'static', opacity: 0 })
}

cottage(FX - 15, FZ - 11, 2, 2,  0.0,        false, 1)
cottage(FX -  3, FZ - 13, 2, 3,  Math.PI/2,  true,  1)
cottage(FX + 11, FZ - 10, 2, 2, -0.35,       false, 2)
cottage(FX + 14, FZ +  6, 3, 2,  Math.PI,    true,  1)
cottage(FX - 17, FZ +  8, 2, 2,  0.4,        true,  1)

/* the mill on the water channel, and a windmill on the rise behind */
prim('box', [5.5, 0.3, 26], WATER, [FX + 1, Y + 0.06, FZ + 2], { rough: 0.15, metal: 0.35 })
prim('box', [6.6, 0.24, 26], STONE_D, [FX + 1, Y - 0.02, FZ + 2])
model('t_watermill', [FX + 4.6, 0, FZ + 2], -Math.PI / 2, TOWN)
model('t_windmill',  [FX - 21, 0, FZ - 3], 0.6, TOWN * 0.95)
for (let i = 0; i < 5; i++) model('n_lily', [FX + rr(-1.6, 1.6), 0.2, FZ - 9 + i * 4.6], rr(0, 6.28), NAT * 0.9)

/* the crop plots — fenced, planted, at four different stages so the field
 * reads as worked rather than decorated */
function plot(px, pz, cols, rows, crop) {
  const S = NAT
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = px + (c - (cols - 1) / 2) * S, z = pz + (r - (rows - 1) / 2) * S
      model('n_dirtRow', [x, 0, z], 0, S)
      if (crop) for (let k = -1; k <= 1; k++) model(crop, [x + k * S * 0.3, 0.14, z + rr(-0.5, 0.5)], rr(0, 6.28), S * rr(0.85, 1.05))
    }
  }
  // fence the plot
  const hw = cols * S / 2 + S * 0.4, hd = rows * S / 2 + S * 0.4
  for (let c = 0; c <= cols; c++) {
    const x = px + (c - cols / 2) * S
    model('n_fence', [x, 0, pz - hd], 0, S)
    model(c === Math.floor(cols / 2) ? 'n_fenceGate' : 'n_fence', [x, 0, pz + hd], 0, S)
  }
  for (let r = 0; r <= rows; r++) {
    const z = pz + (r - rows / 2) * S
    model('n_fence', [px - hw, 0, z], Math.PI / 2, S)
    model('n_fence', [px + hw, 0, z], Math.PI / 2, S)
  }
}
plot(FX - 15, FZ + 8,  3, 2, 'n_wheatB')
plot(FX -  2, FZ + 11, 3, 2, 'n_cornD')
plot(FX + 11, FZ + 15, 2, 2, 'n_pumpkin')
plot(FX - 16, FZ - 2,  2, 2, 'n_carrot')

/* The board at the field gate. The Homestead building at [-22,0,0] is the deed
 * office and these are the plots it sells; without something saying so, the
 * office is a menu in a shed and the fields are scenery, and neither explains
 * the other. Prices match PLOTS in homestead.js. */
const fb = panel(4.4, 3.0, 0.0052, [FX - 1, 2.7, FZ + 20.4], Math.PI,
                 'rgba(14,20,14,0.93)', '#7ac14a')
text(fb, 'THE FIELDS', 46, '#7ac14a', 800)
text(fb, 'Deeds and plots at the Homestead,', 22, CREAM, 400, 10)
text(fb, 'back down the road on the plaza.', 22, CREAM, 400, 2)
text(fb, 'Smallholding    2 beds      40,000', 21, DIM, 400, 14)
text(fb, 'Farmstead       4 beds     120,000', 21, DIM, 400, 3)
text(fb, 'Estate          6 beds     320,000', 21, DIM, 400, 3)
text(fb, 'Beds set the harvest. Buildings wear', 20, CREAM, 400, 12)
text(fb, 'out the same way gear does.', 20, CREAM, 400, 2)
text(fb, 'Land burns $CASHCATSLLC. Nothing here pays any back.', 19, '#c9a94e', 700, 10)
model('n_sign', [FX - 4.2, 0, FZ + 20.0], Math.PI, NAT * 1.1)

/* the market row — where produce actually goes */
const MKT = [['t_stallGrn', -6], ['t_stallRed', 0], ['t_stall', 6], ['t_stallGrn', 12]]
for (let i = 0; i < MKT.length; i++) {
  model(MKT[i][0], [FX + MKT[i][1], 0, FZ + 17], Math.PI, TOWN)
  model('t_stallBnch', [FX + MKT[i][1], 0, FZ + 15.4], Math.PI, TOWN)
  if (i % 2 === 0) model('t_bannerGrn', [FX + MKT[i][1] - 2.4, 0, FZ + 17.6], Math.PI, TOWN)
}
model('t_cart',     [FX + 17, 0, FZ + 16], 0.8, TOWN)
model('t_cartHigh', [FX - 11, 0, FZ + 18], -0.4, TOWN)

/* hedges, lanterns and the odd tree so the yard is not a car park */
for (let i = 0; i < 10; i++) model('t_hedge', [FX - 22 + i * 1.0 * TOWN, 0, FZ + 19.5], 0, TOWN)
for (let i = 0; i < 4; i++) model('t_lantern', [FX - 12 + i * 8, 0, FZ + 13], 0, TOWN)
for (let i = 0; i < 14; i++)
  model(pick(['n_oak', 'n_fat', 'n_pineA', 'n_blocks']),
        [FX + rr(-23, 23), 0, FZ + rr(-19, 19)], rr(0, 6.28), NAT * rr(0.85, 1.25))
for (let i = 0; i < 18; i++)
  model(pick(['n_bushL', 'n_bushS', 'n_grassLeaf', 'n_potLarge']),
        [FX + rr(-22, 22), 0, FZ + rr(-18, 18)], rr(0, 6.28), NAT * rr(0.7, 1.1))

/* ------------------------------------------------------------------ *
 * THE DOCKS — the lake                                                *
 * ------------------------------------------------------------------ */
const DX = -47, DZ = 54
const SHORE_Z = DZ - 16          // sand ends, water begins

prim('box', [56, 0.2, 14], '#ffffff', [DX, Y - 0.1, SHORE_Z - 7], { tex: 'paving', rough: 1.0 })
prim('box', [56, 0.26, 12], SAND, [DX, Y - 0.05, SHORE_Z - 1], { rough: 1.0 })
// the lake. Low roughness with a little metalness is what reads as water on a
// prim — there is no transparency to lean on.
prim('box', [64, 0.5, 44], WATER, [DX, Y - 0.18, SHORE_Z + 20], { rough: 0.08, metal: 0.45 })
prim('box', [66, 0.3, 46], WATER_D, [DX, Y - 0.3, SHORE_Z + 20], { rough: 0.3 })

/* three jetties out over the water. The kit dock is scenery; the plank deck
 * under it is what carries a player, so it is a static prim. */
function jetty(jx, len, wide) {
  prim('box', [wide, 0.36, len], '#8a6f4c', [jx, 0.55, SHORE_Z + len / 2 - 1],
       { tex: 'wood', rough: 0.85, physics: 'static' })
  for (let i = 0; i < Math.floor(len / 4); i++) {
    const z = SHORE_Z + 1.5 + i * 4
    model('p_dock', [jx, 0, z], 0, PIR)
    prim('cylinder', [0.22, 0.22, 1.6], '#6b543a', [jx - wide / 2 + 0.3, -0.2, z], { rough: 0.9 })
    prim('cylinder', [0.22, 0.22, 1.6], '#6b543a', [jx + wide / 2 - 0.3, -0.2, z], { rough: 0.9 })
  }
  // a ramp up from the sand so you can actually get on
  prim('box', [wide, 0.3, 3.2], '#8a6f4c', [jx, 0.28, SHORE_Z - 2.2],
       { tex: 'wood', rough: 0.85, rotX: -0.16, physics: 'static' })
}
jetty(DX - 16, 20, 4.2)
jetty(DX,      28, 5.0)
jetty(DX + 16, 16, 4.2)

/* the fish shack at the head of the middle jetty */
model('p_towerBase', [DX + 8.5, 0, SHORE_Z - 4], -0.3, PIR)
model('p_towerRoof', [DX + 8.5, 4.6, SHORE_Z - 4], -0.3, PIR)
model('p_flag',      [DX + 12.5, 0, SHORE_Z - 5], -0.3, PIR)
for (let i = 0; i < 9; i++)
  model(i % 3 ? 'p_crate' : 'p_crateBtl',
        [DX + rr(2, 15), 0, SHORE_Z + rr(-8, -1)], rr(0, 6.28), PIR * SMALL * rr(0.9, 1.3))
for (let i = 0; i < 7; i++)
  model('m_barrel', [DX + rr(-22, -6), 0, SHORE_Z + rr(-8, -1)], rr(0, 6.28), PIR * SMALL)
model('p_chest',  [DX - 12, 0, SHORE_Z - 6], 0.5, PIR * SMALL * 1.3)
model('p_shovel', [DX - 4,  0, SHORE_Z - 7], 1.2, PIR)

/* boats, a wreck on the far shore, palms along the sand */
model('m_boat',  [DX - 11.5, 0.1, SHORE_Z + 9],  0.25, PIR)
model('p_boatL', [DX + 4.5,  0.1, SHORE_Z + 15], -0.4, PIR)
model('m_boat',  [DX + 20,   0.1, SHORE_Z + 6],  1.9,  PIR)
model('p_ship',  [DX - 24,   0.1, SHORE_Z + 30], 0.7,  PIR * 1.2)
model('p_wreck', [DX + 25,   0.0, SHORE_Z + 33], -1.1, PIR * 1.2)
for (let i = 0; i < 9; i++)
  model(i % 2 ? 'm_palm' : 'p_palmBend',
        [DX - 26 + i * 6.4 + rr(-1.5, 1.5), 0, SHORE_Z - rr(5, 11)], rr(0, 6.28), PIR * rr(0.85, 1.15))
for (let i = 0; i < 12; i++)
  model(pick(['p_rocksSand', 'p_patchSand', 'n_stoneLgA']),
        [DX + rr(-27, 27), 0, SHORE_Z + rr(-9, 1)], rr(0, 6.28), PIR * rr(0.7, 1.2))
for (let i = 0; i < 16; i++)
  model(rnd() > 0.5 ? 'n_lily' : 'n_lilySm',
        [DX + rr(-28, 28), 0.24, SHORE_Z + rr(4, 34)], rr(0, 6.28), NAT * rr(0.8, 1.4))

/* ------------------------------------------------------------------ *
 * THE GROVE — woodland                                                *
 * ------------------------------------------------------------------ */
const GX = 47, GZ = 52

// a clearing floor of trodden earth, then trees thick around the outside
prim('cylinder', [11, 11, 0.24], SOIL, [GX, Y - 0.1, GZ], { rough: 1.0 })

for (let i = 0; i < 70; i++) {
  // ring the clearing: dense at the rim, none in the middle
  const a = rr(0, 6.2832), r = rr(13, 25)
  model(pick(['n_oak', 'n_fat', 'n_pineA', 'n_pineB', 'n_blocks']),
        [GX + Math.cos(a) * r, 0, GZ + Math.sin(a) * r], rr(0, 6.28), NAT * rr(0.9, 1.5))
}
for (let i = 0; i < 26; i++) {
  const a = rr(0, 6.2832), r = rr(6, 24)
  model(pick(['n_bushL', 'n_bushS', 'n_grassLeaf', 'n_stump', 'n_log']),
        [GX + Math.cos(a) * r, 0, GZ + Math.sin(a) * r], rr(0, 6.28), NAT * rr(0.7, 1.2))
}

/* the forager's camp in the clearing */
model('n_campfire', [GX, 0, GZ], 0, NAT * 1.2)
prim('cone', [0.8, 1.5], '#ff7a2a', [GX, 0.9, GZ], { emissive: '#ff9a3a', rough: 0.4 })
model('n_tent',   [GX - 6, 0, GZ - 3], 0.9,  NAT * 1.2)
model('n_tentSm', [GX + 5.5, 0, GZ - 4], -0.7, NAT * 1.2)
model('n_logStack', [GX + 3, 0, GZ + 5], 0.4, NAT)
model('n_log',      [GX - 4, 0, GZ + 5.5], 1.5, NAT)
for (let i = 0; i < 5; i++) model('n_stump', [GX + rr(-8, 8), 0, GZ + rr(-8, 8)], rr(0, 6.28), NAT)
model('n_bridge', [GX - 20, 0, GZ + 16], 0.3, NAT)

/* ------------------------------------------------------------------ *
 * THE SEAM — the quarry                                               *
 * ------------------------------------------------------------------ */
const SX = 47, SZ = -27

prim('box', [44, 0.22, 34], '#ffffff', [SX, Y - 0.11, SZ], { tex: 'paving', rough: 1.0 })
prim('box', [30, 0.2, 20], '#6e6455', [SX, Y - 0.04, SZ - 2], { rough: 1.0 })

/* a cliff face across the back, stepped so it reads as a worked quarry rather
 * than a wall. The nature kit cliff block is a 1m cube at 1 unit; at 3.4 each
 * course is 3.4m, so three courses give a ten-metre face. */
for (let c = 0; c < 3; c++) {
  const wide = 13 - c * 2
  for (let i = 0; i < wide; i++) {
    const x = SX + (i - (wide - 1) / 2) * NAT
    // higher courses step BACK, not forward — the first cut leaned the whole
    // face out over the player's head like an overhang about to go
    const z = SZ - 13 - c * NAT * 0.75
    model(c === 2 && i === Math.floor(wide / 2) ? 'n_cliffCave' : 'n_cliff', [x, c * NAT, z], 0, NAT)
  }
}
for (let i = 0; i < 6; i++)
  model('n_cliffSlope', [SX - 20 + i * NAT * 1.2, 0, SZ - 11 + rr(-1, 1)], rr(-0.2, 0.2), NAT)

/* the mine mouth, and the head-frame over it */
model('c_gateRock', [SX, 0, SZ - 9.4], 0, 1.6)
model('c_gateBars', [SX, 0, SZ - 9.0], 0, 1.6)
prim('box', [0.5, 7.5, 0.5], '#5a4a3a', [SX - 3.4, 3.75, SZ - 6.5], { tex: 'wood', rough: 0.9 })
prim('box', [0.5, 7.5, 0.5], '#5a4a3a', [SX + 3.4, 3.75, SZ - 6.5], { tex: 'wood', rough: 0.9 })
prim('box', [7.8, 0.5, 0.5], '#5a4a3a', [SX, 7.4, SZ - 6.5], { tex: 'wood', rough: 0.9 })
prim('cylinder', [0.9, 0.9, 0.5], '#4a4a4a', [SX, 6.7, SZ - 6.5], { rotZ: Math.PI/2, metal: 0.8, rough: 0.35 })
model('c_ladder', [SX + 5.6, 0, SZ - 8], 0, 1.4)

/* spoil heaps, ore boulders and the carts that move them */
for (let i = 0; i < 22; i++)
  model(pick(['n_rockTallA', 'n_rockTallD', 'n_rockLgB', 'n_stoneLgA', 'n_stoneTall']),
        [SX + rr(-19, 19), 0, SZ + rr(-8, 8)], rr(0, 6.28), NAT * rr(0.6, 1.3))
model('t_cart',     [SX - 8, 0, SZ + 3], 0.9, TOWN)
model('t_cartHigh', [SX + 9, 0, SZ + 5], -1.3, TOWN)
model('t_lantern',  [SX - 4, 0, SZ - 5], 0, TOWN)
model('t_lantern',  [SX + 4, 0, SZ - 5], 0, TOWN)
for (let i = 0; i < 6; i++) model('n_pineB', [SX + rr(-21, 21), 0, SZ + rr(9, 15)], rr(0, 6.28), NAT * rr(0.9, 1.3))

/* ------------------------------------------------------------------ *
 * the dedication                                                      *
 * ------------------------------------------------------------------ */
/* One stone at the head of the plaza. A credit, not an advert: it says who
 * built it once, where the plaza already asks you to look, and nowhere else. */
/* The Vault occupies x -7..7, z 26..38 and its door faces -Z at z=26, so the
 * head of the plaza is not free — the first cut of this stone stood inside the
 * Vault's front wall. It goes on the plaza itself, beside the walk up to the
 * Vault, facing back down towards spawn. */
const RX = -9.5, RZ = 23.4, RROT = Math.PI
model('n_column',  [RX - 1.5, 0, RZ], 0, NAT * 0.8)
model('n_column',  [RX + 1.5, 0, RZ], 0, NAT * 0.8)
prim('box', [4.6, 0.35, 1.4], STONE, [RX, 0.17, RZ], { rough: 0.85 })
prim('box', [3.4, 1.9, 0.34], STONE, [RX, 1.1, RZ], { rough: 0.8 })
prim('box', [3.0, 1.5, 0.06], '#8c6f2e', [RX, 1.15, RZ - 0.19], { metal: 0.9, rough: 0.35 })
const ded = panel(2.5, 1.28, 0.0046, [RX, 1.15, RZ - 0.24], RROT, 'rgba(24,20,10,0.0)', 'rgba(0,0,0,0)')
ded.borderWidth = 0
lines(ded, ['WORLD OF CASHCATS'], 40, '#f0d9a0', 800)
lines(ded, ['built by RobinLabs'], 26, '#e8dcc0', 400)
lines(ded, ['robinlab.io'], 24, '#c9a94e', 700)

/* ------------------------------------------------------------------ *
 * furnishing                                                          *
 * ------------------------------------------------------------------ */
/*
 * Twenty-eight props were generated for this world and then placed nowhere at
 * all — they sat in roomsrc/props/ costing credits and doing nothing while the
 * plaza stayed a car park. ground_props.py has since normalised every one of
 * them to exactly one unit tall with its base on y=0, so the last argument
 * here is simply how many metres tall the thing should be.
 */
function ob(key, pos, rotY, height) { model(key, pos, rotY, height) }

/* ---- the plaza: a centre worth standing in ---- */
/* Spawn is at [0,0,17] facing the Filing Office, so the middle of the plaza is
 * the first thing anyone sees and it was bare paving. The fountain goes behind
 * the spawn mark, not on it. */
ob('fountain', [0, 0, 21.2], 0, 3.0)
// A stone apron, and only that. The first cut was a 9m disc — a grey stain on
// the plaza — and the second still had a blue disc under it, which read as a
// puddle around a fountain that already has water in its own basins.
prim('cylinder', [2.6, 2.6, 0.16], STONE, [0, Y + 0.04, 21.2], { rough: 0.9 })

const RING = [[-6.4, 21.2], [6.4, 21.2], [0, 15.0], [-4.6, 25.2], [4.6, 25.2]]
for (let i = 0; i < RING.length; i++) {
  const a = Math.atan2(RING[i][0] - 0, RING[i][1] - 21.2)
  ob('bench', [RING[i][0], 0, RING[i][1]], a + Math.PI / 2, 0.95)
}
const PLANTERS = [[-11, 19], [11, 19], [-11, 24], [11, 24], [-17, 21.5], [17, 21.5]]
for (let i = 0; i < PLANTERS.length; i++)
  ob(i % 2 ? 'planterRound' : 'planter', [PLANTERS[i][0], 0, PLANTERS[i][1]], i * 0.9, i % 2 ? 2.2 : 1.1)

const PLAMPS = [[-13.5, 16.5], [13.5, 16.5], [-13.5, 23.5], [13.5, 23.5], [-22, 20], [22, 20]]
for (let i = 0; i < PLAMPS.length; i++)
  ob('lamp', [PLAMPS[i][0], 0, PLAMPS[i][1]], 0, 4.4)
ob('bin', [-8.4, 0, 16.2], 0.4, 1.1)
ob('bin', [ 8.4, 0, 16.2], -0.4, 1.1)
for (let i = 0; i < 8; i++) {
  ob('bollard', [-26 + i * 7.4, 0, 25.4], 0, 0.95)
  ob('bollard', [-26 + i * 7.4, 0,  8.4], 0, 0.95)
}
/* No fingerpost here. The generated one came back bright green and read as a
 * lollipop against the stone, and the four obelisk markers at the plaza edges
 * already do the wayfinding in a material the plaza actually uses. */

/* ---- the Fields: a working yard ---- */
ob('well',     [FX - 8.5, 0, FZ + 2.5], 0.3, 2.4)
ob('trough',   [FX - 5.0, 0, FZ + 6.0], 0.0, 0.8)
ob('haystack', [FX + 6.5, 0, FZ + 9.5], 0.7, 2.3)
ob('haystack', [FX + 9.0, 0, FZ + 8.0], 1.9, 1.8)
ob('toolRack', [FX - 13.5, 0, FZ - 6.5], -0.4, 2.0)
ob('fence',    [FX + 3.0, 0, FZ - 6.0], 0.0, 1.2)
for (let i = 0; i < 6; i++)
  ob('sack', [FX - 3 + i * 1.1, 0, FZ + 16.2], rr(0, 6.28), 0.85)
for (let i = 0; i < 5; i++)
  ob('crate', [FX + 14 + rr(-2, 2), 0, FZ + 13 + rr(-2, 2)], rr(0, 6.28), 1.0)
for (let i = 0; i < 4; i++)
  ob('barrel', [FX - 19 + rr(-1.5, 1.5), 0, FZ + 12 + rr(-2, 2)], rr(0, 6.28), 1.05)
ob('lantern', [FX - 8.5, 2.6, FZ + 2.5], 0, 0.6)

/* ---- the Docks: gear on the boards ---- */
ob('chest',   [DX + 10.5, 0, SHORE_Z - 6.5], -0.4, 1.0)
ob('barrel',  [DX + 6.0,  0, SHORE_Z - 7.2],  0.7, 1.05)
ob('barrel',  [DX + 7.3,  0, SHORE_Z - 6.2],  1.9, 1.05)
ob('crate',   [DX + 4.6,  0, SHORE_Z - 6.8],  0.2, 1.0)
ob('bench',   [DX - 6.0,  0, SHORE_Z - 5.0],  0.0, 0.95)
ob('lantern', [DX + 8.5,  4.7, SHORE_Z - 4.0], 0, 0.7)
ob('lamp',    [DX - 20,   0, SHORE_Z - 4.0],  0, 4.0)
ob('lamp',    [DX + 20,   0, SHORE_Z - 4.0],  0, 4.0)

/* ---- the Grove: a camp people sit at ---- */
ob('bench',   [GX - 3.2, 0, GZ + 2.6],  0.5, 0.95)
ob('bench',   [GX + 3.2, 0, GZ + 2.6], -0.5, 0.95)
ob('lantern', [GX - 6.0, 0, GZ - 3.0],  0,   0.9)
ob('basket',  [GX + 1.6, 0, GZ + 4.2],  0.8, 0.7)
ob('basket',  [GX - 2.2, 0, GZ + 3.6], -1.1, 0.7)
ob('crate',   [GX + 6.4, 0, GZ + 1.0],  0.3, 1.0)

/* ---- the Seam: a working face ---- */
ob('toolbox', [SX - 5.5, 0, SZ - 3.0],  0.4, 0.6)
ob('crate',   [SX + 6.5, 0, SZ - 2.0], -0.6, 1.0)
ob('crate',   [SX + 7.8, 0, SZ - 3.1],  0.9, 1.0)
ob('barrel',  [SX - 8.0, 0, SZ - 2.4],  0.2, 1.05)
ob('lantern', [SX,       0, SZ - 4.8],  0,   0.9)
ob('anvil',   [SX + 10,  0, SZ + 1.5], -0.8, 0.9)
ob('bench',   [SX - 12,  0, SZ + 2.0],  0.0, 0.95)
