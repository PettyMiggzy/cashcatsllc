/*
 * CashCats HQ — The Filing Office
 * Spawn room. Built entirely from Prim/UI/Image nodes so it needs no modelled
 * GLB and no licensed tileset. Brand values match cashcatllc.help.
 */

const PAPER  = '#f4f0e3'
const INK    = '#16150f'
const GREEN  = '#1a7f4b'
const GREEN_D= '#0f5c35'
const GOLD   = '#a9812a'
const WOOD   = '#3b2f21'

const CA = '0x466b4F0be1f6e7Cf87f6de43B3ABd33233EE05cc'

const W = 16      // room width
const D = 16      // room depth
const H = 4.5     // wall height
const T = 0.25    // wall thickness

function prim(type, size, color, pos, opts = {}) {
  const n = app.create('prim')
  n.type = type
  n.size = size
  n.color = color
  n.position.set(pos[0], pos[1], pos[2])
  if (opts.rotY) n.rotation.y = opts.rotY
  if (opts.rotX) n.rotation.x = opts.rotX
  if (opts.emissive) n.emissive = opts.emissive
  if (opts.collider === false && 'collider' in n) n.collider = false
  app.add(n)
  return n
}

/* ---------- shell ----------
 * Hyperfy lights the world from the sky, with no light nodes available, so a
 * sealed box renders almost black. The roof is therefore an open beam frame
 * (an atrium skylight) and the walls are the site's paper tone with a green
 * wainscot, which keeps the interior bright and on-brand.
 */
const WAINSCOT = 1.3

// the world terrain sits at y=0, so the floor slab is raised a few cm to
// render above it instead of z-fighting with the meadow
const FLOOR_Y = 0.06
prim('box', [W, 0.3, D], PAPER, [0, FLOOR_Y - 0.15, 0])           // floor

function wall(size, pos, opts) {
  // paper upper + green wainscot lower, built as two slabs
  const [w, h, d] = size
  const horizontal = w > d
  const upperH = h - WAINSCOT
  prim('box', horizontal ? [w, upperH, d] : [w, upperH, d], PAPER,
       [pos[0], WAINSCOT + upperH / 2, pos[2]], opts)
  prim('box', horizontal ? [w, WAINSCOT, d] : [w, WAINSCOT, d], GREEN,
       [pos[0], WAINSCOT / 2, pos[2]], opts)
  // gold chair rail
  const railD = horizontal ? [w, 0.07, d + 0.04] : [w + 0.04, 0.07, d]
  prim('box', railD, GOLD, [pos[0], WAINSCOT + 0.035, pos[2]], opts)
}

wall([W, H, T], [0, 0, -D / 2])          // back
wall([T, H, D], [-W / 2, 0, 0])          // left
wall([T, H, D], [ W / 2, 0, 0])          // right
wall([(W - 3) / 2, H, T], [-(W + 3) / 4, 0, D / 2])   // front left of door
wall([(W - 3) / 2, H, T], [ (W + 3) / 4, 0, D / 2])   // front right of door
prim('box', [3, H - 3, T], PAPER, [0, H - (H - 3) / 2, D / 2])   // over the door

// open roof: beams only, so daylight reaches the floor
for (let i = -2; i <= 2; i++) {
  prim('box', [W, 0.22, 0.32], '#d8d0b8', [0, H + 0.1, i * (D / 5)])
}
prim('box', [0.32, 0.22, D], '#d8d0b8', [-W / 2 + 0.3, H + 0.1, 0])
prim('box', [0.32, 0.22, D], '#d8d0b8', [ W / 2 - 0.3, H + 0.1, 0])

// emissive strip lights under the beams
for (let i = -2; i <= 2; i++) {
  prim('box', [W - 1.6, 0.06, 0.12], '#fff6d8',
       [0, H - 0.2, i * (D / 5)], { emissive: '#fff0c0' })
}

/* ---------- reception desk ---------- */
prim('box', [5, 1.05, 1.2], WOOD, [0, 0.52, -3.2])
prim('box', [5.2, 0.1, 1.4], GOLD, [0, 1.08, -3.2])

/* ---------- filing cabinets along the left wall ---------- */
for (let i = 0; i < 4; i++) {
  const z = -5.5 + i * 2.6
  prim('box', [1.1, 2.0, 0.7], '#4a4436', [-W / 2 + 0.8, 1.0, z])
  for (let d = 0; d < 3; d++) {
    prim('box', [0.9, 0.06, 0.05], GOLD, [-W / 2 + 0.8, 0.45 + d * 0.6, z + 0.37])
  }
}

