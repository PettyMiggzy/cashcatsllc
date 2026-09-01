/*
 * THE PIT — the arena, at the far end of the campus.
 *
 * Trading floors were called the pit: coloured jackets, a bell to open and a
 * bell to close, everyone screaming at once. That is the gladiator stadium,
 * wearing clothes that fit this world.
 *
 * The floor is a price chart. Candles flash red, then drop out from under
 * you. Last cat standing takes the purse; everyone else gets the placement
 * they fell at. The market is the opponent, which is deliberate — a fight
 * between players needs a crowd online at the same moment, needs balancing
 * against live opponents, and pays people to feed their own alt account.
 * A collapsing floor needs none of that and is better with thirty people
 * than with two.
 *
 * The server owns the round: the timeline, who is still standing, and the
 * placements. Clients are told what to draw. Nothing about the outcome is
 * decided in a browser.
 */

// The app proxy exposes no position, so the entity is installed at the
// origin and everything here is placed in world coordinates. That also means
// a player's position can be compared against the floor without converting.
const OX = 48              // out past the Workshop
const OZ = 0

const GRID_C = 11          // columns across
const GRID_R = 9           // rows deep
const CELL   = 1.7
const DECK_Y = 14          // arena deck, high enough that falling reads as falling

const T_LOBBY = 20         // doors open
const T_WARN  = 1.15       // red flash before a candle goes
const T_CLOSE = 12         // results on the board
const TICK_0  = 2.4        // seconds between collapses at the bell
const TICK_MIN= 0.8
const TICK_DEC= 0.05       // shaved off every tick, so it tightens
const DUMP_AT = 26         // a whole row sweeps this often

const GREEN='#1f9d55', GREEN_D='#14512f', RED='#c0392b', AMBER='#e0821e'
const GOLD='#a9812a', GOLD_L='#e6c46a', DARK='#0e1a14', PAPER='#f4f0e3'
const DIM='#8a8262'

const isServer = world.isServer
const N = GRID_C * GRID_R

/* ------------------------------------------------------------------ */
/* helpers                                                             */
function prim(type,size,color,pos,opts){
  opts = opts || {}
  const n = app.create('prim')
  n.type=type; n.size=size; n.color=color
  n.position.set(OX+pos[0],pos[1],OZ+pos[2])
  if(opts.rotY) n.rotation.y=opts.rotY
  if(opts.rotX) n.rotation.x=opts.rotX
  if(opts.emissive) n.emissive=opts.emissive
  if(opts.tex && props[opts.tex]) n.texture = props[opts.tex].url
  if(opts.rough!==undefined) n.roughness=opts.rough
  if(opts.metal!==undefined) n.metalness=opts.metal
  if(opts.physics) n.physics=opts.physics
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
  u.backgroundColor=bg||DARK; u.borderColor=border||GOLD; u.borderWidth=5
  u.borderRadius=10; u.padding=20; u.flexDirection='column'; u.lit=false
  u.doubleside=false                       // a doubleside panel shows the back mirrored
  u.position.set(OX+pos[0],pos[1],OZ+pos[2])
  if(rotY) u.rotation.y=rotY
  app.add(u); return u
}
function text(parent,val,px,color,weight,mt){
  const t=app.create('uitext')
  t.value=val; t.fontSize=px; t.color=color||PAPER
  t.fontWeight=weight||400
  if(mt) t.marginTop=mt
  parent.add(t); return t
}
function row(parent,h){
  const v=app.create('uiview')
  v.flexDirection='row'; v.alignItems='center'
  if(h) v.height=h
  parent.add(v); return v
}
function cell(parent,w){
  const v=app.create('uiview')
  v.flexDirection='column'
  // setFlexBasis is not multiplied by _res the way width is, so a label
  // column set by basis alone comes out half the width you asked for
  v.width=w
  parent.add(v); return v
}
function commas(n){
  const s=String(Math.round(n)); let o=''
  for(let i=0;i<s.length;i++){
    if(i>0 && (s.length-i)%3===0) o+=','
    o+=s[i]
  }
  return o
}
const cellX = c => (c - (GRID_C-1)/2) * CELL
const cellZ = r => (r - (GRID_R-1)/2) * CELL
const HALF_X = (GRID_C*CELL)/2
const HALF_Z = (GRID_R*CELL)/2

/* ------------------------------------------------------------------ */
/* the stadium                                                         */

// the shaft you fall into — dark, so the drop reads as a drop
prim('box',[GRID_C*CELL+3, DECK_Y, GRID_R*CELL+3],'#0a1310',[0,DECK_Y/2-0.2,0],{rough:1})

