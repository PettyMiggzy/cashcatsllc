/*
 * CashCats HQ — the campus
 *
 * The connective tissue: the plaza players spawn onto, paths to each door,
 * nameplates, a directory, and the gate in front of The Vault. The buildings
 * themselves are separate apps; this one only ever draws the outside, so it
 * can be edited without touching a room.
 *
 * Layout (all building doors face +Z, onto the plaza):
 *   Homestead      [-22, 0, 0]   x -29.5..-14.5   door z +6
 *   Filing Office  [  0, 0, 0]   x  -8  ..  8     door z +8
 *   Workshop       [ 21, 0, 0]   x  14.5.. 27.5   door z +5.5
 *   The Vault      [  0, 0, 30]  gated, door faces -Z at z +25
 * Spawn sits at [0, 0, 17] looking back at the Filing Office.
 */

const PAPER='#f4f0e3', INK='#16150f', GREEN='#1a7f4b', GREEN_D='#0f5c35'
const GOLD='#a9812a', GOLD_L='#e8c25a', GOLD_D='#6b4f16', DIM='#8fa39a', CREAM='#e8f2ec'
const STONE='#cfc9b8', STONE_D='#b3ac99', LIME='#2ecc71'

const Y = 0.05                     // the plaza sits just above the terrain

// prims take a texture across UV 0..1 of each face with no repeat control,
// so the tiling is baked into the images themselves (see roomsrc/tile.py).
function prim(type,size,color,pos,opts={}){
  const n=app.create('prim')
  n.type=type; n.size=size; n.color=color
  n.position.set(pos[0],pos[1],pos[2])
  if(opts.rotY) n.rotation.y=opts.rotY
  if(opts.rotX) n.rotation.x=opts.rotX
  if(opts.rotZ) n.rotation.z=opts.rotZ
  if(opts.scale) n.scale.set(opts.scale[0],opts.scale[1],opts.scale[2])
  if(opts.emissive) n.emissive=opts.emissive
  if(opts.tex && props[opts.tex]) n.texture = props[opts.tex].url
  if(opts.rough !== undefined) n.roughness = opts.rough
  if(opts.metal !== undefined) n.metalness = opts.metal
  app.add(n); return n
}

/* ---------------- the sky ----------------
 * It used to be set here. It now lives in roomsrc/sky.js, which owns the
 * lighting rig for the whole world and nothing else — because in this engine
 * the HDRI is not a backdrop, it is the only light source there is, and the
 * dev is adding weather to it. Two files setting the same sky is two files
 * fighting over how every room is lit.
 */
function panel(w,h,size,pos,rotY,bg,border){
  const u=app.create('ui')
  u.space='world'; u.width=w; u.height=h; u.size=size
  // res 1, not the engine default of 2. res multiplies the canvas in BOTH
  // axes, so a board that is 1038 px wide allocates 2076x1538 = 3.2M pixels —
  // 12.8 MB of canvas backing store and as much again on the GPU — for signage
  // read from three metres away. Across the 44 panels in this world that was
  // most of half a gigabyte spent on supersampling text nobody stands close
  // enough to see the edges of.
  u.res = 1
  u.backgroundColor=bg; u.borderColor=border; u.borderWidth=6; u.borderRadius=12
  u.padding=24; u.flexDirection='column'; u.lit=false; u.doubleside=false
  u.position.set(pos[0],pos[1],pos[2]); if(rotY) u.rotation.y=rotY
  app.add(u); return u
}
function text(parent,val,sizePx,color,weight,mt){
  const t=app.create('uitext')
  t.value=val; t.fontSize=sizePx; t.color=color; t.lineHeight=1.35
  if(weight) t.fontWeight=weight
  if(mt) t.margin=[mt,0,0,0]
  parent.add(t); return t
}

/* ---------------- the plaza ---------------- */
prim('box',[64,0.3,17],'#c8c1ae',[-1,Y-0.15,16.5],{tex:'paving',rough:0.9})
// banding so the slab does not read as one flat sheet
for(let i=0;i<4;i++) prim('box',[64,0.04,0.3],STONE_D,[-1,Y+0.01,9.5+i*4.2])

