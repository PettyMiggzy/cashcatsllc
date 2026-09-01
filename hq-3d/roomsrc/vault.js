/*
 * CashCats HQ — The Vault
 *
 * The 10,000,000 $CASHCATSLLC room. It has to feel like a reward rather than
 * another set of boards, so it is deliberately the only space in the world
 * built in gold and black, and the only one with nothing to grind in it.
 *
 * The gate is enforced on the SERVER at join (see src/core/systems/holderGate
 * usage in ServerNetwork). Nothing in this file is a security boundary — a
 * room you can only reach by walking is not a gate.
 *
 * The door faces -Z, back towards the plaza and the gate.
 */

const GOLD='#a9812a', GOLD_L='#e8c25a', GOLD_D='#6b4f16'
const BLACK='#26221b', DARK='#332e24', CREAM='#e8f2ec', DIM='#b3a68a'
const GREEN='#1a7f4b', LIME='#2ecc71'

const W=14, D=12, H=5.0, T=0.25, FLOOR_Y=0.06
const BACK_Z = D/2-T/2-0.02          // the far wall, opposite the door
const LEFT_X = -W/2+T/2+0.02, RIGHT_X = W/2-T/2-0.02

function prim(type,size,color,pos,opts={}){
  const n=app.create('prim')
  n.type=type; n.size=size; n.color=color
  n.position.set(pos[0],pos[1],pos[2])
  if(opts.rotY) n.rotation.y=opts.rotY
  if(opts.emissive) n.emissive=opts.emissive
  if(opts.tex && props[opts.tex]) n.texture = props[opts.tex].url
  if(opts.rough !== undefined) n.roughness = opts.rough
  if(opts.metal !== undefined) n.metalness = opts.metal
  app.add(n); return n
}
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
  u.padding=26; u.flexDirection='column'; u.lit=false; u.doubleside=false
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

/* ---------------- shell: black marble and gold ---------------- */
prim('box',[W,0.3,D],'#ffffff',[0,FLOOR_Y-0.15,0],{tex:'marbleFloor',rough:0.22,metal:0.1})
// an inlaid gold border on the floor
prim('box',[W-1.4,0.04,D-1.4],GOLD_D,[0,FLOOR_Y+0.01,0])
prim('box',[W-1.8,0.05,D-1.8],BLACK,[0,FLOOR_Y+0.02,0])

function wall(size,pos){
  const [w,h,d]=size
  prim('box',[w,h,d],'#ffffff',[pos[0],h/2,pos[2]],{tex:'marbleWall',rough:0.3,metal:0.05})
  prim('box',[w>d?w:w+0.05,0.09,w>d?d+0.05:d],GOLD,[pos[0],1.5,pos[2]],{metal:0.92,rough:0.24})
  prim('box',[w>d?w:w+0.05,0.06,w>d?d+0.05:d],GOLD_D,[pos[0],3.4,pos[2]],{metal:0.92,rough:0.24})
}
wall([W,H,T],[0,0,D/2]); wall([T,H,D],[-W/2,0,0]); wall([T,H,D],[W/2,0,0])
// front wall with the doorway, facing the plaza
wall([(W-3.4)/2,H,T],[-(W+3.4)/4,0,-D/2]); wall([(W-3.4)/2,H,T],[(W+3.4)/4,0,-D/2])
prim('box',[3.4,H-3.2,T],DARK,[0,H-(H-3.2)/2,-D/2])
// open beams: with no light nodes a sealed room renders black
for(let i=-2;i<=2;i++) prim('box',[W,0.24,0.34],GOLD_D,[0,H+0.12,i*(D/5)])
for(let i=-2;i<=2;i++) prim('box',[W-1.4,0.10,0.18],'#fff6dd',[0,H-0.22,i*(D/5)],{emissive:'#ffeec0'})
// wall washers at head height, so the room is lit rather than merely not black
for(const x of [-W/2+0.3, W/2-0.3])
  for(let i=-1;i<=1;i++)
    prim('box',[0.12,0.1,2.6],'#fff6dd',[x,2.9,i*3.2],{emissive:'#ffeec0'})

/* ---------------- the golden cat on a plinth ---------------- */
prim('cylinder',[1.15,1.25,0.35],GOLD_D,[0,FLOOR_Y+0.18,3.2],{metal:0.9,rough:0.26})
prim('cylinder',[0.95,1.0,0.9],'#ffffff',[0,FLOOR_Y+0.8,3.2],{tex:'marbleWall',rough:0.25})
prim('cylinder',[1.1,1.05,0.14],GOLD,[0,FLOOR_Y+1.32,3.2],{metal:0.95,rough:0.2})

const cat = app.create('image')
cat.src = props.gold ? props.gold.url : null
cat.width = 2.4; cat.height = 2.4
cat.color = 'transparent'; cat.lit = false; cat.doubleside = true
cat.position.set(0, FLOOR_Y+2.6, 3.2)
app.add(cat)