// tiered stands around the deck
const STEPS = 5
for(let s=0;s<STEPS;s++){
  const inset = 1.6 + s*1.5
  const y = DECK_Y + 0.4 + s*0.9
  const w = GRID_C*CELL + inset*2
  const d = GRID_R*CELL + inset*2
  prim('box',[w,0.5,1.4],'#d8d0b8',[0,y,-(d/2)],{tex:'paving',rough:.95})
  prim('box',[w,0.5,1.4],'#d8d0b8',[0,y, (d/2)],{tex:'paving',rough:.95})
  prim('box',[1.4,0.5,d],'#d8d0b8',[-(w/2),y,0],{tex:'paving',rough:.95})
  prim('box',[1.4,0.5,d],'#d8d0b8',[ (w/2),y,0],{tex:'paving',rough:.95})
  // The crowd, on the front two tiers only and spaced out. Filling every seat
  // on every tier came to a hundred and eighty separate meshes for scenery
  // nobody looks at, and the frame rate went with it.
  if(s < 2){
    const JACKETS=['#c0392b','#1f9d55','#2b6cb0','#e0821e','#8e44ad','#d4a017']
    for(let i=0;i<Math.floor(w/3.2);i++){
      const jx = -w/2 + 1.6 + i*3.2
      const jc = JACKETS[(i+s)%JACKETS.length]
      prim('box',[0.42,0.62,0.34],jc,[jx,y+0.62,-(d/2)],{rough:.85})
      prim('box',[0.42,0.62,0.34],jc,[jx,y+0.62, (d/2)],{rough:.85})
    }
  }
}

// the bell, over the north end
prim('cylinder',[0.1,0.1,3.2],GOLD,[0,DECK_Y+7.2,-HALF_Z-2.2],{metal:.9,rough:.3})
prim('cone',[0.9,1.3],GOLD,[0,DECK_Y+5.2,-HALF_Z-2.2],{metal:.95,rough:.22})

/* the board */
const board = panel(1100,620,0.0075,[0,DECK_Y+6.4,-HALF_Z-2.9],0,DARK,GOLD)
board.alignItems='center'
const bTitle = text(board,'THE PIT',62,GOLD_L,700)
const bPhase = text(board,'',34,PAPER,700,10)
const bSub   = text(board,'',22,DIM,400,6)
const bList  = []
for(let i=0;i<8;i++) bList.push(text(board,'',20,PAPER,400,i===0?14:4))

/* ground-level sign and the way in */
prim('box',[8,0.4,0.3],GOLD,[0,1.4,HALF_Z+6],{metal:.8,rough:.35})
const signIn = panel(760,240,0.006,[0,2.6,HALF_Z+6],0,DARK,GOLD)
signIn.alignItems='center'
text(signIn,'THE PIT',44,GOLD_L,700)
text(signIn,'Open outcry. Last cat standing takes the purse.',20,DIM,400,8)

/* ------------------------------------------------------------------ */
/* the floor                                                           */
const cells = []
for(let r=0;r<GRID_R;r++){
  for(let c=0;c<GRID_C;c++){
    const p = prim('box',[CELL-0.1,0.5,CELL-0.1],GREEN,[cellX(c),DECK_Y,cellZ(r)],
                   {physics:'static',rough:.7})
    cells.push(p)
  }
}

/* ------------------------------------------------------------------ */
/* state                                                               */
const s = {
  phase:'lobby', t:T_LOBBY,
  standing:new Array(N).fill(true),
  warn:new Array(N).fill(0),
  tick:TICK_0, since:0, dump:0,
  alive:{},            // id -> name
  aliveN:0, started:0,
  results:[],          // {name, place}
}

function paint(){
  for(let i=0;i<N;i++){
    const p = cells[i]
    const up = s.standing[i]
    if(p.active !== up) p.active = up
    if(up) p.color = s.warn[i] ? RED : GREEN
  }
}

function label(){
  if(s.phase==='lobby'){
    bPhase.value = 'DOORS OPEN — ' + Math.ceil(s.t) + 's'
    bSub.value = 'Step onto the floor before the bell'
  } else if(s.phase==='open'){
    bPhase.value = s.aliveN + ' STANDING'
    bSub.value = 'The floor is the chart'
  } else {
    bPhase.value = 'BELL'
    bSub.value = 'Next round in ' + Math.ceil(s.t) + 's'
  }
  for(let i=0;i<bList.length;i++){
    const r = s.results[i]
    bList[i].value = r ? (r.place===1 ? 'WINNER  ' + r.name
                                      : '#' + r.place + '  ' + r.name) : ''
  }
}

/* ------------------------------------------------------------------ */
/* client: take what the server says and draw it                       */
if(!isServer){
  app.on('pit', d => {
    s.phase=d.p; s.t=d.t; s.aliveN=d.n; s.results=d.r||[]
    for(let i=0;i<N;i++){
      s.standing[i] = d.s.charCodeAt(i) !== 48   // '0'
      s.warn[i]     = d.w.charCodeAt(i) !== 48
    }
    paint(); label()
  })
}
paint(); label()