/* ---------------- paths from the plaza to each door ---------------- */
function path(x, fromZ, toZ, w){
  const len = fromZ - toZ
  prim('box',[w,0.3,len],'#c8c1ae',[x,Y-0.15,toZ+len/2],{tex:'paving',rough:0.9})
  prim('box',[w+0.5,0.06,len],STONE_D,[x,Y-0.02,toZ+len/2])
}
path(-22, 9.0, 5.5, 4)        // to the Homestead
path(  0, 9.0, 7.5, 5)        // to the Filing Office
path( 21, 9.0, 5.0, 4)        // to the Workshop

/* ---------------- lamp posts ---------------- */
function lamp(x,z){
  prim('cylinder',[0.09,0.11,3.4],'#2f3a34',[x,Y+1.7,z],{metal:0.5,rough:0.55})
  prim('box',[0.7,0.16,0.7],GOLD,[x,Y+3.5,z],{metal:0.85,rough:0.3})
  prim('box',[0.5,0.12,0.5],'#fff6d8',[x,Y+3.4,z],{emissive:'#fff0c0'})
}
for(const x of [-30,-12,12,28]) { lamp(x,10.5); lamp(x,22.5) }

/* ---------------- planters ---------------- */
function planter(x,z){
  prim('box',[2.2,0.5,2.2],STONE_D,[x,Y+0.25,z])
  prim('box',[1.9,0.25,1.9],GREEN_D,[x,Y+0.55,z])
  prim('sphere',[0.85],GREEN,[x,Y+1.35,z],{rough:0.95})
}
for(const x of [-20,-13,13,20]) planter(x,19.5)

/* ---------------- nameplates over each door ---------------- */
function plate(x,z,y,title,sub){
  const u=panel(560,150,0.006,[x,y,z],0,'#0e1f18',GOLD)
  u.alignItems='center'
  text(u,title,54,GOLD_L,700)
  text(u,sub,26,DIM,400,6)
}
// Mounted ON the frontage, in the frieze between the window heads and the
// cornice. These used to hang against a bare room wall at z+0.3; the facade
// now stands 0.9m proud of that, so at the old depth all three signs were
// inside the masonry with only their glow showing through.
plate(-22, 7.05, 4.55, 'THE HOMESTEAD', 'land · housing · farming')
plate(  0, 9.05, 4.55, 'THE FILING OFFICE', 'reception · swap · rewards')
plate( 21, 6.55, 4.55, 'THE WORKSHOP',  'gear · materials · NFT tiers')

/* ---------------- the directory, facing spawn ---------------- */
const dir = panel(820,620,0.0052,[-9.5,2.9,15.0],0.35,'#0e1f18',GOLD)
text(dir,'WORLD OF CASHCATS',48,GOLD_L,700)
text(dir,'on Robinhood Chain · 100,000 $CASHCATSLLC to enter',24,DIM,400,8)
function entry(name,desc,mt){
  text(dir,name,32,CREAM,600,mt)
  text(dir,desc,24,DIM,400,4)
}
entry('◄  The Homestead','Buy land, build, and farm resources.',26)
entry('▲  The Filing Office','Contract address, swap, rewards wall.',18)
entry('►  The Workshop','Gear, materials, classes, NFT tiers.',18)
entry('▲▲ The Vault','10,000,000 holders only. Behind the gate.',18)
entry('►► The Pit','The arena. Last cat standing takes the purse.',18)

/* ---------------- house rules of the campus, facing spawn ---------------- */
const board = panel(760,520,0.0052,[9.5,2.8,15.0],-0.35,PAPER,GOLD)
text(board,'BEFORE YOU WANDER',44,GREEN_D,700)
text(board,'Everything in here is a demo build.',26,INK,400,22)
text(board,'No wallet is connected, nothing is minted,',24,INK,400,10)
text(board,'and no $CASHCATSLLC actually moves.',24,INK,400,2)
text(board,'The numbers on the boards are the real',24,INK,400,14)
text(board,'proposed rules, running live — not mockups.',24,INK,400,2)