/* ---------- the corporate portrait on the back wall ---------- */
const logo = app.create('image')
logo.src = props.logo ? props.logo.url : null
logo.width = 2.2
logo.height = 2.2
logo.color = 'transparent'
logo.lit = false
logo.position.set(0, 3.4, -D / 2 + T / 2 + 0.02)
app.add(logo)

/* ---------- staff: the Cash Cat actually working the office ----------
 * Standee-style image planes. Each is the real cashcatllc.help cat edited
 * into a filing-office role, cut to transparent, so the room is staffed
 * rather than decorated with a logo.
 */
function staff(propKey, w, h, pos, rotY) {
  const prop = props[propKey]
  if (!prop) return
  const n = app.create('image')
  n.src = prop.url
  n.width = w
  n.height = h
  n.color = 'transparent'
  n.lit = false
  n.doubleside = true
  n.pivot = 'bottom-center'
  n.position.set(pos[0], pos[1], pos[2])
  if (rotY) n.rotation.y = rotY
  app.add(n)
  return n
}

// clerk stamping paperwork, behind the reception desk
staff('npcStamp',   1.5, 1.9, [-1.2, FLOOR_Y, -4.1], 0)
// clerk hauling folders, over by the filing cabinets
staff('npcFolders', 1.4, 1.9, [-W / 2 + 2.3, FLOOR_Y, -1.0], Math.PI / 2.6)
// clerk reading a file, near the swap terminal side
staff('npcCabinet', 1.4, 1.9, [4.6, FLOOR_Y, -1.6], -Math.PI / 5)

/* ---------- contract-address plaque ---------- */
const plaque = app.create('ui')
plaque.space = 'world'
plaque.width = 1400
plaque.height = 300
plaque.size = 0.0032
plaque.backgroundColor = PAPER
plaque.borderColor = GOLD
plaque.borderWidth = 6
plaque.borderRadius = 12
plaque.padding = 26
plaque.flexDirection = 'column'
plaque.justifyContent = 'center'
plaque.alignItems = 'center'
plaque.lit = false
plaque.doubleside = true
plaque.position.set(0, 1.55, -D / 2 + T / 2 + 0.02)
app.add(plaque)

const eyebrow = app.create('uitext')
eyebrow.value = 'ARTICLE I  ·  CONTRACT ON RECORD'
eyebrow.fontSize = 34
eyebrow.color = GREEN
eyebrow.fontWeight = 700
eyebrow.textAlign = 'center'
plaque.add(eyebrow)

const caText = app.create('uitext')
caText.value = CA
caText.fontSize = 44
caText.color = INK
caText.fontWeight = 700
caText.textAlign = 'center'
caText.margin = 14
plaque.add(caText)

const chain = app.create('uitext')
chain.value = 'ROBINHOOD CHAIN  ·  $CASHCATSLLC'
chain.fontSize = 30
chain.color = GOLD
chain.fontWeight = 700
chain.textAlign = 'center'
plaque.add(chain)

/* ---------- welcome sign over the door ---------- */
const sign = app.create('ui')
sign.space = 'world'
sign.width = 1100
sign.height = 220
sign.size = 0.0035
sign.backgroundColor = GREEN_D
sign.borderColor = GOLD
sign.borderWidth = 5
sign.borderRadius = 10
sign.padding = 20
sign.justifyContent = 'center'
sign.alignItems = 'center'
sign.lit = false
sign.doubleside = true
sign.position.set(0, 3.3, D / 2 - T / 2 - 0.02)
sign.rotation.y = Math.PI
app.add(sign)

const signText = app.create('uitext')
signText.value = 'THE FILING OFFICE'
signText.fontSize = 74
signText.color = PAPER
signText.fontWeight = 700
signText.textAlign = 'center'
sign.add(signText)

/* ---------- swap terminal ---------- */
prim('box', [1.4, 0.9, 0.8], '#1e1e1a', [5.0, 0.45, -5.0])
prim('box', [1.5, 0.08, 0.9], GOLD, [5.0, 0.93, -5.0])
const term = app.create('ui')
term.space = 'world'
term.width = 700
term.height = 460
term.size = 0.0028
term.backgroundColor = '#0b0f10'
term.borderColor = GREEN
term.borderWidth = 5
term.borderRadius = 10
term.padding = 22
term.flexDirection = 'column'
term.justifyContent = 'center'
term.alignItems = 'center'
term.lit = false
term.doubleside = true
term.position.set(5.0, 1.75, -5.0)
term.rotation.y = -0.5
app.add(term)

