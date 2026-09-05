/*
 * World of CashCats — The VIP Floor
 *
 * The building on the plaza used to be the Filing Office. It is the members'
 * room now: 10,000,000 $CASHCATSLLC to get past the rope, and three tables
 * inside to stake what you have earned.
 *
 * WHAT IS IN THIS FILE AND WHAT IS NOT.
 *
 * This file draws a room. Walls, floor, roof, lights, the rope line and the
 * signage that never changes. That is all it does, and it is deliberate: the
 * TABLES -- their furniture, their boards, their buttons and every number on
 * them -- are in trades.js, along with the ledger they pay out of.
 *
 * The reason is the ledger. Two apps that both write ccl.ledger.v1 are two
 * apps that can disagree about how much money a player has. world.storage
 * hands out the stored object by reference, so once both apps hold the same
 * one they do stay in step -- but only once. On a world where the key does not
 * exist yet, each app does `world.get(KEY) || {}`, each ends up holding its
 * OWN empty book, and from then on every write by one is invisible to the
 * other. That is a fresh deploy, and the symptom is a player's balance
 * changing depending on which table they last touched.
 *
 * So the money has exactly one writer, the same rule the Exchange follows. A
 * room may draw itself; only trades.js may pay out.
 *
 * THE GATE IS NOT THIS FILE EITHER. The rope below is furniture. The real
 * check is `p.tier === 'vip'` inside every bet handler on the server, where
 * the holder tier from the signed pass can actually be read. A room you can
 * only reach by walking is not a gate, and a rope you can walk around is not
 * even a room.
 */

const GOLD = '#a9812a', GOLD_L = '#e8c25a', GOLD_D = '#6b4f16'
const BLACK = '#26221b', DARK = '#332e24', FELT = '#123a2a'
const CREAM = '#e8f2ec', DIM = '#b3a68a', RED = '#7a3b2a', LIME = '#2ecc71'

// Same footprint as the office it replaces, because campus.js already draws a
// frontage against it: 16 x 16 at the origin, door in the +Z wall onto the
// plaza. Changing these without changing frontage(0, 8.0, ...) puts a facade
// in front of the wrong building.
const W = 16, D = 16, H = 5.0, T = 0.25
const FLOOR_Y = 0.06
const DOOR_W = 3.4

function prim(type, size, color, pos, opts) {
  opts = opts || {}
  const n = app.create('prim')
  n.type = type; n.size = size; n.color = color
  n.position.set(pos[0], pos[1], pos[2])
  if (opts.rotY) n.rotation.y = opts.rotY
  if (opts.rotZ) n.rotation.z = opts.rotZ
  if (opts.emissive) n.emissive = opts.emissive
  if (opts.tex && props[opts.tex]) n.texture = props[opts.tex].url
  if (opts.rough !== undefined) n.roughness = opts.rough
  if (opts.metal !== undefined) n.metalness = opts.metal
  // Prims are physics: null by default -- scenery you walk through. Most of
  // this world is built that way and gets away with it outdoors. A members'
  // room whose walls are a suggestion does not, so the shell asks for a
  // collider and the furniture does not.
  if (opts.solid) n.physics = 'static'
  app.add(n)
  return n
}

/*
 * A world-space panel, sized in METRES.
 *
 * ui.width and ui.height are the CANVAS size in pixels and `size` is the
 * metres-per-pixel that maps it onto the quad, so passing metres straight in
 * makes a two-pixel canvas that renders as nothing at all.
 */
function panel(wm, hm, size, pos, rotY, bg, border) {
  const u = app.create('ui')
  u.space = 'world'
  u.width = Math.round(wm / size)
  u.height = Math.round(hm / size)
  u.size = size
  // res 1, not the engine default of 2, which multiplies the canvas in BOTH
  // axes and spends megabytes supersampling text read from three metres away.
  u.res = 1
  u.backgroundColor = bg; u.borderColor = border; u.borderWidth = 6
  u.borderRadius = 12; u.padding = 24; u.flexDirection = 'column'
  u.lit = false; u.doubleside = false
  u.position.set(pos[0], pos[1], pos[2])
  if (rotY) u.rotation.y = rotY
  app.add(u)
  return u
}
function text(parent, val, px, color, weight, mt) {
  const t = app.create('uitext')
  t.value = val; t.fontSize = px; t.color = color; t.lineHeight = 1.3
  if (weight) t.fontWeight = weight
  if (mt) t.margin = [mt, 0, 0, 0]
  parent.add(t)
  return t
}

/* ---------------- the shell ----------------
 *
 * There are no light nodes in this engine. scene.environment -- the sky -- is
 * the entire lighting rig, so a sealed box renders very nearly black. Every
 * interior in this world therefore has an open beam roof rather than a lid,
 * and this one leans into it: a dark room lit in stripes is what a members'
 * floor should look like anyway.
 */