/* ---------------- the chain, live ----------------
 *
 * The world runs on Robinhood Chain, and until now that was a line of text on
 * a sign. This reads the chain itself — height ticking, both contracts, the
 * supply — so the claim is checkable from inside the world rather than
 * asserted at it. Chain-native is a thing you can be rather than a thing you
 * say, and a board that is visibly wrong when the node is down is worth more
 * than one that is always confident.
 *
 * The accent here is the chain's green rather than the Office's gold. Kept
 * deliberately to our own green: this world is not affiliated with Robinhood
 * Markets and should not dress like it thinks it is.
 */
const CHAIN_G = '#00d26a', CHAIN_D = '#0a1f16'
const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com'
const T_CASH  = '0x466b4F0be1f6e7Cf87f6de43B3ABd33233EE05cc'
const T_GOLD  = '0x2f6A90cE9Dcece3215df206B3Ac6fF7368E27acc'

const chainB = panel(700,470,0.0050,[-22.5,2.9,16.0],0.55,CHAIN_D,CHAIN_G)
text(chainB,'ROBINHOOD CHAIN',34,CHAIN_G,800)
const cHeight = text(chainB,'—',54,CREAM,700,10)
text(chainB,'block height, read live',18,'#5f7168',400,2)
const cId     = text(chainB,'chain —',22,DIM,400,14)
text(chainB,'$CASHCATSLLC',22,CHAIN_G,700,14)
const cCash   = text(chainB,'—',20,CREAM,400,2)
text(chainB,'0x466b…05cc',17,'#5f7168',400,2)
text(chainB,'GOLD CASH CAT',22,CHAIN_G,700,12)
const cGold   = text(chainB,'—',20,CREAM,400,2)
text(chainB,'0x2f6A…7acc',17,'#5f7168',400,2)

function rpc(method, params){
  return fetch(RPC_URL, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ jsonrpc:'2.0', id:1, method, params })
  }).then(r => r.json()).then(j => (j && j.result) || null)
}
function commas(n){
  const d = String(n), out = []
  for(let i=0;i<d.length;i++){ if(i>0 && (d.length-i)%3===0) out.push(','); out.push(d[i]) }
  return out.join('')
}
function supplyOf(addr, node){
  // totalSupply(), 18 decimals
  return rpc('eth_call',[{ to: addr, data:'0x18160ddd' },'latest']).then(r => {
    if(!r) { node.value = 'unreadable'; return }
    node.value = commas(Math.floor(Number(BigInt(r) / BigInt('1000000000000000000')))) + ' supply'
  }).catch(() => { node.value = 'offline' })
}
function chainRefresh(){
  rpc('eth_blockNumber',[]).then(r => { cHeight.value = r ? commas(parseInt(r,16)) : 'offline' })
                           .catch(() => { cHeight.value = 'offline' })
  rpc('eth_chainId',[]).then(r => { if(r) cId.value = 'chain ' + parseInt(r,16) })
                       .catch(() => {})
  supplyOf(T_CASH, cCash)
  supplyOf(T_GOLD, cGold)
}
chainRefresh()
let chainSince = 0
app.on('update', dt => {
  chainSince += dt
  if(chainSince >= 30){ chainSince = 0; chainRefresh() }
})

/* ================================================================== *
 * FRONTAGES                                                           *
 * ==================================================================
 *
 * The three buildings on the plaza had no outside.
 *
 * Each room -- homestead.js, workshop.js, filing_office.js -- draws its own
 * four walls, and what you saw from spawn was the BACK of one of them: a flat
 * beige slab 15 metres wide with a wainscot stripe across it. Three of them in
 * a row, with a nameplate floating in front. That is the first thing every
 * player sees, and it is the "box shaped objects with no detail" complaint in
 * its purest form -- there was literally no facade, not a bad one.
 *
 * This draws one. campus.js is the right home for it: the header has always
 * said this file "only ever draws the outside", so a frontage here can be
 * changed without opening a room.
 *
 * It is prims, not kit models. The town kit is a 2.7-scale cottage kit and
 * these are 13-16 metre civic buildings -- a cottage wall panel repeated
 * across one would read as a terrace, not a hall. Prims also take a texture,
 * and plaster/marbleWall/wood are already in the atlas.
 *
 * The parts, and why each one is there:
 *   plinth    a base course, so the wall meets the ground at an edge rather
 *             than just stopping. Nothing looks more like a game object than
 *             a wall with no footing.
 *   pilasters vertical piers at intervals. These are what break a 16m
 *             expanse into bays -- the single biggest reason the old wall
 *             read as a slab was that nothing divided it.
 *   windows   a recess, a dark pane, a sill and a head. Four parts each,
 *             because a painted rectangle reads as a sticker.
 *   door      a wider surround with a pediment, so the way in is obvious
 *             from across the plaza without needing the sign to say so.
 *   cornice   a projecting band at the top, and a parapet above it. The
 *             projection is what casts the shadow line that tells you the
 *             building has a top.
 */
