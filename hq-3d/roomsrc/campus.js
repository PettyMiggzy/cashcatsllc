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
 * bg is the panorama you see; hdr is what actually lights every room, since
 * hyperfy has no light nodes and everything is lit from scene.environment.
 * A cold default sky is why the interiors read washed out.
 */
const sky = app.create('sky')
if (props.skyBg)  sky.bg  = props.skyBg.url
if (props.skyHdr) sky.hdr = props.skyHdr.url
sky.sunDirection = new Vector3(-0.4, -0.8, -0.5)
sky.sunIntensity = 1.6
sky.sunColor = '#fff0d0'
sky.fogNear = 60
sky.fogFar = 380
sky.fogColor = '#cfd8d0'
app.add(sky)
function panel(w,h,size,pos,rotY,bg,border){
  const u=app.create('ui')
  u.space='world'; u.width=w; u.height=h; u.size=size
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
prim('box',[64,0.3,17],'#ffffff',[-1,Y-0.15,16.5],{tex:'paving',rough:0.9})
// banding so the slab does not read as one flat sheet
for(let i=0;i<4;i++) prim('box',[64,0.04,0.3],STONE_D,[-1,Y+0.01,9.5+i*4.2])

/* ---------------- paths from the plaza to each door ---------------- */
function path(x, fromZ, toZ, w){
  const len = fromZ - toZ
  prim('box',[w,0.3,len],'#ffffff',[x,Y-0.15,toZ+len/2],{tex:'paving',rough:0.9})
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
function plate(x,z,title,sub){
  const u=panel(560,150,0.006,[x,4.9,z],0,'#0e1f18',GOLD)
  u.alignItems='center'
  text(u,title,54,GOLD_L,700)
  text(u,sub,26,DIM,400,6)
}
plate(-22, 6.3,  'THE HOMESTEAD', 'land · housing · farming')
plate(  0, 8.3,  'THE FILING OFFICE', 'reception · swap · rewards')
plate( 21, 5.8,  'THE WORKSHOP',  'gear · materials · NFT tiers')

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
  prim('box',[2.4,0.35,2.0],'#ffffff',[c.x,Y+0.18,z],{tex:'paving',rough:0.9})
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
prim('box',[6,0.3,2.0],'#ffffff',[0,Y-0.15,25.6],{tex:'paving',rough:0.9})