/* ------------------------------------------------------------------ */
/* server: own the round                                               */
if(isServer){
  let dirty = true

  const push = () => {
    let a='', b=''
    for(let i=0;i<N;i++){ a += s.standing[i]?'1':'0'; b += s.warn[i]?'1':'0' }
    app.send('pit',{p:s.phase,t:s.t,n:s.aliveN,r:s.results,s:a,w:b})
  }

  const onDeck = p => {
    const q = p.position
    return Math.abs(q.x - OX) < HALF_X+1.5 &&
           Math.abs(q.z - OZ) < HALF_Z+1.5 &&
           q.y > DECK_Y - 2
  }

  const seat = i => {
    // ring the eliminated around the stands rather than dropping them back
    // in mid-round, where they would stand on a floor that is still falling
    const a = (i%12)/12 * Math.PI*2
    return new Vector3(OX + Math.cos(a)*(HALF_X+7),
                       DECK_Y + 5.4,
                       OZ + Math.sin(a)*(HALF_Z+7))
  }

  const reset = () => {
    for(let i=0;i<N;i++){ s.standing[i]=true; s.warn[i]=0 }
    s.tick=TICK_0; s.since=0; s.dump=0
    s.alive={}; s.aliveN=0
    paint(); dirty=true
  }

  const openBell = () => {
    const ps = world.getPlayers()
    s.alive={}; s.aliveN=0
    for(const p of ps){ if(onDeck(p)){ s.alive[p.id]=p.name; s.aliveN++ } }
    if(s.aliveN===0){
      // nobody stepped on. Hold the doors rather than ringing the bell on an
      // empty floor and spinning through rounds nobody is in.
      s.t = T_LOBBY
      dirty = true
      return
    }
    s.started = s.aliveN
    s.phase='open'
    s.results=[]
    dirty=true
  }

  const fell = (id,name) => {
    if(!s.alive[id]) return
    delete s.alive[id]
    const place = s.aliveN
    s.aliveN--
    s.results.unshift({name:name||'a cat', place})
    if(s.results.length>8) s.results.length=8
    dirty=true
  }

  const drop = k => {
    // pick from what is still standing, or there is nothing to take
    const up=[]
    for(let i=0;i<N;i++) if(s.standing[i] && !s.warn[i]) up.push(i)
    for(let j=0;j<k && up.length;j++){
      const pick = num(0,up.length-1,0)
      s.warn[up[pick]] = T_WARN
      up.splice(pick,1)
    }
  }

  const dumpRow = () => {
    const r = num(0,GRID_R-1,0)
    for(let c=0;c<GRID_C;c++){
      const i = r*GRID_C+c
      if(s.standing[i] && !s.warn[i]) s.warn[i] = T_WARN
    }
  }

  let acc = 0
  app.on('update', dt => {
    s.t -= dt

    if(s.phase==='lobby'){
      if(s.t<=0){ openBell(); s.t=0 }
    } else if(s.phase==='open'){
      s.since += dt
      s.dump  += dt

      // warnings ripen into holes
      for(let i=0;i<N;i++){
        if(s.warn[i]>0){
          s.warn[i] -= dt
          if(s.warn[i]<=0){ s.warn[i]=0; s.standing[i]=false; dirty=true }
        }
      }
      if(s.since >= s.tick){
        s.since = 0
        s.tick = Math.max(TICK_MIN, s.tick - TICK_DEC)
        drop(3)
        dirty=true
      }
      if(s.dump >= DUMP_AT){ s.dump=0; dumpRow(); dirty=true }

      // anyone below the deck is out
      for(const p of world.getPlayers()){
        if(s.alive[p.id] && p.position.y < DECK_Y - 2.5){
          fell(p.id, p.name)
          p.teleport(seat(s.results.length), 0)
        }
      }
      const over = s.started > 1 ? s.aliveN <= 1 : s.aliveN === 0
      if(over){
        for(const id in s.alive){
          const nm = s.alive[id]
          s.results.unshift({name:nm, place:1})
          delete s.alive[id]
        }
        s.aliveN=0
        s.phase='close'; s.t=T_CLOSE; dirty=true
      }
      paint()
    } else {
      if(s.t<=0){
        reset(); s.phase='lobby'; s.t=T_LOBBY
        for(const p of world.getPlayers()){
          const q = p.position
          const near = Math.abs(q.x-OX) < HALF_X+12 && Math.abs(q.z-OZ) < HALF_Z+12
          if(near && q.y > DECK_Y - 4 && !onDeck(p)){
            p.teleport(new Vector3(OX + num(-4,4,1), DECK_Y+1.2, OZ + num(-3,3,1)), 0)
          }
        }
      }
    }

    acc += dt
    if(dirty || acc>0.5){ acc=0; dirty=false; label(); push() }
  })
}

/* ------------------------------------------------------------------ */
/* the lift in                                                         */
const aIn = app.create('action')
aIn.label = 'Enter the Pit'
aIn.distance = 4
aIn.duration = 0.5
// the offset lives inside prim() and panel(); an action built by hand skips
// it, which left the arena entrance standing in the middle of the plaza
aIn.position.set(OX, 1.6, OZ + HALF_Z + 6)
aIn.onTrigger = () => {
  const p = world.getPlayer()
  if(p) p.teleport(new Vector3(OX, DECK_Y+1.2, OZ), 0)
}
app.add(aIn)