const F_STONE  = '#d6cfbd'      // dressed stone: plinth, pilasters, cornice
const F_STONE_D= '#b9b19c'
const F_WALL   = '#e6dfc9'      // the infill between the piers
const F_GLASS  = '#22323a'
const F_TRIM   = GOLD_D

function frontage(cx, zFront, width, bays, doorBay) {
  const H = 5.2                       // a little taller than the room behind
  const half = width / 2
  const bayW = width / bays

  /*
   * zFront is the CENTRE of the room's own front wall, and that wall is 0.25
   * thick -- so its outer face is at zFront + 0.125. The infill has to start
   * beyond that or the two co-planar surfaces z-fight, which shows up as a
   * flickering stripe across the whole building and looks like a broken
   * texture rather than a modelling mistake.
   *
   * Measured on the Homestead before this was fixed: room wall 5.875..6.125,
   * infill 5.925..6.275 -- twenty centimetres of overlap, on all three.
   */
  const WALL_T = 0.35
  const z = zFront + 0.125 + WALL_T / 2 + 0.02

  // the infill wall, set back behind the piers
  prim('box', [width, H, WALL_T], F_WALL, [cx, H / 2, z],
       { tex: 'plaster', rough: 0.95 })

  // plinth
  prim('box', [width + 0.7, 0.75, 0.95], F_STONE, [cx, 0.375, z + 0.30],
       { tex: 'marbleWall', rough: 0.85 })
  prim('box', [width + 0.9, 0.16, 1.15], F_STONE_D, [cx, 0.78, z + 0.30], { rough: 0.9 })

  // pilasters at every bay edge
  for (let i = 0; i <= bays; i++) {
    const x = cx - half + i * bayW
    prim('box', [0.62, H - 0.7, 0.62], F_STONE, [x, 0.75 + (H - 0.7) / 2, z + 0.30],
         { tex: 'marbleWall', rough: 0.85 })
    prim('box', [0.86, 0.22, 0.86], F_STONE_D, [x, H - 0.05, z + 0.30], { rough: 0.9 })   // capital
    prim('box', [0.8, 0.2, 0.8], F_STONE_D, [x, 0.86, z + 0.30], { rough: 0.9 })          // base
  }

  // bays: a window in each, except the one the door is in
  for (let b = 0; b < bays; b++) {
    const x = cx - half + bayW * (b + 0.5)
    if (b === doorBay) {
      const dw = Math.min(3.6, bayW * 0.72)
      prim('box', [dw + 1.1, 4.0, 0.5], F_STONE, [x, 2.0, z + 0.36],
           { tex: 'marbleWall', rough: 0.85 })                       // surround
      // #2a2118 was near-black and read as a doorway with nothing behind it.
      // A door wants to look like timber, and the panels are what say "door"
      // rather than "hole".
      prim('box', [dw, 3.4, 0.3], '#5a4128', [x, 1.7, z + 0.58], { tex: 'wood', rough: 0.9 })
      for (const sy of [-0.72, 0.72]) {
        for (const sx of [-1, 1]) {
          prim('box', [dw * 0.34, 1.15, 0.06], '#6d5033',
               [x + sx * dw * 0.22, 1.7 + sy, z + 0.75], { tex: 'wood', rough: 0.9 })
        }
      }
      prim('box', [0.14, 0.14, 0.22], F_TRIM, [x + dw * 0.34, 1.75, z + 0.8],
           { metal: 0.8, rough: 0.3 })                                   // handle
      prim('box', [dw + 0.3, 0.16, 0.62], F_TRIM, [x, 3.52, z + 0.50], { metal: 0.7, rough: 0.4 })
      // pediment: two ramps meeting, which is cheaper than a real triangle
      for (const s of [-1, 1]) {
        prim('box', [dw * 0.62, 0.2, 0.55], F_STONE_D,
             [x + s * dw * 0.28, 3.95, z + 0.46], { rotZ: s * 0.42, rough: 0.9 })
      }
      continue
    }
    const ww = Math.min(2.2, bayW * 0.5)
    prim('box', [ww + 0.5, 3.0, 0.28], F_STONE_D, [x, 2.7, z + 0.30], { rough: 0.9 })  // recess
    prim('box', [ww, 2.5, 0.14], F_GLASS, [x, 2.7, z + 0.46], { rough: 0.12, metal: 0.55 })
    prim('box', [ww + 0.7, 0.2, 0.5], F_STONE, [x, 1.32, z + 0.40], { rough: 0.88 })   // sill
    prim('box', [ww + 0.6, 0.18, 0.42], F_TRIM, [x, 4.08, z + 0.38], { metal: 0.7, rough: 0.4 })
    // a mullion, so the pane is a window and not a dark rectangle
    prim('box', [0.11, 2.5, 0.18], F_STONE, [x, 2.7, z + 0.50], { rough: 0.9 })
    prim('box', [ww, 0.11, 0.18], F_STONE, [x, 2.7, z + 0.50], { rough: 0.9 })
  }

  // cornice and parapet
  prim('box', [width + 1.2, 0.38, 1.25], F_STONE, [cx, H + 0.05, z + 0.28],
       { tex: 'marbleWall', rough: 0.85 })
  prim('box', [width + 0.8, 0.55, 0.75], F_WALL, [cx, H + 0.5, z],
       { tex: 'plaster', rough: 0.95 })
  prim('box', [width + 1.0, 0.14, 0.9], F_TRIM, [cx, H + 0.82, z], { metal: 0.75, rough: 0.35 })
}

