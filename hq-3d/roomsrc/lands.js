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

// TOWN was 3.6, which made a one-storey cottage 3.6m to the eaves with a 1.8m
// window in it — the cat came up to the doorknob. Kenney draws this kit at
// roughly one unit to a storey, so 2.7 puts a door at head height.
const NAT = 3.4, TOWN = 2.7, PIR = 1.5, SMALL = 0.65
const Y = 0.02
// This app draws on both sides — the server needs the geometry for collision,
// the client needs it to look at. Streaming is a client-only concern.
const isServer = world.isServer

const GOLD='#a9812a', GOLD_L='#e8c25a', CREAM='#e8f2ec', INK='#16150f'
const DIM='#8fa39a', PAPER='#f4f0e3', GREEN='#1a7f4b'
const SOIL='#5c4630', SAND='#d9c89a', WATER='#3f9dc4', WATER_D='#2b6f8f'
const LIME='#2ecc71'
const STONE='#cfc9b8', STONE_D='#a8a291', GRASS='#4f8f4a'
// The ground sheets are photographic albedos already retinted to the colour
// they should be (fetch_tex.py), so the prim must not tint them again — a
// mid-grey multiply is what turned the Seam's gravel into tarmac. White here
// is safe where it was not on the walls: these average around half value and
// face up at a sky they never clipped against.
const WHITE='#ffffff'

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

/*
 * A textured ground, laid as a grid rather than one plane.
 *
 * Every ground here used to be a single big box with one texture stretched
 * over it, which at forty metres is a smear the eye reads as flat colour —
 * and flat colour ground is the loudest cartoon tell in the world, louder
 * than any building. Prims have no repeat control (Prim.js sets material.map
 * and stops, and the material is cached across every prim sharing a key), so
 * the repeat has to come from somewhere else.
 *
 * It comes from here. Each cell is its own prim with its own 0..1 UV, so a
 * sheet baked at twelve tiles laid on a five-by-four grid repeats sixty times
 * across the ground. Cells are ~11m; smaller would tile better and cost more
 * draw calls than the gain is worth.
 *
 * Heights matter more than they look. Y is 0.05 and the scene's own terrain
 * is at 0, so a ground laid at Y-0.13 tops out two centimetres above it and
 * loses the z-fight from any distance — the first pass laid grass across the
 * whole Cat Park and rendered the terrain's flat green instead. The world now
 * stacks in the order you walk on it: ground cover at Y-0.04, paving and
 * paths at Y+0.02 on top of it, both clear of the terrain by a hand's width.
 */
function ground(cx, cz, w, d, y, tex, color, opts) {
  opts = opts || {}
  const cell = opts.cell || 11
  const nx = Math.max(1, Math.round(w / cell))
  const nz = Math.max(1, Math.round(d / cell))
  const sx = w / nx, sz = d / nz
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      prim('box', [sx, 0.2, sz], color,
           [cx - w / 2 + sx * (i + 0.5), y, cz - d / 2 + sz * (j + 0.5)],
           { tex: tex, rough: opts.rough === undefined ? 1.0 : opts.rough,
             metal: opts.metal })
    }
  }
}

/*
 * STREAMING — why anything here is deferred at all.
 *
 * The blueprints are already preload:false, so nothing is force-fetched. The
 * reason a player still downloaded sixty-five megabytes before they could
 * move is simpler and entirely ours: every room script called world.load() the
 * moment it mounted, for everything it would ever draw. All of it, at once,
 * over one connection, whether or not you ever walked to that end of the map.
 *
 * world.load IS the fetch. Not calling it does not fetch. So a model given a
 * `near` gets registered here instead and loaded the first time the local
 * player comes within range — and if they never go to the Docks, the galleon
 * never crosses the wire.
 *
 * Two things this deliberately does not try to be. It does not unload: once
 * something is in, it stays, because the loader caches by url anyway and
 * thrashing big models on a distance check is worse than the memory. And the
 * radii are generous rather than tight — a 24-metre ship needs to exist before
 * you can see it is missing, so this is about not fetching everything in the
 * first second, not about squeezing the last megabyte.
 *
 * Server side there is no local player and nothing to draw, so it just loads
 * immediately — the server needs the geometry for collision regardless.
 */
const LAZY = []
function whenNear(cx, cz, r, fn) {
  if (isServer) return fn()
  LAZY.push({ cx, cz, r2: r * r, fn })
}
if (!isServer) {
  let every = 0
  app.on('update', () => {
    if (!LAZY.length) return
    if (++every % 15) return          // four times a second is plenty
    const p = world.getPlayer()
    if (!p) return
    const q = p.position
    for (let i = LAZY.length - 1; i >= 0; i--) {
      const L = LAZY[i]
      const dx = q.x - L.cx, dz = q.z - L.cz
      if (dx * dx + dz * dz > L.r2) continue
      LAZY.splice(i, 1)
      L.fn()
    }
  })
}

