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
  u.padding=24; u.flexDirection='column'; u.lit=false; u.doubleside=true
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

/* ---------------- house rules of the campus, facing spawn ---------------- */
const board = panel(760,520,0.0052,[9.5,2.8,15.0],-0.35,PAPER,GOLD)
text(board,'BEFORE YOU WANDER',44,GREEN_D,700)
text(board,'Everything in here is a demo build.',26,INK,400,22)
text(board,'No wallet is connected, nothing is minted,',24,INK,400,10)
text(board,'and no $CASHCATSLLC actually moves.',24,INK,400,2)
text(board,'The numbers on the boards are the real',24,INK,400,14)
text(board,'proposed rules, running live — not mockups.',24,INK,400,2)


/* ---------------- carved cat statues ----------------
 * Real geometry, not billboards: ellipsoids from scaled spheres, cones for
 * ears, cylinders for legs and tail.
 *
 * What makes these read as cats rather than as a pile of spheres:
 *   - the head is large and sits clearly ABOVE a neck, not sunk in the chest
 *   - the ears are big. They are the strongest silhouette cue a cat has and
 *     the first version's little nubs were why nothing looked feline
 *   - a sitting cat TAPERS — wide haunches, narrower chest, narrow shoulders.
 *     Uniform girth just makes a pear
 *   - the front legs stand proud in Z, in front of the chest, or they vanish
 *     inside the torso
 */
function catStatue(cfg){
  const { x, z, rotY = 0, s = 1, pose = 'sit', mat = {}, baseY = Y + 0.38,
          girth = 1, headR = 1, earH = 1, bodyLen = 1, mouth = 0 } = cfg
  const Y0 = baseY
  const parts = []

  function part(type, size, p, sc, rot){
    const c = Math.cos(rotY), si = Math.sin(rotY)
    const px = p[0] * s, py = p[1] * s, pz = p[2] * s
    const n = prim(type, size.map(v => v * s), mat.col,
      [x + px * c + pz * si, Y0 + py, z - px * si + pz * c],
      { scale: sc ? [sc[0]*s, sc[1]*s, sc[2]*s] : undefined,
        rotY: rotY + (rot && rot[1] ? rot[1] : 0),
        rotX: rot && rot[0] ? rot[0] : undefined,
        rotZ: rot && rot[2] ? rot[2] : undefined,
        tex: mat.tex, rough: mat.rough, metal: mat.metal })
    parts.push(n)
    return n
  }
  const S = [1]
  const g = 0.55 + 0.45 * girth          // girth is a nudge, not a balloon

  let hy, hz                              // where the head ends up
  if (pose === 'sit') {
    part('sphere', S, [0, 0.34, -0.16], [0.54*g, 0.34, 0.62*g])   // haunches, widest
    part('sphere', S, [0, 0.60, -0.22], [0.46*g, 0.34, 0.48])     // back rising
    part('sphere', S, [0, 0.76,  0.02], [0.38*g, 0.38, 0.34])     // chest
    part('sphere', S, [0, 1.00,  0.06], [0.29*g, 0.24, 0.27])     // shoulders, narrow
    part('cylinder', [0.15, 0.17, 0.20], [0, 1.14, 0.07])         // neck
    for (const sx of [-1, 1]) {
      // proud of the chest in z, or they disappear inside the torso
      part('cylinder', [0.075, 0.085, 0.60], [sx*0.17, 0.32, 0.30])
      part('sphere', S, [sx*0.17, 0.06, 0.38], [0.10, 0.07, 0.16])
      part('sphere', S, [sx*0.33*g, 0.10, -0.02], [0.13, 0.09, 0.22])  // hind paw
    }
    hy = 1.34; hz = 0.09
  } else {
    const L = 0.60 * bodyLen
    part('sphere', S, [0, 0.86, 0], [0.34*g, 0.32, L])
    part('sphere', S, [0, 0.90, L*0.72], [0.31*g, 0.30, 0.30])
    part('sphere', S, [0, 0.84, -L*0.76], [0.33*g, 0.31, 0.30])
    for (const sx of [-1, 1]) for (const sz of [1, -1]) {
      part('cylinder', [0.075, 0.09, 0.80], [sx*0.21, 0.44, sz*L*0.66])
      part('sphere', S, [sx*0.21, 0.07, sz*L*0.66 + 0.04], [0.10,0.07,0.14])
    }
    part('cylinder', [0.15, 0.17, 0.26], [0, 1.06, L + 0.14], null, [0.5, 0, 0])
    hy = 1.22; hz = L + 0.30
  }

  /* head — big, and clearly sitting on top of the neck rather than in it */
  const h = 0.30 * headR
  part('sphere', S, [0, hy, hz], [h, h*0.92, h*0.96])
  for (const sx of [-1, 1])                                   // cheek tufts
    part('sphere', S, [sx*h*0.78, hy-0.05, hz+0.02], [h*0.34, h*0.40, h*0.36])
  part('sphere', S, [0, hy-0.06, hz+h*0.80], [h*0.50, h*0.38, h*0.44])   // muzzle
  part('sphere', S, [0, hy-0.02, hz+h*1.12], [0.045, 0.038, 0.038])      // nose
  if (mouth)
    part('sphere', S, [0, hy-0.15, hz+h*0.86], [h*0.34, h*0.40, h*0.34])
  // brow ridge, so the face is not a featureless dome
  part('sphere', S, [0, hy+h*0.38, hz+h*0.50], [h*0.60, h*0.12, h*0.26])
  /* Ears — large, and BROAD rather than tall. These carry the silhouette more
   * than anything else does, and a narrow cone tilted well out reads as a
   * horn, which is exactly what the first attempt looked like. */
  for (const sx of [-1, 1])
    part('cone', [0.23*headR, 0.38*earH], [sx*h*0.60, hy + h*0.80 + 0.07*earH, hz - 0.03],
         null, [0.05, 0, sx * 0.12])

  /* tail, swept out and round so the outline is not symmetrical */
  const t0 = pose === 'sit' ? [0.16, 0.12, -0.50] : [0.12, 0.84, -0.60*bodyLen - 0.18]
  const seg = [[0,0,0],[0.20,0.05,-0.16],[0.42,0.18,-0.22],[0.60,0.40,-0.18],[0.68,0.64,-0.04]]
  for (let i = 0; i < seg.length; i++)
    part('sphere', S, [t0[0]+seg[i][0], t0[1]+seg[i][1], t0[2]+seg[i][2]],
         [0.095 - i*0.007, 0.095 - i*0.007, 0.095 - i*0.007])

  return parts
}