// Doors face +Z onto the plaza; the bay counts are chosen so a bay lands
// roughly 3.5m wide on each, which is what makes the three read as one street
// rather than three unrelated sheds.
frontage(-22, 6.0, 15.4, 4, 1)      // the Homestead
frontage(  0, 8.0, 16.4, 5, 2)      // the Filing Office, door dead centre
frontage( 21, 5.5, 13.4, 4, 2)      // the Workshop

/* ---------------- the cast, out on the plaza ----------------
 * The protagonists, standing where everyone walks in. Standee planes rather
 * than models: rigged VRMs for each of them is real modelling work, and a
 * flat cutout is honest about being a placeholder.
 */
// Ordered along the walk in from spawn, with a clear gap down the middle for
// the path to the Filing Office. They were behind the spawn point at first,
// which meant you arrived with your back to the whole cast.
//
// The statues themselves are sculpted meshes carried by this app's model
// (roomsrc/cats.glb, built by roomsrc/mkcats.py). Assembling them from prims
// meant you could always see the spheres; a metaball surface blends the
// parts into one continuous body the way an animal actually is.
const CAST = [
  { node:'cat_serious', label:'SERIOUS CAT', x:-17.0, s:1.05, av:'avSerious' },
  { node:'cat_long',    label:'LONG CAT',    x:-10.0, s:0.95, av:'avLong'    },
  { node:'cat_cash',    label:'CASH CAT',    x: -3.6, s:1.15, av:'avCash'    },
  { node:'cat_pop',     label:'POP CAT',     x:  3.6, s:1.00, av:'avPop'     },
  { node:'cat_apple',   label:'APPLE CAT',   x: 10.0, s:1.00, av:'avApple'   },
]
for (const c of CAST) {
  const z = 11.4
  prim('box',[2.4,0.35,2.0],'#c8c1ae',[c.x,Y+0.18,z],{tex:'paving',rough:0.9})
  prim('box',[2.2,0.06,1.8],GOLD_D,[c.x,Y+0.37,z],{metal:0.8,rough:0.35})

  // The real character model, not a sculpt of one. These were marching-cubes
  // blobs built before there was any way to make a cat — legs that read as
  // stacked spheres, because that is literally what they were. The cast now
  // exists as actual models, so the plinths carry those instead.
  const url = props[c.av] && props[c.av].url
  if (url) {
    const st = app.create('avatar')
    st.src = url
    st.position.set(c.x, Y + 0.44, z)
    st.rotation.y = Math.PI        // avatars face -Z; turn them to the walk-in
    st.scale.set(c.s, c.s, c.s)
    app.add(st)
  }

  // on the front of the plinth, where a statue's name belongs — floating it
  // at chest height put it straight across the cat it was naming
  const plaque = panel(360,88,0.0046,[c.x,Y+0.20,z+1.01],0,'#0e1f18',GOLD)
  plaque.alignItems='center'
  text(plaque,c.label,42,GOLD_L,700)

  // Pick your cat at the statue of it. A wardrobe in a back room would be
  // one more building to walk to; the row of statues is already the thing
  // people stop at, and standing in front of the one you want is its own
  // explanation. The avatars are generated and gitignored, so a statue with
  // no model behind it simply keeps quiet rather than offering a dead button.
  if (url) {
    const a = app.create('action')
    a.label = 'Play as ' + c.label
    a.distance = 3.2
    a.duration = 0.4
    a.position.set(c.x, Y+1.0, z-1.3)
    a.onTrigger = () => {
      const p = world.getPlayer()
      if (p) p.setSessionAvatar(url)
    }
    app.add(a)
  }
}