// world.load, not app.load — app has no loader. Getting that wrong threw on
// the first model and took the whole script with it, which is how the campus
// shipped with no skyline, no trees and no lamps and nothing said a word.
function model(key, pos, rotY, scale, opts) {
  const prop = props[key]
  if (!prop || !prop.url) return
  opts = opts || {}
  if (opts.near) {
    const n = opts.near
    const o = {}
    for (const k in opts) if (k !== 'near') o[k] = opts[k]
    return whenNear(n[0], n[1], n[2], () => model(key, pos, rotY, scale, o))
  }
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
  // res 1, not the engine default of 2. res multiplies the canvas in BOTH
  // axes, so a board that is 1038 px wide allocates 2076x1538 = 3.2M pixels —
  // 12.8 MB of canvas backing store and as much again on the GPU — for signage
  // read from three metres away. Across the 44 panels in this world that was
  // most of half a gigabyte spent on supersampling text nobody stands close
  // enough to see the edges of.
  u.res = 1
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
  prim('box', [w, 0.26, len], '#c8c1ae', [(x1 + x2) / 2, Y - 0.13, (z1 + z2) / 2],
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
 * THE FIELDS — a village, not five houses in a paddock                *
 * ------------------------------------------------------------------ */
/*
 * The first cut scattered five cottages across a yard and called it a
 * settlement. Walking it, the problem was obvious: there was no street. Houses
 * facing nothing in particular, with gaps between them you could drive a bus
 * through, read as objects placed on grass rather than a place anyone lives.
 *
 * So: a road down the middle, houses shoulder to shoulder along both sides
 * with their doors on it, a square at the north end where the market already
 * was, crofts and crop plots behind the houses rather than beside them, and
 * the mill moved to the water at the east edge where a mill belongs. The
 * channel used to run straight through where the street is now.
 */
const FX = -47, FZ = -26
const ST_W = 7.5                     // the street
const CHAN_X = FX + 19               // the mill channel, out at the east edge

/* CROP_S, not NAT. The bed grid is terrain-scale — a 3.4m row is a row you can
 * walk between — but the plants are not terrain. At NAT the corn came out 4.25m
 * tall and the pumpkins were a metre across. */
const CROP_S = 1.35

/*
 * A cottage from the town kit. The kit is a 1-unit grid and a wall piece is a
 * slab on the +X edge of its cell, so a rotation of 0 / -90 / 180 / +90 puts
 * one on the +X / +Z / -X / -Z side. Perimeter cells get walls on their
 * outward faces; a roof gable caps each cell.
 */
function cottage(cx, cz, w, d, rot, wood, storeys, open) {
  const S = TOWN
  storeys = storeys || 1
  const wallK  = wood ? 't_wallWood'  : 't_wall'
  const doorK  = wood ? 't_wallWoodD' : 't_wallDoor'
  const winK   = wood ? 't_wallWoodW' : 't_wallWin'
  const cos = Math.cos(rot), sin = Math.sin(rot)
  /*
   * `open` makes the building one you can walk into.
   *
   * A closed cottage gets a single invisible box over its whole footprint,
   * which is cheap and right for scenery. That box is also exactly what makes
   * a door decorative: the kit already places a door piece, and you still
   * bounce off the building. So an open one gets a collider per wall piece
   * instead, skipping the door cell, plus a floor to stand on.
   *
   * Per-piece colliders are the expensive option and only worth it where
   * somebody is meant to go inside, which is why it is a flag and not the
   * default — a village of forty enterable houses is forty times the bodies
   * for thirty-nine interiors nobody visits.
   */
  const doorAt = { lx: null, lz: null }
  const place = (lx, lz, k, r, y) => {
    const wx = cx + lx * cos + lz * sin, wz = cz - lx * sin + lz * cos
    model(k, [wx, y || 0, wz], rot + r, S)
    if (!open || y) return
    if (k === doorK) { doorAt.lx = lx; doorAt.lz = lz; return }   // leave the way in clear
    // the wall sits on the +X edge of its cell, so the body goes half a cell
    // out along that heading. local +X maps to (cos, -sin) in world.
    const th = rot + r
    prim('box', [0.4, storeys * S, S], '#ffffff',
         [wx + Math.cos(th) * S / 2, storeys * S / 2, wz - Math.sin(th) * S / 2],
         { rotY: th, physics: 'static', opacity: 0 })
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
  if (open) {
    // a floor, or you stand on the terrain and see daylight under the walls
    prim('box', [w * S, 0.2, d * S], '#8a6f4c',
         [cx, 0.08, cz], { rotY: rot, tex: 'wood', rough: 0.95, physics: 'static' })
    return
  }
  // the box that actually stops you walking through the wall
  prim('box', [w * S, storeys * S, d * S], '#ffffff',
       [cx, storeys * S / 2, cz], { rotY: rot, physics: 'static', opacity: 0 })
}

/* the street itself, and the square at its head */
prim('box', [ST_W, 0.22, 46], '#c8c1ae', [FX, Y + 0.02, FZ], { tex: 'paving', rough: 1.0 })
prim('box', [ST_W + 1.6, 0.06, 46], STONE_D, [FX, Y - 0.02, FZ])
prim('box', [26, 0.22, 15], '#c8c1ae', [FX, Y + 0.02, FZ + 15], { tex: 'paving', rough: 1.0 })
// worked ground around the village, so the farm stands in soil rather than on lawn
// 62x44 left the village standing on a green sheet the moment you looked at
// it from outside. Wider, and the outer band is grass rather than worked dirt
// so the farm reads as the middle of something rather than a rectangle.
ground(FX, FZ - 2, 96, 76, Y - 0.05, 'grass', WHITE, { cell: 12 })
ground(FX, FZ - 4, 62, 44, Y - 0.04, 'field', WHITE)
for (let i = 0; i < 12; i++) {        // cobble banding so it is not one sheet
  prim('box', [ST_W, 0.03, 0.35], STONE_D, [FX, Y + 0.01, FZ - 22 + i * 4])
}

/*
 * Houses along both sides. cottage() puts the door on the +X face of its own
 * frame, so the west row faces the street at rot 0 and the east row at rot PI.
 * Depths and storeys vary along the row — a street where every house is the
 * same is a corridor.
 */
/*
 * The village.
 *
 * It used to be two straight rows of five facing each other down one street,
 * which is not a village, it is a corridor with doors. A village happens where
 * roads meet: a main street, a lane crossing it, a green with the public
 * buildings round it, and houses that sit at whatever angle their plot gave
 * them rather than all square to the same line.
 *
 * So: a lane east-west, a green off to the west with the Hall on it, houses in
 * clusters at varied setbacks and angles, and the plots for sale along the
 * north edge where the village is still growing.
 *
 * Each row is [dx, dz, w, d, storeys, rot, wood]. Positions are hand-placed
 * rather than generated — a village is the one thing a loop is bad at, because
 * what makes it read is the irregularity and a loop has none.
 */
const LANE_Z = FZ - 9
const GRN_X = FX - 17, GRN_Z = FZ + 5

// the lane, and the green it opens onto
prim('box', [40, 0.22, 6.0], '#c8c1ae', [FX - 4, Y + 0.02, LANE_Z], { tex: 'paving', rough: 1.0 })
prim('box', [42, 0.06, 7.4], STONE_D, [FX - 4, Y - 0.02, LANE_Z])
// A round green, not a rectangle. ground() lays a grid of boxes, which is
// right for a field and wrong here: a hard-edged rectangle of lawn dropped
// into worked dirt reads as a texture swap rather than a place, and the seam
// is the first thing the eye finds. One disc, and planting round the rim to
// break the line where it meets the lane.
prim('cylinder', [10.5, 10.5, 0.2], WHITE, [GRN_X, Y - 0.03, GRN_Z], { tex: 'grass', rough: 1.0 })
for (let i = 0; i < 16; i++) {
  const a = i / 16 * Math.PI * 2
  model(pick(['n_bushL', 'n_bushS', 'n_grassLeaf', 'n_flowerY', 'n_flowerP']),
        [GRN_X + Math.cos(a) * rr(9.6, 11.2), 0, GRN_Z + Math.sin(a) * rr(9.6, 11.2)],
        rr(0, 6.28), NAT * rr(0.6, 0.9))
}
prim('box', [6.0, 0.22, 22], '#c8c1ae', [GRN_X + 8, Y + 0.02, GRN_Z - 2], { tex: 'paving', rough: 1.0 })

const HOUSES = [
  // fronting the main street, west side — setbacks vary so the frontage is
  // not a drawn line
  [-11.0, -20, 2, 2, 1,  0.00, 1],
  [-12.4, -14, 2, 3, 2,  0.12, 0],
  [-10.6,   1, 3, 2, 1, -0.10, 1],
  [-11.8,   8, 2, 2, 1,  0.00, 0],
  [-12.6,  16, 2, 3, 2,  0.14, 1],
  // east side
  [ 11.2, -19, 2, 3, 2,  Math.PI,        0],
  [ 10.4, -13, 3, 2, 1,  Math.PI - 0.12, 1],
  [ 11.6,  -2, 2, 2, 1,  Math.PI,        0],
  [ 10.8,   6, 2, 3, 2,  Math.PI + 0.10, 1],
  [ 12.0,  15, 2, 2, 1,  Math.PI,        0],
  // turning the corner onto the lane — these face the lane, not the street
  [ -6.0, -15.5, 2, 2, 1, -Math.PI / 2, 0],
  [  3.5, -15.5, 3, 2, 1, -Math.PI / 2, 1],
  [ 15.5, -15.0, 2, 2, 1, -Math.PI / 2, 0],
  [ -6.5,  -3.0, 2, 2, 1,  Math.PI / 2, 1],
  [  5.0,  -3.2, 2, 3, 2,  Math.PI / 2, 0],
  // round the green, three sides of it, backs to the fields
  [-24.0,  -2.0, 2, 2, 1,  Math.PI / 2, 1],
  [-24.5,   3.0, 3, 2, 1,  Math.PI / 2, 0],
  [-23.5,   9.0, 2, 2, 1,  Math.PI / 2, 1],
  [-13.0,  13.5, 2, 2, 1,  Math.PI,     0],
  [-21.0,  13.0, 2, 3, 2,  Math.PI,     1],
]
for (const [dx, dz, w, d, st, rot, wood] of HOUSES) {
  cottage(FX + dx, FZ + dz, w, d, rot, !!wood, st)
}

/*
 * The three you can walk into.
 *
 * "Many open works that u seamless may can enter" — every building enterable
 * is forty interiors nobody visits and forty times the collision bodies, so
 * these are the three a player has a reason to enter: the Hall on the green,
 * the Inn on the corner where the lane meets the street, and the Land Office
 * where the plots are sold. They are built by the same function as every other
 * house with one flag set, so they match their neighbours exactly rather than
 * announcing themselves as the special ones.
 */
cottage(GRN_X - 1, GRN_Z + 6.5, 3, 3, Math.PI, false, 2, true)   // the Hall
cottage(FX - 12.0, LANE_Z - 6.5, 3, 3, 0, true, 2, true)          // the Inn
cottage(FX + 12.5, LANE_Z - 6.0, 2, 3, Math.PI, false, 1, true)   // the Land Office

const hallSign = panel(3.4, 0.8, 0.005, [GRN_X - 1, 3.1, GRN_Z + 2.2], Math.PI, 'rgba(14,26,20,0.92)', GOLD_L)
text(hallSign, 'THE VILLAGE HALL', 34, GOLD_L, 800)
const innSign = panel(2.8, 0.8, 0.005, [FX - 7.4, 3.1, LANE_Z - 6.5], -Math.PI / 2, 'rgba(14,26,20,0.92)', GOLD_L)
text(innSign, 'THE INN', 34, GOLD_L, 800)
const loSign = panel(3.6, 0.8, 0.005, [FX + 8.2, 2.9, LANE_Z - 6.0], Math.PI / 2, 'rgba(14,26,20,0.92)', LIME)
text(loSign, 'PLOTS — TO BUY OR RENT', 26, LIME, 800)

/*
 * The plots, along the north edge where the village is still growing.
 *
 * Ahmad's land system sells plots at the Homestead, so these are the same
 * thing standing where a player can see it: a marked, numbered, fenced piece
 * of ground with a board on it. Nothing is sold here — the board points at the
 * Land Office — but a village where you can see the empty plots is a village
 * that looks like it is going somewhere, which one where land is an abstraction
 * in a menu does not.
 */
const PLOTW = 9
for (let i = 0; i < 5; i++) {
  const px = FX - 20 + i * (PLOTW + 1.6), pz = FZ - 25.5
  ground(px, pz, PLOTW, 8, Y - 0.035, 'field', WHITE, { cell: 9 })
  for (let k = 0; k < 4; k++) {
    model('t_fence', [px - PLOTW / 2 + k * (PLOTW / 3.4), 0, pz - 4], 0, TOWN * 0.9)
    model('t_fence', [px - PLOTW / 2 + k * (PLOTW / 3.4), 0, pz + 4], 0, TOWN * 0.9)
  }
  const b = panel(2.6, 1.5, 0.005, [px, 1.9, pz + 4.3], 0, 'rgba(14,26,20,0.92)', LIME)
  text(b, 'PLOT ' + (i + 1), 34, LIME, 800)
  text(b, i % 2 ? 'TO RENT' : 'FOR SALE', 26, CREAM, 600, 4)
  text(b, 'ask at the Land Office', 18, DIM, 400, 4)
}

/*
 * VILLAGERS
 *
 * "Should see cats working the farm, fixing there houses etc you know like
 * needs npc doing stuff."
 *
 * There are no work animations in this build — the emote set is jump, fall,
 * float, flip and talk, and none of them is hoeing. So the work is told by
 * staging rather than animation: a cat at the foot of a ladder with a plank
 * pile beside it is fixing a roof, and a cat between two crop beds holding a
 * basket is picking. What the talk emote buys is that they are not statues;
 * a figure that shifts its weight reads as alive at any distance where you
 * cannot see what its hands are doing, which outdoors is all of them.
 *
 * They are scenery, deliberately: no pathing, no schedule, no dialogue. A
 * villager who walks needs somewhere to walk to and something to do when they
 * arrive, and half of that is worse than none.
 */
const TALK = 'asset://emote-talk.glb'
function villager(x, z, rotY, cat, emote) {
  const prop = props[cat]
  if (!prop || !prop.url) return
  // a VRM is 1.6MB and there are five of them; none is visible from the plaza
  if (!isServer && !villager.armed) {
    return whenNear(x, z, 70, () => { villager.armed = 1; villager(x, z, rotY, cat, emote); villager.armed = 0 })
  }
  const av = app.create('avatar')
  av.src = prop.url
  av.position.set(x, 0, z)
  av.rotation.y = rotY
  av.scale.set(1.05, 1.05, 1.05)
  if (emote !== false) av.emote = TALK
  app.add(av)
  return av
}

// two on the green, in conversation, because that is what a green is for
villager(GRN_X - 2.2, GRN_Z - 1.0,  0.7, 'avLong')
villager(GRN_X - 0.6, GRN_Z - 1.6, -2.4, 'avApple')

// fixing a roof: ladder up the gable, a cat at its foot, timber stacked
// 1.0, because the cave kit is authored in real metres and this model is 2.9
// of them. At 2.6 it was a seven-and-a-half metre ladder leaning on a
// single-storey cottage whose eaves are under three.
model('c_ladder', [FX - 9.0, 0, FZ + 9.4], Math.PI / 2, 1.0)
villager(FX - 10.2, FZ + 10.4, -1.2, 'avSerious')
for (let i = 0; i < 4; i++)
  prim('box', [2.4, 0.16, 0.34], '#8a6f4c', [FX - 11.6, 0.09 + i * 0.17, FZ + 11.4],
       { rotY: 0.2, tex: 'wood', rough: 0.95 })
ob('toolbox', [FX - 11.0, 0, FZ + 10.2], 0.6, 0.55)

// working the crop beds
villager(FX - 21.5, FZ - 13.0,  1.4, 'avPop')
ob('basket', [FX - 20.7, 0, FZ - 13.4], 0.3, 0.6)
villager(FX + 21.0, FZ - 3.4, -1.5, 'avCash')
ob('sack',   [FX + 21.8, 0, FZ - 3.8], 0.9, 0.8)

// minding a market stall, and one walking the lane
villager(FX - 2.5, FZ + 17.4, Math.PI, 'avLong')
villager(FX + 2.0, LANE_Z + 1.2, -Math.PI / 2, 'avApple')

/* lamps and hedging down the street, so the frontage reads as kept */
for (let i = 0; i < 6; i++) {
  const z = FZ - 20 + i * 8
  model('t_lantern', [FX - ST_W / 2 - 0.6, 0, z], 0, TOWN)
  model('t_lantern', [FX + ST_W / 2 + 0.6, 0, z], 0, TOWN)
}
for (let i = 0; i < 22; i++) {
  const z = FZ - 23 + i * 2.1
  if (Math.abs(z - (FZ + 15)) < 8) continue      // leave the square open
  model('t_hedge', [FX - ST_W / 2 - 1.4, 0, z], 0, TOWN * 0.8)
  model('t_hedge', [FX + ST_W / 2 + 1.4, 0, z], 0, TOWN * 0.8)
}

/* the market square at the head of the street */
const MKT = [['t_stallGrn', -7], ['t_stallRed', -2.5], ['t_stall', 2], ['t_stallGrn', 6.5]]
for (let i = 0; i < MKT.length; i++) {
  model(MKT[i][0], [FX + MKT[i][1], 0, FZ + 19.5], Math.PI, TOWN)
  model('t_stallBnch', [FX + MKT[i][1], 0, FZ + 17.8], Math.PI, TOWN)
  if (i % 2 === 0) model('t_bannerGrn', [FX + MKT[i][1] - 1.9, 0, FZ + 20.2], Math.PI, TOWN)
}
ob('well',   [FX,      0, FZ + 12.5], 0.3, 2.4)
model('t_cart',     [FX + 9, 0, FZ + 17], 0.8, TOWN)
model('t_cartHigh', [FX - 9, 0, FZ + 16], -0.4, TOWN)
for (let i = 0; i < 6; i++) ob('sack', [FX - 4 + i * 1.2, 0, FZ + 18.6], rr(0, 6.28), 0.85)
for (let i = 0; i < 5; i++) ob('crate', [FX + 8 + rr(-2, 2), 0, FZ + 20 + rr(-1.5, 1.5)], rr(0, 6.28), 1.0)
for (let i = 0; i < 4; i++) ob('barrel', [FX - 10 + rr(-1.5, 1.5), 0, FZ + 20 + rr(-1.5, 1.5)], rr(0, 6.28), 1.05)

/* the mill, on the water at the east edge */
prim('box', [5.5, 0.3, 40], '#8fd4e8', [CHAN_X, Y + 0.06, FZ], { tex: 'water', rough: 0.06, metal: 0.32 })
prim('box', [6.8, 0.24, 40], STONE_D, [CHAN_X, Y - 0.02, FZ])
model('t_watermill', [CHAN_X - 3.2, 0, FZ - 2], 0, TOWN * 0.85)
model('n_bridge', [CHAN_X, 0, FZ + 8], Math.PI / 2, NAT)
for (let i = 0; i < 6; i++) model('n_lily', [CHAN_X + rr(-1.6, 1.6), 0.2, FZ - 14 + i * 5], rr(0, 6.28), NAT * 0.9)
model('t_windmill', [FX - 26, 0, FZ - 6], 0.6, TOWN * 0.95)

/*
 * Crofts behind the houses: each one fenced, planted, and at a different
 * stage, so the back of the village is worked ground rather than lawn.
 */
function plot(px, pz, cols, rows, crop) {
  const S = NAT
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = px + (c - (cols - 1) / 2) * S, z = pz + (r - (rows - 1) / 2) * S
      model('n_dirtRow', [x, 0, z], 0, S)
      if (crop) for (let k = -1; k <= 1; k++)
        model(crop, [x + k * S * 0.3, 0.14, z + rr(-0.5, 0.5)], rr(0, 6.28), CROP_S * rr(0.85, 1.05))
    }
  }
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
plot(FX - 22, FZ - 14, 3, 2, 'n_wheatB')
plot(FX - 22, FZ -  1, 3, 2, 'n_cornD')
plot(FX - 21, FZ + 11, 2, 2, 'n_pumpkin')
plot(FX + 22, FZ - 16, 2, 2, 'n_carrot')
plot(FX + 23, FZ -  4, 3, 2, 'n_wheatA')
plot(FX + 22, FZ +  9, 2, 2, 'n_melon')

/* the working end: troughs, hay, tools, a paddock */
ob('trough',   [FX - 15, 0, FZ + 6.5], 0.0, 0.8)
ob('haystack', [FX - 19, 0, FZ + 5.0], 0.7, 2.3)
ob('haystack', [FX - 17, 0, FZ + 3.2], 1.9, 1.8)
ob('toolRack', [FX + 16, 0, FZ + 3.0], -Math.PI / 2, 2.0)
ob('fence',    [FX + 15, 0, FZ + 6.0], 0.0, 1.2)
/*
 * The paddock rail. Nine panels at 3.4 is thirty metres of fence, and it ran
 * straight across the main street at chest height — at that scale the top
 * rails merge into one unbroken beam, so from above the village looked like
 * it had a plank laid across it. It is a paddock boundary, so it stops at the
 * street and picks up on the other side, which is what a fence does when it
 * meets a road.
 */
for (let i = 0; i < 9; i++) {
  const fx = FX - 26 + i * NAT
  if (Math.abs(fx - FX) < ST_W / 2 + NAT * 0.6) continue     // leave the street open
  model('n_fenceHigh', [fx, 0, FZ + 8], 0, NAT)
}

/* trees and rough ground around the edges so the village sits in something */
for (let i = 0; i < 18; i++) {
  const side = i % 2 ? 1 : -1
  model(pick(['n_oak', 'n_fat', 'n_pineA', 'n_blocks']),
        [FX + side * rr(28, 38), 0, FZ + rr(-24, 24)], rr(0, 6.28), NAT * rr(0.9, 1.3))
}
for (let i = 0; i < 16; i++)
  model(pick(['n_bushL', 'n_bushS', 'n_grassLeaf', 'n_potLarge', 'n_stump']),
        [FX + rr(-30, 30), 0, FZ + rr(-25, 25)], rr(0, 6.28), NAT * rr(0.6, 1.0))
// a few high-detail pieces among the kit ones — the eye lands on the detailed
// thing and reads the whole group as better than it is
for (let i = 0; i < 7; i++)
  model(pick(['hq_fern_02', 'hq_dandelion_01', 'hq_potted_plant_02', 'hq_dead_tree_trunk']),
        [FX + rr(-28, 28), 0, FZ + rr(-23, 23)], rr(0, 6.28), rr(0.8, 1.4))

/* ------------------------------------------------------------------ *
 * THE DOCKS — the lake                                                *
 * ------------------------------------------------------------------ */
const DX = -47, DZ = 54
const SHORE_Z = DZ - 16          // sand ends, water begins

prim('box', [56, 0.2, 14], '#c8c1ae', [DX, Y + 0.02, SHORE_Z - 7], { tex: 'paving', rough: 1.0 })
ground(DX, SHORE_Z - 1, 56, 12, Y - 0.05, 'sand', WHITE, { cell: 9 })
// the lake. Low roughness with a little metalness is what reads as water on a
// prim — there is no transparency to lean on.
// Metalness 0.45 on a dark blue is a mirror with no diffuse left, and against
// this sky it read as a flat navy wall standing at the end of the jetty.
// Water in a stylised world wants to be bright and barely metallic.
// 64 wide ran the lake from x=-79 to x=-15, and the Cat Park's lawn starts
// at x=-29 — so fourteen metres of open water lay across the park with a
// row of sitting-boxes in it. 38 stops the lake just past the East Jetty at
// x=-28.9, which is the furthest thing that actually has to float.
/*
 * Water, which is a material problem and not a texture one.
 *
 * It was a flat cyan slab at roughness 0.45 — matte, so it returned the same
 * value from every angle and read as painted card. Everything in this world is
 * lit by the HDRI, which means a smooth surface reflects the actual sky: drop
 * roughness to 0.06 and put a little metalness on it and the lake picks up the
 * clouds and the sun for free, no shader and no animation.
 *
 * The ripple texture is faint on purpose. Its job is to break the reflection
 * up — a perfect mirror at this scale reads as glass — not to look like a
 * photograph of water, which at one albedo map and no normals it could not.
 */
prim('box', [38, 0.5, 44], '#8fd4e8', [DX, Y - 0.18, SHORE_Z + 20],
     { tex: 'water', rough: 0.06, metal: 0.32 })
prim('box', [40, 0.3, 46], WATER_D, [DX, Y - 0.3, SHORE_Z + 20], { rough: 0.35, metal: 0.2 })

/* three jetties out over the water. The kit dock is scenery; the plank deck
 * under it is what carries a player, so it is a static prim. */
function jetty(jx, len, wide) {
  prim('box', [wide, 0.36, len], '#8a6f4c', [jx, 0.55, SHORE_Z + len / 2 - 1],
       { tex: 'wood', rough: 0.85, physics: 'static' })
  // No kit dock platforms here. structure-platform-dock is 1.31 units tall —
  // 2 metres at this scale — and it is a deck in its own right, so dropping
  // one at y=0 under a plank deck at 0.73 puts a chest-high block on the
  // walkway. Three of them in a row down the middle of a jetty is a wall with
  // a fishing spot behind it. The planks are the deck; these are the piles.
  for (let i = 0; i < Math.floor(len / 4); i++) {
    const z = SHORE_Z + 1.5 + i * 4
    prim('cylinder', [0.22, 0.22, 1.6], '#6b543a', [jx - wide / 2 + 0.3, -0.2, z], { rough: 0.9 })
    prim('cylinder', [0.22, 0.22, 1.6], '#6b543a', [jx + wide / 2 - 0.3, -0.2, z], { rough: 0.9 })
    prim('box', [wide + 0.5, 0.18, 0.35], '#7a6244', [jx, 0.72, z], { rough: 0.9 })
  }
  // a ramp up from the sand so you can actually get on
  prim('box', [wide, 0.3, 3.2], '#8a6f4c', [jx, 0.28, SHORE_Z - 2.2],
       { tex: 'wood', rough: 0.85, rotX: -0.16, physics: 'static' })
}
jetty(DX - 16, 20, 4.2)
jetty(DX,      28, 5.0)
jetty(DX + 16, 16, 4.2)

/* the fish shack at the head of the middle jetty */
/*
 * The harbour front.
 *
 * modular_urban_apartments_facade is not a building, it is a kit — 175 meshes
 * laid out across 51 metres, the way an asset pack presents its parts. Which
 * is also, exactly, what a waterfront is: a row of frontages side by side. So
 * it goes in as authored rather than being split up and reassembled, and one
 * model load buys the whole terrace.
 *
 * This is the first real architecture standing where a player actually is. The
 * Kenney city ring stays where it is, out at 125 metres, because at that
 * distance nothing it lacks is visible and it costs almost nothing.
 */
// Measured, not eyeballed: the kit's bbox runs y -2..15 and z -6.2..0.4, so
// its origin is two metres above its own footing and it builds backwards from
// there. At y=0 it stood sunk to the shins; at y=2 it sits on the ground with
// its frontage on z, facing the water the way a quayside terrace does.
model('hq_modular_urban_apartments_facade', [DX, 2.0, SHORE_Z - 8], 0, 1.0, { near: [DX, SHORE_Z - 8, 95] })

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
/*
 * The ship, and why it is not the Kenney one any more.
 *
 * p_ship is 72 triangles carrying a palette swatch — no normal map, no
 * roughness — so under this HDRI it is a flat salmon wedge. dutch_ship_medium
 * is a photogrammetry-grade hull with albedo, normal and roughness, and it
 * costs 31k triangles and 1.1MB after decimation.
 *
 * That trade is the whole argument about detail in this build. The engine was
 * never the limit: glbToNodes wires normalMap and always has, which is why a
 * photoscanned barrel reads as real in the same frame where a Kenney wall
 * reads as cardboard. What was missing was assets that carry the maps.
 *
 * It is 24 metres long as authored, so no scaling — it is already the size a
 * ship should be next to a 20-metre jetty.
 */
// x=-73 put her seven metres past the west bank — the lake was narrowed to 38
// to keep it out of the Cat Park and the ship never moved with it. Water runs
// x -66..-28, so she sits at -58 with room to swing.
model('hq_dutch_ship_medium', [DX - 11, -0.6, SHORE_Z + 28], 0.55, 1.0, { near: [DX, SHORE_Z + 10, 95] })
model('p_wreck', [DX + 25,   0.0, SHORE_Z + 33], -1.1, PIR * 1.2)
for (let i = 0; i < 9; i++)
  model(i % 2 ? 'm_palm' : 'p_palmBend',
        [DX - 26 + i * 6.4 + rr(-1.5, 1.5), 0, SHORE_Z - rr(5, 11)], rr(0, 6.28), PIR * rr(0.85, 1.15))
// rocks-sand-a is 5.1 x 3.2 x 4.4 UNITS, not one — at the pirate scale it came
// out a nine-metre boulder, and a dozen of them terraced the whole shoreline
// like a quarry. One scale across three kits is never right; measure each.
for (let i = 0; i < 8; i++)
  model('p_rocksSand', [DX + rr(-27, 27), 0, SHORE_Z + rr(-9, 0)], rr(0, 6.28), rr(0.30, 0.55))
for (let i = 0; i < 8; i++)
  model(rnd() > 0.5 ? 'n_stoneLgA' : 'p_patchSand',
        [DX + rr(-27, 27), 0, SHORE_Z + rr(-9, 1)], rr(0, 6.28), NAT * rr(0.5, 0.9))
for (let i = 0; i < 16; i++)
  model(rnd() > 0.5 ? 'n_lily' : 'n_lilySm',
        [DX + rr(-28, 28), 0.24, SHORE_Z + rr(4, 34)], rr(0, 6.28), NAT * rr(0.8, 1.4))

/* ------------------------------------------------------------------ *
 * THE GROVE — woodland                                                *
 * ------------------------------------------------------------------ */
const GX = 47, GZ = 52

// a clearing floor of trodden earth, then trees thick around the outside
prim('cylinder', [11, 11, 0.24], WHITE, [GX, Y + 0.02, GZ], { tex: 'forest', rough: 1.0 })
// leaf litter out past the clearing, so the wood has a floor and not a lawn
ground(GX, GZ, 46, 46, Y - 0.04, 'forest', WHITE, { cell: 12 })

for (let i = 0; i < 46; i++) {
  // Ring the clearing: dense at the rim, none in the middle. Seventy closed
  // the ring into a wall you could not see out of, and the Grove is a wood
  // with a clearing in it rather than a hedge maze.
  const a = rr(0, 6.2832), r = rr(15, 25)
  model(pick(['n_oak', 'n_fat', 'n_pineA', 'n_pineB', 'n_blocks']),
        [GX + Math.cos(a) * r, 0, GZ + Math.sin(a) * r], rr(0, 6.28), NAT * rr(0.9, 1.5))
}
for (let i = 0; i < 26; i++) {
  const a = rr(0, 6.2832), r = rr(6, 24)
  model(pick(['n_bushL', 'n_bushS', 'n_grassLeaf', 'n_stump', 'n_log']),
        [GX + Math.cos(a) * r, 0, GZ + Math.sin(a) * r], rr(0, 6.28), NAT * rr(0.7, 1.2))
}

/* the forager's camp in the clearing */
model('n_campfire', [GX, 0, GZ], 0, NAT * 0.9)
// A flame, not a bollard. [r, h] on a cone is radius and height, so the first
// one was 1.6m across and 1.5m tall and the player stood inside it.
prim('cone', [0.26, 0.62], '#ff7a2a', [GX, 0.34, GZ], { emissive: '#ff9a3a', rough: 0.4 })
model('n_tent',   [GX - 6.5, 0, GZ - 3.5], 0.9,  NAT * 0.75)
model('n_tentSm', [GX + 6.0, 0, GZ - 4.5], -0.7, NAT * 0.75)
model('n_logStack', [GX + 3, 0, GZ + 5], 0.4, NAT)
model('n_log',      [GX - 4, 0, GZ + 5.5], 1.5, NAT)
for (let i = 0; i < 5; i++) model('n_stump', [GX + rr(-8, 8), 0, GZ + rr(-8, 8)], rr(0, 6.28), NAT)
model('n_bridge', [GX - 20, 0, GZ + 16], 0.3, NAT)

/* ------------------------------------------------------------------ *
 * THE SEAM — the quarry                                               *
 * ------------------------------------------------------------------ */
const SX = 47, SZ = -27

// A quarry has no paved forecourt. The 44x34 apron that used to be here was
// laid before there was any ground texture to put down, and once the paving
// went above the gravel it buried it — the whole working floor came back as
// flagstones. Gravel over the lot, and the cliff meets ground it belongs on.
ground(SX, SZ, 44, 34, Y - 0.04, 'gravel', WHITE, { cell: 11 })

/* a cliff face across the back, stepped so it reads as a worked quarry rather
 * than a wall. The nature kit cliff block is a 1m cube at 1 unit; at 3.4 each
 * course is 3.4m, so three courses give a ten-metre face. */
const ROCK = '#b3a289', ROCK_D = '#9c8b74', ROCK_L = '#c4b49c'

/*
 * The quarry face — a real cliff, finally.
 *
 * Third attempt and the first one that is not a compromise. Prim boxes were
 * boxes. The cave kit was an interior set and read as a pink wall. The
 * nature-kit cliffs are the right shape but they are flat-shaded chunks, which
 * is the house style of that kit and exactly the cartoon look the world needed
 * to lose.
 *
 * These are photoscanned CC0 cliffs from Poly Haven carrying a diffuse, a real
 * normal map and a packed AO/roughness/metalness — the only assets in this
 * world with surface detail that survives being stood next to. coastal_cliff_01
 * is ninety-two metres of face in a single model at real-world scale, so the
 * quarry is now two of them and a corner rather than fourteen tiles in a row.
 *
 * They arrived at 188MB and 5.5 million triangles between them and are here at
 * 11MB and 245k, because the detail lives in the normal map rather than in the
 * geometry — which is the entire reason they are worth having.
 */
/*
 * The quarry face, sized to the quarry.
 *
 * cliff_01 is 91.9 metres wide as authored — I measured it rather than
 * assuming, after it turned up as a dark slab on the horizon behind the
 * village. Dropped in at full size centred near the Seam it spanned x=-5 to
 * x=+87: a wall across a third of the world, reaching back past the campus.
 * A photoscan does not come at the scale of your scene and this one is the
 * length of a street.
 *
 * The Seam's working ground is 44 across, so the face is cliff_02 at 40.8 and
 * fits it. cliff_01 stays, at half size, as a second ridge behind — which is
 * what it is good for, since the thing you want from a 46-metre rock is
 * distance and it has no business being the wall you stand at.
 */
model('hq_coastal_cliff_02', [SX,      0, SZ - 16],  0,              1.0, { near: [SX, SZ, 100] })
model('hq_coastal_cliff_01', [SX,      0, SZ - 27],  0,              0.5, { near: [SX, SZ, 100] })
model('hq_coastal_cliff_02', [SX + 24, 0, SZ -  6], -Math.PI / 2.6,  0.7, { near: [SX, SZ, 100] })
model('hq_coastal_cliff_02', [SX - 24, 0, SZ -  6],  Math.PI / 2.4,  0.7, { near: [SX, SZ, 100] })
// boulders fallen off the face, at the foot of it
const BLD = ['hq_boulder_01', 'hq_namaqualand_boulder_02', 'hq_namaqualand_boulder_03', 'hq_rock_moss_set_01']
for (let i = 0; i < 11; i++)
  model(BLD[i % BLD.length], [SX + rr(-20, 20), 0, SZ - 6 + rr(-2, 5)], rr(0, 6.28), rr(0.8, 1.9),
        { near: [SX, SZ, 70] })

/* the mine mouth, and the head-frame over it */
model('c_gateRock', [SX, 0, SZ - 9.4], 0, 1.6)
model('c_gateBars', [SX, 0, SZ - 9.0], 0, 1.6)
prim('box', [0.5, 7.5, 0.5], '#5a4a3a', [SX - 3.4, 3.75, SZ - 6.5], { tex: 'wood', rough: 0.9 })
prim('box', [0.5, 7.5, 0.5], '#5a4a3a', [SX + 3.4, 3.75, SZ - 6.5], { tex: 'wood', rough: 0.9 })
prim('box', [7.8, 0.5, 0.5], '#5a4a3a', [SX, 7.4, SZ - 6.5], { tex: 'wood', rough: 0.9 })
prim('cylinder', [0.9, 0.9, 0.5], '#4a4a4a', [SX, 6.7, SZ - 6.5], { rotZ: Math.PI/2, metal: 0.8, rough: 0.35 })
model('c_ladder', [SX + 5.6, 0, SZ - 8], 0, 1.4)

/* spoil heaps, ore boulders and the carts that move them */
// rock_* and stone_* are two different palettes in this kit — stone is nearly
// white and under this sky it read as snow scattered round a quarry.
// No kit boulders at all. Even one of them glows white next to cut stone, and
// the whole reason the face is prims is that the kit has no rock colour.
for (let i = 0; i < 16; i++)
  prim('box', [rr(0.8, 1.9), rr(0.5, 1.3), rr(0.7, 1.6)],
       i % 3 === 0 ? ROCK_L : (i % 3 === 1 ? ROCK : ROCK_D),
       [SX + rr(-19, 19), 0.35, SZ + rr(-5, 8)],
       { tex: 'paving', rough: 1.0, rotY: rr(0, 6.28) })
model('t_cart',     [SX - 8, 0, SZ + 3], 0.9, TOWN)
model('t_cartHigh', [SX + 9, 0, SZ + 5], -1.3, TOWN)
model('t_lantern',  [SX - 4, 0, SZ - 5], 0, TOWN)
model('t_lantern',  [SX + 4, 0, SZ - 5], 0, TOWN)
for (let i = 0; i < 6; i++) model('n_pineB', [SX + rr(-21, 21), 0, SZ + rr(9, 15)], rr(0, 6.28), NAT * rr(0.9, 1.3))

/* ------------------------------------------------------------------ *
 * THE SEAM — the camp that works it                                   *
 * ------------------------------------------------------------------ */
/*
 * A rock face with a door in it is a set, not a workplace. What makes a quarry
 * read is the mess around it: the huts the crew live in, the track the ore
 * leaves on, spoil where spoil ends up, and tools left where someone put them
 * down. All of it sits back from the face so the working ground stays clear.
 */
const CAMP_Z = SZ + 6

/* the crew's huts, backs to the wind, facing the face */
cottage(SX - 17, CAMP_Z + 3, 2, 2, -Math.PI / 2, true, 1)
cottage(SX - 17, CAMP_Z + 10, 2, 2, -Math.PI / 2, true, 1)
cottage(SX + 17, CAMP_Z + 6, 2, 3, Math.PI / 2, true, 1)

/* the tramway out: sleepers, rails, and carts standing on it */
for (let i = 0; i < 22; i++) {
  const z = SZ - 8 + i * 1.5
  prim('box', [4.6, 0.14, 0.34], '#5a4a3a', [SX, 0.07, z], { tex: 'wood', rough: 0.95 })
}
prim('box', [0.22, 0.16, 33], '#6b6357', [SX - 1.5, 0.2, SZ + 8], { metal: 0.6, rough: 0.45 })
prim('box', [0.22, 0.16, 33], '#6b6357', [SX + 1.5, 0.2, SZ + 8], { metal: 0.6, rough: 0.45 })
model('t_cart',     [SX, 0.25, SZ + 2],  0, TOWN)
model('t_cartHigh', [SX, 0.25, SZ + 13], 0, TOWN)

/* the sorting floor — ore out of the carts, graded, stacked */
for (let i = 0; i < 5; i++) {
  const x = SX + 6 + (i % 3) * 2.6, z = CAMP_Z + (i % 2) * 2.4
  ob('crate', [x, 0, z], rr(0, 6.28), 1.0)
}
for (let i = 0; i < 7; i++)
  prim('box', [rr(1.4, 2.4), rr(0.6, 1.2), rr(1.2, 2.0)], i % 2 ? ROCK_D : ROCK,
       [SX - 9 + rr(-3, 3), 0.4, CAMP_Z + rr(-2, 5)], { tex: 'paving', rough: 1, rotY: rr(0, 6.28) })
ob('anvil',   [SX + 12, 0, CAMP_Z + 1], -0.8, 0.9)
ob('toolbox', [SX + 10.5, 0, CAMP_Z + 2.4], 0.4, 0.6)
ob('barrel',  [SX - 13, 0, CAMP_Z + 1], 0.2, 1.05)
ob('barrel',  [SX - 12, 0, CAMP_Z + 2.4], 1.1, 1.05)
ob('bench',   [SX - 6, 0, CAMP_Z + 8], 0.0, 0.95)
ob('bench',   [SX + 6, 0, CAMP_Z + 8], 0.0, 0.95)
for (let i = 0; i < 4; i++) model('t_lantern', [SX - 12 + i * 8, 0, CAMP_Z + 5], 0, TOWN)
model('n_campfire', [SX, 0, CAMP_Z + 9], 0, NAT * 0.9)
prim('cone', [0.26, 0.62], '#ff7a2a', [SX, 0.34, CAMP_Z + 9], { emissive: '#ff9a3a', rough: 0.4 })

/* ------------------------------------------------------------------ *
 * THE DOCKS — a harbour front, not three jetties on open water        *
 * ------------------------------------------------------------------ */
/*
 * The jetties worked and the water behind them was empty in every direction.
 * A working waterfront has a back to it: a warehouse the catch goes into, a
 * quay wall, a watchtower, and enough clutter on the boards that the place
 * looks used between one player and the next.
 */
const QUAY_Z = SHORE_Z - 3

/* the quay wall along the shore, so land meets water at an edge */
for (let i = 0; i < 16; i++)
  model('t_block', [DX - 26 + i * 3.6, 0, QUAY_Z + 1.6], 0, 2.4)

/* the warehouse behind it */
// The two Kenney cottages that used to stand here are gone: the real terrace
// went in behind them and they were the thing blocking it. Keeping both would
// be putting the flat version in front of the detailed one.


/* the watchtower at the head of the quay */
model('p_towerBase', [DX + 23, 0, QUAY_Z - 1], -0.3, PIR)
model('p_tower',     [DX + 23, 4.0, QUAY_Z - 1], -0.3, PIR)
model('p_towerRoof', [DX + 23, 8.6, QUAY_Z - 1], -0.3, PIR)
model('p_flag',      [DX + 23, 11.5, QUAY_Z - 1], -0.3, PIR * 0.8)

/* clutter on the boards */
// real barrels and crates, with normal maps, because this is the surface a
// player stands closest to in the whole world
const QUAY_KIT = ['hq_Barrel_01', 'hq_Barrel_02', 'hq_barrel_03', 'hq_wooden_crate_02']
for (let i = 0; i < 16; i++)
  model(QUAY_KIT[i % QUAY_KIT.length], [DX + rr(-24, 24), 0, QUAY_Z + rr(-1, 3)], rr(0, 6.28), rr(0.9, 1.25))
for (let i = 0; i < 5; i++)
  ob('sack', [DX + rr(-20, 20), 0, QUAY_Z + rr(-1, 2)], rr(0, 6.28), rr(0.85, 1.0))
for (let i = 0; i < 6; i++)
  model('p_crateBtl', [DX + rr(-20, 20), 0, QUAY_Z + rr(-2, 2)], rr(0, 6.28), PIR * SMALL)
for (let i = 0; i < 8; i++) model('t_lantern', [DX - 21 + i * 6, 0, QUAY_Z + 2.6], 0, TOWN)
ob('bench', [DX - 8, 0, QUAY_Z - 1.5], 0, 0.95)
ob('bench', [DX + 8, 0, QUAY_Z - 1.5], 0, 0.95)

/* ------------------------------------------------------------------ *
 * the country between                                                 *
 * ------------------------------------------------------------------ */
/*
 * Everything above is an island. Between them was mown meadow to the horizon,
 * which is what made the world feel like four sets rather than one place.
 * Hedgerows follow the roads out, copses break the middle distance, and dry
 * stone runs along the field boundaries — cheap geometry doing the one job of
 * making the space between destinations look like somewhere.
 */
function hedgerow(x1, z1, x2, z2, gap) {
  const dx = x2 - x1, dz = z2 - z1
  const len = Math.sqrt(dx * dx + dz * dz)
  const n = Math.floor(len / (gap || 3.2))
  const ang = Math.atan2(dx, dz)
  for (let i = 0; i <= n; i++) {
    const t = i / n
    model(i % 7 === 3 ? 'n_bushL' : 'n_fenceHigh',
          [x1 + dx * t, 0, z1 + dz * t], ang + Math.PI / 2, NAT * rr(0.85, 1.05))
  }
}
hedgerow(-34,   2, -62, -14)      // out to the Fields
hedgerow(-30,  10, -58,  -6)
hedgerow( 34,   2,  62, -14)      // out to the Seam
hedgerow( 30,  10,  58,  -6)
hedgerow(-34,  28, -60,  40)      // down to the Docks
hedgerow( 34,  28,  60,  40)      // across to the Grove
hedgerow(-70, -46, -70,  10, 4.0) // the western boundary
hedgerow( 70, -46,  70,  10, 4.0)

/* copses in the middle distance */
const COPSE = [[-30, -40], [22, -42], [-64, 22], [64, 20], [-16, 62], [18, 66], [-56, -8], [56, -6]]
for (let c = 0; c < COPSE.length; c++) {
  const [cx, cz] = COPSE[c]
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26 + c, r = rr(1.5, 6.5)
    model(pick(['n_oak', 'n_fat', 'n_pineA', 'n_pineB']),
          [cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r], rr(0, 6.28), NAT * rr(0.9, 1.4))
  }
  for (let i = 0; i < 4; i++)
    model(pick(['n_bushL', 'n_stump', 'n_log']),
          [cx + rr(-6, 6), 0, cz + rr(-6, 6)], rr(0, 6.28), NAT * rr(0.7, 1.1))
}

/* boulders and rough ground scattered wide, so the meadow is not a lawn */
for (let i = 0; i < 44; i++) {
  const a = (i / 44) * 6.2832, r = rr(38, 92)
  model(pick(['n_rockLgB', 'n_stoneLgA', 'n_bushS', 'n_grassLeaf', 'n_rockTallA']),
        [Math.sin(a) * r, 0, Math.cos(a) * r], rr(0, 6.28), NAT * rr(0.5, 1.0))
}

/* ------------------------------------------------------------------ *
 * THE CAT PARK                                                        *
 * ------------------------------------------------------------------ */
/*
 * Everything else in this world is a trade. This is the one ground that is not
 * work, and the brief was to be creative with it, so it is built out of what
 * cats actually do rather than what a park usually has.
 *
 *   THE BOX YARD    a yard of boxes. You sit in one. That is the whole
 *                   activity and it is the most cat thing there is.
 *   THE SUNBEAMS    warm patches on the flagstones. You nap in them. They move
 *                   during the day, because that is the joke and also what
 *                   sunbeams do.
 *   THE HIGH SHELF  a ledge with pots on it, at the top of a climb. You knock
 *                   them off. They come back.
 *   THE POST        a scratching post the size of a monument.
 *
 * It sits just past the Vault, so it is the first thing you see if you spawn
 * and turn round rather than walking into the office.
 */
const PX = 0, PZ = 56

// Lawn first, then paths across it. The paving used to be a 46x38 slab with
// grass showing at the edges, which is a car park with trees in it — a park
// is grass you cross on a path, and the ratio is what says which one you are
// standing in. Two 7m walks and a circle at the post is about a tenth paved.
ground(PX, PZ, 46, 50, Y - 0.04, 'grass', WHITE, { cell: 12 })
prim('box', [7.0, 0.22, 50], '#c8c1ae', [PX, Y + 0.02, PZ], { tex: 'paving', rough: 1.0 })
prim('box', [46, 0.22, 7.0], '#c8c1ae', [PX, Y + 0.02, PZ - 6], { tex: 'paving', rough: 1.0 })
prim('cylinder', [7.5, 7.5, 0.22], '#c8c1ae', [PX, Y + 0.02, PZ + 2], { tex: 'paving', rough: 1.0 })
// a kerb, so the walks read as laid rather than painted on
for (const sx of [-1, 1]) {
  prim('box', [0.3, 0.16, 50], STONE_D, [PX + sx * 3.65, Y + 0.03, PZ], { rough: 1.0 })
  prim('box', [46, 0.16, 0.3], STONE_D, [PX, Y + 0.03, PZ - 6 + sx * 3.65], { rough: 1.0 })
}

/* the gate in from the Vault side */
for (const sx of [-1, 1]) {
  model('t_block', [PX + sx * 5.5, 0, PZ - 18.5], 0, 2.0)
  model('t_pillarS', [PX + sx * 5.5, 2.0, PZ - 18.5], 0, 4.0)
}
const gate = panel(4.2, 1.0, 0.005, [PX, 6.6, PZ - 18.6], Math.PI, 'rgba(14,26,20,0.92)', LIME)
text(gate, 'THE CAT PARK', 54, LIME, 800)

/* THE POST — a scratching post, monumentally */
prim('cylinder', [1.5, 1.5, 0.5], STONE, [PX, 0.25, PZ + 2], { rough: 0.9, physics: 'static' })
// 2.1m across read as a tree trunk rather than a post — monumental is the
// point, but the proportion has to stay a scratching post's.
prim('cylinder', [0.7, 0.7, 7.5], '#8a6f4c', [PX, 4.0, PZ + 2], { tex: 'wood', rough: 1.0, physics: 'static' })
prim('cylinder', [1.0, 1.0, 0.4], '#6b543a', [PX, 7.9, PZ + 2], { tex: 'wood', rough: 1.0 })
for (let i = 0; i < 5; i++)
  prim('box', [0.12, 1.4, 0.08], '#6b543a', [PX + Math.cos(i * 1.3) * 0.71, 2.5 + i * 0.9, PZ + 2 + Math.sin(i * 1.3) * 0.71],
       { rotZ: 0.25, rough: 1 })

/* THE BOX YARD — boxes to sit in, at the west end */
const BOXES = []
for (let i = 0; i < 9; i++) {
  const bx = PX - 17 + (i % 3) * 3.6, bz = PZ - 8 + Math.floor(i / 3) * 3.6
  BOXES.push([bx, bz])
  model('hq_cardboard_box_01', [bx, 0, bz], (i % 4) * 0.4, 2.6)
}
model('t_bannerGrn', [PX - 20, 0, PZ - 10], 0, TOWN)

/* THE HIGH SHELF — a climb, and a ledge with things on it to knock off */
const SHX = PX + 15
prim('box', [7, 0.5, 7], STONE, [SHX, 0.25, PZ - 2], { tex: 'paving', rough: .9, physics: 'static' })
for (let i = 0; i < 4; i++) {
  const y = 1.6 + i * 1.9
  const w = 5.4 - i * 0.7
  prim('box', [w, 0.4, w], '#8a6f4c', [SHX + (i % 2 ? 0.9 : -0.9), y, PZ - 2 + (i % 2 ? -0.9 : 0.9)],
       { tex: 'wood', rough: 1.0, physics: 'static' })
}
prim('box', [6.5, 0.35, 1.4], '#6b543a', [SHX, 9.4, PZ - 2], { tex: 'wood', rough: 1.0, physics: 'static' })
model('c_ladder', [SHX - 3.6, 0, PZ - 2], 0, 2.4)

/* benches, planters and a fountain, because it is still a park */
ob('fountain', [PX, 0, PZ - 11], 0, 2.6)
prim('cylinder', [2.3, 2.3, 0.16], STONE, [PX, Y + 0.04, PZ - 11], { rough: 0.9 })
const PB = [[-7, -11], [7, -11], [-7, 8], [7, 8], [0, 13]]
for (let i = 0; i < PB.length; i++) ob('bench', [PX + PB[i][0], 0, PZ + PB[i][1]], i < 2 ? 0 : Math.PI, 0.95)
for (let i = 0; i < 6; i++) ob(i % 2 ? 'planterRound' : 'planter', [PX - 15 + i * 6, 0, PZ + 14], i * 0.7, i % 2 ? 2.2 : 1.1)
for (let i = 0; i < 5; i++) ob('lamp', [PX - 16 + i * 8, 0, PZ + 11], 0, 4.4)
// Eight, not fourteen, and pushed to the edges. Fourteen scattered across a
// 44x36 lawn is a wood with benches in it — a park is mostly open ground you
// can see across, with trees round the sides.
for (let i = 0; i < 8; i++) {
  const a = i / 8 * Math.PI * 2 + 0.4
  model(pick(['n_oak', 'n_fat', 'n_pineA']),
        [PX + Math.cos(a) * rr(17, 22), 0, PZ + Math.sin(a) * rr(14, 18)],
        rr(0, 6.28), NAT * rr(0.9, 1.2))
}
for (let i = 0; i < 16; i++)
  model(pick(['n_bushL', 'n_bushS', 'n_flowerY', 'n_flowerP', 'n_grassLeaf']),
        [PX + rr(-21, 21), 0, PZ + rr(-17, 17)], rr(0, 6.28), NAT * rr(0.7, 1.1))

/* a road from the plaza round the Vault to the park gate */
road(-12, 26, -12, 44, 5)
road(-12, 44, PX - 2, 52, 5)

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