/* No texture, and no shine either.
 *
 * This floor came out navy blue twice. It was never the colour and never the
 * texture: a dark METALLIC surface at low roughness is a mirror, the roof here
 * is open beams, and the only thing above it to reflect is the sky. The room
 * was faithfully showing a blue sky on a black floor.
 *
 * Metalness 0 and a matt roughness. The gold in here comes from the gold.
 */
prim('box', [W, 0.3, D], '#17150f', [0, FLOOR_Y - 0.15, 0], { rough: 0.75, metal: 0, solid: true })
// an inlaid gold border, so the floor has an edge rather than just stopping
prim('box', [W - 1.2, 0.02, 0.12], GOLD_D, [0, FLOOR_Y + 0.01, -D / 2 + 0.9], { metal: 0.8, rough: 0.4 })
prim('box', [W - 1.2, 0.02, 0.12], GOLD_D, [0, FLOOR_Y + 0.01, D / 2 - 0.9], { metal: 0.8, rough: 0.4 })
prim('box', [0.12, 0.02, D - 1.8], GOLD_D, [-W / 2 + 0.9, FLOOR_Y + 0.01, 0], { metal: 0.8, rough: 0.4 })
prim('box', [0.12, 0.02, D - 1.8], GOLD_D, [W / 2 - 0.9, FLOOR_Y + 0.01, 0], { metal: 0.8, rough: 0.4 })

const RAIL = 1.35
function wall(size, pos) {
  const w = size[0], h = size[1], d = size[2]
  const horizontal = w > d
  const upperH = h - RAIL
  prim('box', [w, upperH, d], DARK, [pos[0], RAIL + upperH / 2, pos[2]], { tex: 'plaster', rough: 0.9, solid: true })
  prim('box', [w, RAIL, d], BLACK, [pos[0], RAIL / 2, pos[2]], { tex: 'wainscot', rough: 0.55, solid: true })
  const railD = horizontal ? [w, 0.07, d + 0.04] : [w + 0.04, 0.07, d]
  prim('box', railD, GOLD, [pos[0], RAIL + 0.035, pos[2]], { metal: 0.85, rough: 0.3 })
}

wall([W, H, T], [0, 0, -D / 2])                                   // back
wall([T, H, D], [-W / 2, 0, 0])                                   // left
wall([T, H, D], [W / 2, 0, 0])                                    // right
wall([(W - DOOR_W) / 2, H, T], [-(W + DOOR_W) / 4, 0, D / 2])     // front, left of the door
wall([(W - DOOR_W) / 2, H, T], [(W + DOOR_W) / 4, 0, D / 2])      // front, right of the door
prim('box', [DOOR_W, H - 3.1, T], DARK, [0, H - (H - 3.1) / 2, D / 2], { tex: 'plaster', rough: 0.9 })
prim('box', [DOOR_W + 0.5, 0.16, T + 0.3], GOLD, [0, 3.15, D / 2], { metal: 0.8, rough: 0.32 })

// beams, and the strip lights that make the room readable
for (let i = -2; i <= 2; i++) {
  prim('box', [W, 0.24, 0.34], '#2e2a22', [0, H + 0.1, i * (D / 5)])
  prim('box', [W - 2.2, 0.06, 0.12], '#ffe9a8', [0, H - 0.22, i * (D / 5)], { emissive: '#ffdd8a' })
}
prim('box', [0.34, 0.24, D], '#2e2a22', [-W / 2 + 0.3, H + 0.1, 0])
prim('box', [0.34, 0.24, D], '#2e2a22', [W / 2 - 0.3, H + 0.1, 0])

// pilasters, so sixteen metres of wall is not one flat sheet
for (const sx of [-1, 1]) {
  for (let i = -2; i <= 2; i++) {
    prim('box', [0.3, H - 0.2, 0.3], '#3a352b', [sx * (W / 2 - 0.32), (H - 0.2) / 2, i * 3.0], { rough: 0.8 })
    prim('box', [0.44, 0.14, 0.44], GOLD_D, [sx * (W / 2 - 0.32), H - 0.18, i * 3.0], { metal: 0.7, rough: 0.4 })
  }
}

/* ---------------- the rope ----------------
 * Furniture. The tables do the refusing; this only says where the line is.
 */
const ROPE_Z = 4.6
for (const x of [-5.6, -1.7, 1.7, 5.6]) {
  prim('cylinder', [0.16, 0.2, 0.1], GOLD_D, [x, 0.11, ROPE_Z], { metal: 0.8, rough: 0.4 })
  prim('cylinder', [0.05, 0.05, 1.0], GOLD, [x, 0.6, ROPE_Z], { metal: 0.9, rough: 0.28 })
  prim('sphere', [0.09], GOLD_L, [x, 1.14, ROPE_Z], { metal: 0.9, rough: 0.25 })
}
// the ropes themselves, with the middle span left open to walk through
for (const seg of [[-5.6, -1.7], [1.7, 5.6]]) {
  const mid = (seg[0] + seg[1]) / 2, len = seg[1] - seg[0]
  prim('box', [len, 0.07, 0.07], '#6b1f1f', [mid, 1.0, ROPE_Z], { rough: 0.85 })
}