const tTitle = app.create('uitext')
tTitle.value = 'SWAP TERMINAL'
tTitle.fontSize = 52
tTitle.color = '#00c805'
tTitle.fontWeight = 700
tTitle.textAlign = 'center'
term.add(tTitle)

const tSub = app.create('uitext')
tSub.value = 'Buy $CASHCATSLLC\n\n1% of every buy is bought\nback and airdropped to\n$CASHCAT holders'
tSub.fontSize = 30
tSub.color = '#e8f2ec'
tSub.lineHeight = 1.4
tSub.textAlign = 'center'
tSub.margin = 16
term.add(tSub)

const swapAction = app.create('action')
swapAction.label = 'Open the Swap'
swapAction.distance = 3.5
swapAction.duration = 0.4
swapAction.position.set(5.0, 1.2, -4.4)
swapAction.onTrigger = () => {
  world.open('https://www.cashcatllc.help/swap/', true)
}
app.add(swapAction)

/* ---------- memo board ---------- */
const memo = app.create('ui')
memo.space = 'world'
memo.width = 620
memo.height = 780
memo.size = 0.0030
memo.backgroundColor = PAPER
memo.borderColor = GOLD
memo.borderWidth = 5
memo.borderRadius = 8
memo.padding = 26
memo.flexDirection = 'column'
memo.lit = false
memo.doubleside = true
memo.position.set(-5.4, 2.2, -D / 2 + T / 2 + 0.02)
app.add(memo)

const mTitle = app.create('uitext')
mTitle.value = 'ARTICLE II'
mTitle.fontSize = 46
mTitle.color = GREEN_D
mTitle.fontWeight = 700
memo.add(mTitle)

const mBody = app.create('uitext')
mBody.value =
  'Before the app.\n' +
  'Before the $32B IPO.\n\n' +
  'The investment memo\n' +
  'did not say "Cash Cat".\n\n' +
  'It said CashCats LLC —\n' +
  'the exact string, plural,\n' +
  'with the LLC.\n\n' +
  'Now it is incorporated\n' +
  'on-chain.'
mBody.fontSize = 28
mBody.color = INK
mBody.lineHeight = 1.45
mBody.margin = 16
memo.add(mBody)

/* ---------- rewards wall (live on-chain balance) ---------- */
const rw = app.create('ui')
rw.space = 'world'
rw.width = 640
rw.height = 380
rw.size = 0.0032
rw.backgroundColor = '#12241c'
rw.borderColor = GOLD
rw.borderWidth = 5
rw.borderRadius = 10
rw.padding = 24
rw.flexDirection = 'column'
rw.justifyContent = 'center'
rw.alignItems = 'center'
rw.lit = false
rw.doubleside = true
rw.position.set(W / 2 - T / 2 - 0.02, 2.2, 0)
rw.rotation.y = -Math.PI / 2
app.add(rw)

const rTitle = app.create('uitext')
rTitle.value = 'REWARDS WALL'
rTitle.fontSize = 46
rTitle.color = GOLD
rTitle.fontWeight = 700
rTitle.textAlign = 'center'
rw.add(rTitle)

const rVal = app.create('uitext')
rVal.value = 'loading…'
rVal.fontSize = 58
rVal.color = '#e8f2ec'
rVal.fontWeight = 700
rVal.textAlign = 'center'
rVal.margin = 18
rw.add(rVal)

const rSub = app.create('uitext')
rSub.value = '$CASHCATSLLC held for the\n$CASHCAT holder airdrop'
rSub.fontSize = 26
rSub.color = '#8fa39a'
rSub.textAlign = 'center'
rw.add(rSub)

// read the rewards wallet balance straight off Robinhood Chain
const TOKEN   = '0x466b4F0be1f6e7Cf87f6de43B3ABd33233EE05cc'
const REWARDS = '0xed86b5eb83476f7b710e8037f5a84d8624288db7'
const RPC     = 'https://rpc.mainnet.chain.robinhood.com'

async function refreshRewards() {
  try {
    const data = '0x70a08231' + REWARDS.replace(/^0x/, '').toLowerCase().padStart(64, '0')
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: TOKEN, data }, 'latest'],
      }),
    })
    const j = await res.json()
    if (!j.result || j.result === '0x') return
    const whole = BigInt(j.result) / (10n ** 18n)
    rVal.value = Number(whole).toLocaleString('en-US')
  } catch (err) {
    rVal.value = '—'
  }
}

// The app sandbox exposes setTimeout but not setInterval, so the periodic
// refresh rides the engine update loop instead.
refreshRewards()
let since = 0
app.on('update', dt => {
  since += dt
  if (since >= 60) { since = 0; refreshRewards() }
})