/* ---------------- the gate to The Vault ---------------- */
const GZ = 24.5
prim('box',[19,0.4,1.2],STONE_D,[0,Y+0.2,GZ])
for(const x of [-4.6,4.6]){                       // gate piers
  prim('box',[1.6,5.2,1.6],STONE,[x,Y+2.6,GZ])
  prim('box',[2.0,0.3,2.0],GOLD,[x,Y+5.3,GZ],{metal:0.85,rough:0.3})
}
prim('box',[10.8,0.9,1.3],STONE,[0,Y+5.6,GZ])     // lintel
for(const x of [-8.6,8.6]){                       // low wing walls, not a barrier
  prim('box',[6.4,1.5,0.9],STONE_D,[x,Y+0.75,GZ])
  prim('box',[6.6,0.16,1.1],GOLD_D,[x,Y+1.58,GZ])
  prim('sphere',[0.75],GREEN,[x,Y+2.1,GZ],{rough:0.95})
}

const gate = panel(700,330,0.0060,[0,3.1,GZ-0.75],Math.PI,'#1d1010','#7a3b2a')
gate.alignItems='center'
gate.doubleside=false
text(gate,'THE VAULT',52,'#e8c25a',700)
text(gate,'10,000,000 $CASHCATSLLC',30,'#e0a080',600,10)
text(gate,'Checked on the server at join, not here.',22,'#a08078',400,10)

/* The gate leaf: railings, not a slab. You are meant to see the Vault behind
 * it and know what you are short of. A solid wall just reads as scenery. */
for(let i=-7;i<=7;i++) prim('cylinder',[0.06,0.06,3.9],GOLD_L,[i*0.5,Y+2.0,GZ],{metal:0.9,rough:0.28})
prim('box',[7.4,0.2,0.26],GOLD,[0,Y+3.95,GZ],{metal:0.9,rough:0.28})
prim('box',[7.4,0.2,0.26],GOLD,[0,Y+0.12,GZ],{metal:0.9,rough:0.28})
prim('box',[7.4,0.14,0.24],GOLD_D,[0,Y+2.6,GZ])

/* the path beyond, so the gate reads as leading somewhere */
prim('box',[6,0.3,2.0],'#c8c1ae',[0,Y-0.15,25.6],{tex:'paving',rough:0.9})