/* ---------------- the charter ---------------- */
const charter = panel(880,620,0.0050,[0,3.0,BACK_Z],Math.PI,BLACK,GOLD)
charter.alignItems='center'
text(charter,'THE VAULT',56,GOLD_L,700)
text(charter,'10,000,000 $CASHCATSLLC',30,GOLD,600,10)
text(charter,'You hold enough of this thing to matter to it.',26,CREAM,400,26)
text(charter,'There is nothing to grind in this room. That is',24,DIM,400,18)
text(charter,'the point — every other room asks you for',24,DIM,400,2)
text(charter,'something. This one does not.',24,DIM,400,2)

/* ---------------- what the tier actually gets you ---------------- */
const perks = panel(720,660,0.0040,[LEFT_X+0.06,2.8,0.5],Math.PI/2,DARK,GOLD)
text(perks,'WHAT THE TIER CARRIES',40,GOLD_L,700)
text(perks,'stated plainly, like everything else here',22,DIM,400,6)
function perk(head,body,mt){
  text(perks,head,28,GOLD_L,600,mt)
  text(perks,body,23,CREAM,400,4)
}
perk('A seat at the table','Proposals for the game economy come here first.',24)
perk('The gold coat','Cosmetic only. It does not wear out and it does not raise a cap.',18)
perk('Early rooms','New spaces open here before they open on the plaza.',18)
perk('No stat advantage','Nothing in this room raises Power. Holding is not playing.',18)

/* ---------------- the honest notice ---------------- */
const note = panel(720,520,0.0040,[RIGHT_X-0.06,2.8,0.5],-Math.PI/2,DARK,'#7a3b2a')
text(note,'HOW THE GATE WORKS',40,'#e08a6a',700)
text(note,'Your balance is read on the server when you',24,CREAM,400,24)
text(note,'join, against the contract, and the socket is',24,CREAM,400,2)
text(note,'closed if it is short.',24,CREAM,400,2)
text(note,'Walking is not the check. Hiding a door would',23,DIM,400,18)
text(note,'not be a gate — anyone can walk through a',23,DIM,400,2)
text(note,'door the server already let them past.',23,DIM,400,2)

/* ---------------- live rewards readout ---------------- */
const TOKEN   = '0x466b4F0be1f6e7Cf87f6de43B3ABd33233EE05cc'
const REWARDS = '0xed86b5eb83476f7b710e8037f5a84d8624288db7'
const RPC     = 'https://rpc.mainnet.chain.robinhood.com'

const live = panel(760,340,0.0044,[0,1.55,BACK_Z-0.02],Math.PI,'#12241c',GREEN)
live.alignItems='center'
text(live,'REWARDS POOL',30,DIM,600)
const burned = text(live,'—',56,LIME,700,10)
text(live,'$CASHCATSLLC held for the $CASHCAT holder airdrop',20,DIM,400,10)
text(live,'read from the chain, refreshed every 60s',18,'#5f7168',400,4)

function refresh(){
  const data = '0x70a08231' + REWARDS.replace(/^0x/, '').toLowerCase().padStart(64, '0')
  fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_call',
      params:[{ to: TOKEN, data }, 'latest'] }),
  })
    .then(r => r.json())
    .then(j => {
      if (!j || !j.result) return
      const whole = Math.floor(Number(BigInt(j.result) / BigInt('1000000000000000000')))
      const d = String(whole), out = []
      for (let i=0;i<d.length;i++){
        if (i>0 && (d.length-i)%3===0) out.push(',')
        out.push(d[i])
      }
      burned.value = out.join('')
    })
    .catch(() => { burned.value = 'offline' })
}
refresh()
let since = 0
app.on('update', dt => { since += dt; if (since >= 60) { since = 0; refresh() } })

/* ---------------------------------------------------------------- *
 * furnishing                                                        *
 * ------------------------------------------------------------------
 * The generated props (roomsrc/props, made by tripo_props.py) were sitting on
 * disk placed nowhere while this room was furnished out of grey boxes.
 * ground_props.py has normalised every one to exactly one unit tall with its
 * base on y=0, so the last argument below is just how tall the thing is in
 * metres. world.load, not app.load — app has no loader.
 */
function ob(key, pos, rotY, height) {
  const prop = props[key]
  if (!prop || !prop.url) return
  const g = app.create('group')
  g.position.set(pos[0], pos[1], pos[2])
  if (rotY) g.rotation.y = rotY
  app.add(g)
  world.load('model', prop.url).then(n => {
    const k = height || 1
    n.scale.set(k, k, k)
    g.add(n)
  }).catch(() => {})
}

/* what a vault has in it. The centre is the display plinth, so this rings it */
ob('safe',     [-5.4, 0, -4.0],  0.3, 1.7)
ob('chest',    [ 5.2, 0, -4.2], -0.4, 1.1)
ob('chest',    [ 4.0, 0, -4.9],  0.6, 1.1)
ob('coinPile', [ 4.6, 0,  2.2],  0.0, 0.5)
ob('coinPile', [-4.6, 0,  2.6],  1.2, 0.5)
ob('coinPile', [ 3.2, 0,  3.4],  2.1, 0.4)
ob('pedestal', [-5.0, 0,  3.6],  0.0, 1.0)
ob('pedestal', [ 5.6, 0,  4.4],  0.0, 1.0)
ob('lantern',  [ 0.0, 3.6,  0.0], 0,  0.6)