/* ---------------- the cast, out on the plaza ----------------
 * The protagonists, standing where everyone walks in. Standee planes rather
 * than models: rigged VRMs for each of them is real modelling work, and a
 * flat cutout is honest about being a placeholder.
 */
// Ordered along the walk in from spawn, with a clear gap down the middle for
// the path to the Filing Office. They were behind the spawn point at first,
// which meant you arrived with your back to the whole cast.
// Ordered along the walk in from spawn, with a clear gap down the middle for
// the path to the Filing Office. They were behind the spawn point at first,
// which meant you arrived with your back to the whole cast.
//
// Each is carved rather than printed on a board: proportions carry the
// character, since a stone cat cannot rely on fur colour or an expression.
const STONE_MAT = { col:'#ffffff', tex:'paving', rough:0.85 }
const GOLD_MAT  = { col:GOLD_L, metal:0.9, rough:0.3 }

const CAST = [
  { key:'catSerious', label:'SERIOUS CAT', x:-17.0, mat:STONE_MAT,
    pose:'sit',   s:1.05, girth:1.18, headR:1.12, earH:0.85 },
  { key:'catLong',    label:'LONG CAT',    x:-10.0, mat:STONE_MAT,
    pose:'stand', s:0.95, girth:0.82, headR:0.92, bodyLen:2.15 },
  { key:'catCash',    label:'CASH CAT',    x: -3.6, mat:GOLD_MAT,
    pose:'sit',   s:1.15, girth:1.0,  headR:1.0,  earH:1.05 },
  { key:'catPop',     label:'POP CAT',     x:  3.6, mat:STONE_MAT,
    pose:'sit',   s:1.0,  girth:0.95, headR:1.05, earH:1.1, mouth:1 },
  { key:'catApple',   'label':'APPLE CAT', x: 10.0, mat:STONE_MAT,
    pose:'sit',   s:1.0,  girth:1.32, headR:1.28, earH:0.8 },
]
for (const c of CAST) {
  const z = 11.4
  prim('box',[2.4,0.35,2.0],'#ffffff',[c.x,Y+0.18,z],{tex:'paving',rough:0.9})
  prim('box',[2.2,0.06,1.8],GOLD_D,[c.x,Y+0.37,z],{metal:0.8,rough:0.35})
  catStatue({ x:c.x, z:z, rotY:0, s:c.s, pose:c.pose, mat:c.mat,
              girth:c.girth, headR:c.headR, earH:c.earH || 1,
              bodyLen:c.bodyLen || 1, mouth:c.mouth || 0 })
  // on the front of the plinth, where a statue's name belongs — floating it
  // at chest height put it straight across the cat it was naming
  const plaque = panel(360,88,0.0046,[c.x,Y+0.20,z+1.01],0,'#0e1f18',GOLD)
  plaque.alignItems='center'
  text(plaque,c.label,42,GOLD_L,700)
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