/* ------------------------------------------------------------------ *
 * The city around the campus.
 *
 * Everything here used to be prim('box') — walls, planters, lamps — which
 * is why it read as a grey car park with signs in it. These are modelled
 * CC0 assets (Kenney, public domain, fetched by roomsrc/fetch_packs.py) and
 * they cost almost nothing: a whole building is a few hundred triangles.
 *
 * app.load resolves asynchronously, so placement is fire-and-forget. A model
 * that fails to load leaves a gap rather than throwing and taking the plaza
 * with it — the packs are fetched, not committed, so a fresh clone can be
 * missing them entirely and should still get a working world.
 *
 * Kenney's city kit is a 1-unit grid: a building is about 0.9 across and 1.3
 * tall, so x10 puts it at a believable nine metres wide and thirteen high.
 * ------------------------------------------------------------------ */
const CITY_S = 10          // city kit is unit-scale
const TREE_S = 3.4

function model(key, pos, rotY, scale) {
  const prop = props[key]
  if (!prop || !prop.url) return
  // world.load, not app.load. app has no loader — calling one threw on the
  // very first tower and took the rest of the script with it, so the skyline,
  // the trees, the lamps and the statues were all simply absent and nothing
  // in the world said so. boot_check.py now fails an install that crashes.
  world.load('model', prop.url)
    .then(node => {
      node.position.set(pos[0], pos[1], pos[2])
      if (rotY) node.rotation.y = rotY
      const k = scale || 1
      node.scale.set(k, k, k)
      app.add(node)
    })
    .catch(() => {})   // a missing pack should cost a prop, not the room
}

/* A skyline, on a ring well outside everything else.
 *
 * The first cut was a hand-typed list of positions that ran from x -58 to 72
 * and z -33 to 54 — which was fine when the campus was the whole world, and
 * became wrong the moment four grounds were built out to 72 metres. Every one
 * of them had tower blocks standing in the middle of it: a skyscraper in the
 * quarry, an office block in the middle of the Grove, the fishing jetty
 * looking out at a car park. A computed ring cannot drift like that — nothing
 * lands inside RING_R, and RING_R is comfortably past the furthest ground.
 *
 * Bigger than before, too. At 125 metres a 9-metre building is a speck, and
 * the fog (near 60, far 380) is already doing the aerial perspective.
 */
const TOWERS = ['m_towerA', 'm_towerB', 'm_towerC']
const BLOCKS = ['m_bldA', 'm_bldB', 'm_bldC', 'm_bldD', 'm_bldE']
const RING_R = 125          // the grounds reach 72; this clears them by half again
const RING_N = 40
for (let i = 0; i < RING_N; i++) {
  const a = (i / RING_N) * Math.PI * 2
  // deterministic jitter — Math.random would reshuffle the horizon on every
  // reload and give two players standing together a different skyline
  const r = RING_R + ((i * 37) % 26) + (i % 3) * 9
  const tall = i % 3 === 0
  const key = tall ? TOWERS[i % TOWERS.length] : BLOCKS[i % BLOCKS.length]
  const s = CITY_S * (tall ? 2.2 : 1.5 + (i % 4) * 0.18)
  model(key, [Math.sin(a) * r, Y, Math.cos(a) * r], a + Math.PI, s)
}

/* planting along the plaza, and lamps that are lamps rather than boxes */
const TREES = [
  [-14.5, 20.5], [ 14.5, 20.5], [-14.5, 13.0], [ 14.5, 13.0],
  [-20.0, 24.0], [ 20.0, 24.0], [-8.0, 27.5], [  8.0, 27.5],
  [-24.0, 8.0], [ 24.0, 8.0],
]
for (let i = 0; i < TREES.length; i++) {
  const [x, z] = TREES[i]
  model(i % 3 === 0 ? 'm_pine' : (i % 3 === 1 ? 'm_tree' : 'm_treeB'),
        [x, Y, z], i * 1.1, TREE_S * (0.85 + (i % 3) * 0.14))
  model('m_bush', [x + 1.6, Y, z + 1.1], i * 0.7, 2.2)
}

const LAMPS = [[-10.5, 18.5], [10.5, 18.5], [-10.5, 24.5], [10.5, 24.5]]
for (let i = 0; i < LAMPS.length; i++) {
  model('m_lamp', [LAMPS[i][0], Y, LAMPS[i][1]], i < 2 ? 0 : Math.PI, 7)
}