/* ---------------- the sign over the rope ---------------- */
const sign = panel(6.2, 1.9, 0.005, [0, 3.0, ROPE_Z - 0.1], Math.PI, 'rgba(20,17,10,0.94)', GOLD)
sign.alignItems = 'center'
text(sign, 'THE VIP FLOOR', 62, GOLD_L, 800)
text(sign, '10,000,000 $CASHCATSLLC', 30, CREAM, 600, 12)
text(sign, 'Checked on the server, at every bet.', 22, DIM, 400, 8)

/* ---------------- the house rules, by the door ----------------
 *
 * Printed rather than buried. A room that takes stakes and will not say what
 * it keeps is the thing everyone is right to distrust, so the edge goes on the
 * wall in the same size as everything else.
 */
const rules = panel(3.9, 4.4, 0.0046, [-W / 2 + T + 0.06, 2.6, 1.4], Math.PI / 2, 'rgba(20,17,10,0.94)', GOLD)
text(rules, 'HOUSE RULES', 44, GOLD_L, 800)
text(rules, 'Every roll and every spin happens on', 21, CREAM, 400, 14)
text(rules, 'the server. Your client is told the', 21, CREAM, 400, 2)
text(rules, 'result; it never decides one.', 21, CREAM, 400, 2)
text(rules, 'THE DICE PIT', 26, GOLD_L, 700, 16)
text(rules, 'Two dice against the house. A win pays', 20, CREAM, 400, 6)
text(rules, '1.9x your stake. A tie gives it back.', 20, CREAM, 400, 2)
text(rules, 'The house keeps about 4.4%.', 20, LIME, 400, 4)
text(rules, 'THE WHEEL', 26, GOLD_L, 700, 14)
text(rules, 'Twelve pockets. Back a colour, a trio', 20, CREAM, 400, 6)
text(rules, 'or a single number.', 20, CREAM, 400, 2)
text(rules, 'Every bet on it pays back 95%.', 20, LIME, 400, 4)
text(rules, 'THE HIGH TABLE', 26, GOLD_L, 700, 14)
text(rules, 'One Gold Cash Cat a hand, three dice', 20, CREAM, 400, 6)
text(rules, 'a side. Win one, lose one, tie is a', 20, CREAM, 400, 2)
text(rules, 'push. The house takes nothing.', 20, LIME, 400, 2)

/* ---------------- the honest notice, by the door ----------------
 *
 * The world's other boards say no wallet is connected and nothing is minted.
 * That claim matters more in here than anywhere else, so it gets said in the
 * room where people are staking something.
 */
const note = panel(3.9, 3.4, 0.0046, [W / 2 - T - 0.06, 2.6, 1.4], -Math.PI / 2, 'rgba(29,16,16,0.94)', RED)
text(note, 'WHAT IS ACTUALLY AT STAKE', 34, '#e0a080', 800)
text(note, 'CashCoin and Gold Cash Cats, both of', 21, CREAM, 400, 14)
text(note, 'which are earned by playing and exist', 21, CREAM, 400, 2)
text(note, 'only on this server.', 21, CREAM, 400, 2)
text(note, 'No wallet is connected to these tables.', 21, '#e0a080', 700, 14)
text(note, 'No $CASHCATSLLC moves, on chain or', 21, '#e0a080', 700, 2)
text(note, 'anywhere else. The token is read once,', 21, '#e0a080', 700, 2)
text(note, 'at the door, to check what you hold.', 21, '#e0a080', 700, 2)
text(note, 'Nothing here can be cashed out, because', 20, DIM, 400, 14)
text(note, 'there is nothing here to cash out to.', 20, DIM, 400, 2)

/* ---------------- a little wealth on the walls ---------------- */
for (const sx of [-1, 1]) {
  // sconces between the pilasters
  for (const z of [-4.5, -1.5, 1.5]) {
    prim('box', [0.18, 0.5, 0.28], GOLD_D, [sx * (W / 2 - 0.5), 2.5, z], { metal: 0.75, rough: 0.4 })
    prim('box', [0.12, 0.3, 0.16], '#ffe9a8', [sx * (W / 2 - 0.62), 2.62, z], { emissive: '#ffdd8a' })
  }
}
/* a runner down the middle, from the door to the high table
 *
 * The two slabs have to be stacked with a gap, not interleaved. At the first
 * cut the runner spanned y 0.055..0.075 and its own gold edging spanned
 * 0.0545..0.0695 -- twenty millimetres of overlap -- so the two z-fought down
 * the length of the room and the carpet came out in patches.
 */
prim('box', [2.9, 0.012, 11.4], GOLD_D, [0, FLOOR_Y + 0.008, -1.2], { metal: 0.7, rough: 0.5 })
prim('box', [2.6, 0.020, 11.0], '#5a1f1f', [0, FLOOR_Y + 0.026, -1.2], { rough: 0.95 })
