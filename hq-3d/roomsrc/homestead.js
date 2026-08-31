/*
 * CashCats HQ — The Homestead
 *
 * The housing and farming loop the dev described: buy land, build a house on
 * it, run a farm, and spend what the farm yields on boosts, materials and
 * trades. Built to the same house rules as The Workshop:
 *
 *   - No RNG. Plot prices, build costs and yields are all fixed and posted.
 *   - Buildings wear out exactly like equipment does. Cosmetics never do.
 *   - Harvests are on a counter, not a roll.
 *   - One-way sink: land and construction burn $CASHCATSLLC and nothing here
 *     ever pays any back out.
 */

const PAPER='#f4f0e3', INK='#16150f', GREEN='#1a7f4b', GREEN_D='#0f5c35'
const GOLD='#a9812a', GOLD_L='#e8c25a', WOOD='#6b543a', WOOD_L='#8a6f4c'
const DIM='#8fa39a', CREAM='#e8f2ec', RED='#c0392b', LIME='#2ecc71'
const SOIL='#5a4632', SOIL_D='#463526', CROP='#7ac14a'

const W=15, D=12, H=4.5, T=0.25, FLOOR_Y=0.06, WAINSCOT=1.3
const BACK_Z=-D/2+T/2+0.02, LEFT_X=-W/2+T/2+0.02, RIGHT_X=W/2-T/2-0.02

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
function wall(size,pos){
  const [w,h,d]=size, upper=h-WAINSCOT
  prim('box',[w,upper,d],'#ffffff',[pos[0],WAINSCOT+upper/2,pos[2]],{tex:'plaster',rough:0.95})
  prim('box',[w,WAINSCOT,d],'#ffffff',[pos[0],WAINSCOT/2,pos[2]],{tex:'wainscot',rough:0.6})
  prim('box',[w>d?w:w+0.04,0.07,w>d?d+0.04:d],GOLD,[pos[0],WAINSCOT+0.035,pos[2]],{metal:0.85,rough:0.3})
}

/* shell — open beam roof, because sealed rooms render black with no lights */
prim('box',[W,0.3,D],'#ffffff',[0,FLOOR_Y-0.15,0],{tex:'pavingRoom',rough:0.9})
wall([W,H,T],[0,0,-D/2]); wall([T,H,D],[-W/2,0,0]); wall([T,H,D],[W/2,0,0])
wall([(W-3)/2,H,T],[-(W+3)/4,0,D/2]); wall([(W-3)/2,H,T],[(W+3)/4,0,D/2])
prim('box',[3,H-3,T],PAPER,[0,H-(H-3)/2,D/2])
for(let i=-2;i<=2;i++) prim('box',[W,0.22,0.32],'#d8d0b8',[0,H+0.1,i*(D/5)])
for(let i=-2;i<=2;i++) prim('box',[W-1.6,0.06,0.12],'#fff6d8',[0,H-0.2,i*(D/5)],{emissive:'#fff0c0'})

/* =========================== model =========================== */
const PLOTS = [
  { name:'Smallholding', price:  40000, beds:2 },
  { name:'Farmstead',    price: 120000, beds:4 },
  { name:'Estate',       price: 320000, beds:6 },
]
const HOUSE_COST  = 60      // timber to raise the house
const HOUSE_WEAR  = 6       // per harvest — buildings wear, same as gear
const FARM_WEAR   = 4
const YIELD_PER_BED = 8     // produce per bed per harvest
const REPAIR_RATE = 1.4     // produce per durability point
const BOOST_COST  = 120     // produce for a temporary stat boost
const TIMBER_RATE = 3       // produce -> timber
// The yard sells timber for tokens. Without it the loop deadlocks: harvesting
// needs a house, the house needs timber, and timber only comes from produce.
// It is also the sink the dev asked for — tokens in, nothing out.
// The House Vault: stack Gold Cash Cats and the whole holding gets better.
// Straight from the dev — faster yield, a Cosmetic Rating bump capped by the
// cat's level, and land you can only unlock by stacking more.
const VAULT_YIELD = 0.15    // +15% harvest per Gold Cash Cat vaulted
const VAULT_COS   = 4       // +4 Cosmetic Rating each, capped by level
const PLOT_GCC    = [0, 1, 3]   // gold cash cats needed to unlock each plot

const TIMBER_LOT   = 20
const TIMBER_PRICE = 25000

const s = {
  plot: -1,          // index into PLOTS, -1 = no land
  house: false,
  houseDur: 100,
  farmDur: 100,
  produce: 0,
  timber: 0,
  harvests: 0,
  boosts: 0,
  burned: 0,
  gcc: 3,        // Gold Cash Cats on hand (earned from bosses in the Workshop)
  vault: 0,      // ...and how many are stacked in the House Vault
  level: 6,      // the cat's level, which caps what the vault can give
}

const beds      = () => s.plot < 0 ? 0 : PLOTS[s.plot].beds
const vaultMult = () => 1 + VAULT_YIELD * s.vault
const vaultCos  = () => Math.min(VAULT_COS * s.vault, s.level * 5)   // level caps it
const yieldPer  = () => s.house ? Math.round(beds() * YIELD_PER_BED * vaultMult()) : 0
const repairCost= (dur) => Math.round((100 - dur) * REPAIR_RATE)

const commas = n => {          // no Intl in the app sandbox
  const d = String(n), out = []
  for (let i = 0; i < d.length; i++) {
    if (i > 0 && (d.length - i) % 3 === 0) out.push(',')
    out.push(d[i])
  }
  return out.join('')
}

/* =========================== ui =========================== */
function panel(w,h,size,pos,rotY,bg,border){
  const u=app.create('ui')
  u.space='world'; u.width=w; u.height=h; u.size=size
  u.backgroundColor=bg; u.borderColor=border; u.borderWidth=6; u.borderRadius=12
  u.padding=26; u.flexDirection='column'; u.lit=false; u.doubleside=true
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
function row(parent,label,sizePx,mt,labelW){
  const v=app.create('uiview')
  v.flexDirection='row'; v.alignItems='center'
  if(mt) v.margin=[mt,0,0,0]
  parent.add(v)
  const lw=app.create('uiview'); lw.width=labelW||300; lw.flexShrink=0; v.add(lw)
  const l=app.create('uitext'); l.value=label; l.fontSize=sizePx; l.color=DIM; lw.add(l)
  const r=app.create('uitext')
  r.value=''; r.fontSize=sizePx; r.color=CREAM; r.fontWeight=600; r.flexGrow=1
  v.add(r)
  return r
}
function indented(parent,sizePx,color,mt,indent){
  const t=app.create('uitext')
  t.value=''; t.fontSize=sizePx; t.color=color
  t.margin=[mt||0,0,0,indent||300]
  parent.add(t); return t
}
function row3(parent,widths,sizePx,mt){
  const v=app.create('uiview')
  v.flexDirection='row'; v.alignItems='center'
  if(mt) v.margin=[mt,0,0,0]
  parent.add(v)
  const cells=[]
  for(let i=0;i<3;i++){
    const wrap=app.create('uiview'); wrap.width=widths[i]; wrap.flexShrink=0; v.add(wrap)
    const t=app.create('uitext'); t.value=''; t.fontSize=sizePx; t.color=CREAM
    wrap.add(t); cells.push(t)
  }
  return cells
}
function bar(pct){
  const filled=Math.max(0,Math.min(10,Math.round(pct/10)))
  let out=''
  for(let i=0;i<10;i++) out += i<filled ? '■ ' : '□ '
  return out
}

/* ---- the holding ---- */
const hold = panel(760,720,0.0044,[-3.5,2.6,BACK_Z],0,'#0e1f18',GOLD)
text(hold,'YOUR HOLDING',46,GOLD_L,700)
text(hold,'land and buildings — both wear out',22,DIM,400,6)
const vPlot  = row(hold,'Plot',30,22)
const vBeds  = row(hold,'Beds',30,8)
const vHouse = row(hold,'House',30,16)
const vHD    = row(hold,'House condition',30,8)
const bHD    = indented(hold,30,LIME,2)
const vFD    = row(hold,'Farm condition',30,12)
const bFD    = indented(hold,30,LIME,2)
const lRepH  = text(hold,'',24,DIM,400,18)
const lRepF  = text(hold,'',24,DIM,400,4)

/* ---- the barn ---- */
const barn = panel(760,660,0.0044,[3.5,2.75,BACK_Z],0,'#0e1f18',GOLD)
text(barn,'THE BARN',46,GOLD_L,700)
text(barn,'what the farm yields, and what it buys',22,DIM,400,6)
const vProd = row(barn,'Produce',30,22)
const vTimb = row(barn,'Timber',30,8)
const vHarv = row(barn,'Harvests',30,8)
const vBoost= row(barn,'Boosts bought',30,8)
const vBurn = row(barn,'$CASHCATSLLC burned',30,12)
const lYield= text(barn,'',24,DIM,400,18)
const lMill = text(barn,'',24,DIM,400,4)
const lBoost= text(barn,'',24,DIM,400,4)

/* ---- land office ---- */
const land = panel(700,620,0.0038,[LEFT_X,2.8,-1.0],Math.PI/2,'#1d1a10',GOLD)
text(land,'LAND OFFICE',44,GOLD_L,700)
text(land,'every plot priced up front — no auction, no roll',22,DIM,400,6)
const lh = row3(land,[260,240,140],26,20)
lh[0].value='PLOT'; lh[1].value='PRICE'; lh[2].value='BEDS'
lh[0].color=DIM; lh[1].color=DIM; lh[2].color=DIM
const plotRows=[]
for(let i=0;i<PLOTS.length;i++){
  const c=row3(land,[260,240,140],30,12)
  c[0].value=PLOTS[i].name
  c[1].value=commas(PLOTS[i].price)
  c[2].value=String(PLOTS[i].beds)
  plotRows.push(c)
}
text(land,'Land is bought with $CASHCATSLLC and burned.',23,'#c9bfa6',400,22)
text(land,'Beds set the harvest: more beds, more produce.',23,'#c9bfa6',400,4)
text(land,'A plot with no house on it yields nothing.',23,'#c9bfa6',400,4)
text(land,'Timber is sold in the yard for tokens, so a new',23,'#c9bfa6',400,14)
text(land,'holder can raise a first house without a farm.',23,'#c9bfa6',400,4)

/* ---- the house vault ---- */
const vault = panel(700,660,0.0038,[RIGHT_X,2.8,-4.4],-Math.PI/2,'#1d1a10',GOLD)
text(vault,'HOUSE VAULT',44,GOLD_L,700)
text(vault,'stack Gold Cash Cats — the holding improves',22,DIM,400,6)
const vGcc   = row(vault,'On hand',30,20,300)
const vVault = row(vault,'Vaulted',30,8,300)
const vMult  = row(vault,'Harvest',30,16,300)
const vVCos  = row(vault,'Cosmetic Rating',30,8,300)
const nVCos  = indented(vault,22,DIM,2,300)
const lLand  = text(vault,'',24,DIM,400,18)
text(vault,'Each Gold Cash Cat vaulted is +' + Math.round(VAULT_YIELD*100) + '% harvest',23,'#c9bfa6',400,18)
text(vault,'and +' + VAULT_COS + ' Cosmetic Rating, capped by your level.',23,'#c9bfa6',400,2)
text(vault,'Bigger plots need them too — the more territory',23,'#c9bfa6',400,12)
text(vault,'you unlock, the more it takes.',23,'#c9bfa6',400,2)

/* ---- rules ---- */
const rules = panel(700,540,0.0038,[RIGHT_X,2.8,-1.0],-Math.PI/2,PAPER,GOLD)
text(rules,'HOMESTEAD RULES',42,GREEN_D,700)
function rule(n,head,body){
  text(rules,n+'. '+head,28,GREEN_D,700,n===1?22:16)
  text(rules,body,23,INK,400,4)
}
rule(1,'Buildings wear out.','A house and a farm decay every harvest, exactly like equipment.')
rule(2,'Harvests are counted, not rolled.','Same beds, same produce, every time.')
rule(3,'Nothing is wasted.','Spare produce mills into timber for construction and repairs.')
rule(4,'One-way sink.','Land and building burn $CASHCATSLLC. The farm never pays any back.')

/* ---- the farm itself ---- */
prim('box',[9,0.12,4.2],'#ffffff',[0,FLOOR_Y+0.06,1.6],{tex:'soil',rough:1.0})
for(let r=0;r<4;r++){
  prim('box',[8.6,0.16,0.55],SOIL,[0,FLOOR_Y+0.14,0.1+r*1.0])
  for(let c=-4;c<=4;c++){
    prim('cone',[0.17,0.6],CROP,[c*0.95,FLOOR_Y+0.44,0.1+r*1.0],{rough:0.9})
    prim('cylinder',[0.035,0.045,0.26],GREEN_D,[c*0.95,FLOOR_Y+0.25,0.1+r*1.0],{rough:0.9})
  }
}
/* the house frame, raised once it is built */
const houseParts = []
function housePart(n){ houseParts.push(n); n.active = false; return n }
housePart(prim('box',[3.4,2.2,3.0],'#ffffff',[-4.6,FLOOR_Y+1.1,3.4],{tex:'wood',rough:0.8}))
housePart(prim('box',[3.8,0.28,3.4],'#ffffff',[-4.6,FLOOR_Y+2.3,3.4],{tex:'wood',rough:0.7}))
housePart(prim('box',[0.9,1.5,0.12],WOOD,[-4.6,FLOOR_Y+0.75,4.92]))
/* the plot marker, before anything is built on it */
const stakes = []
for(const [x,z] of [[-6.3,1.9],[-2.9,1.9],[-6.3,4.9],[-2.9,4.9]])
  stakes.push(prim('box',[0.12,1.0,0.12],GOLD,[x,FLOOR_Y+0.5,z]))

/* =========================== actions =========================== */
function action(label,pos,fn,dist){
  const a=app.create('action')
  a.label=label; a.distance=dist||2.4; a.duration=0.35
  a.position.set(pos[0],pos[1],pos[2])
  a.onTrigger=fn
  app.add(a); return a
}
const BY = FLOOR_Y+1.2

const aBuy = action('',[LEFT_X+1.5,BY,-1.0],()=>{
  if(s.plot >= PLOTS.length-1) return
  const next = s.plot + 1
  if(s.vault < PLOT_GCC[next]){
    lLand.value = PLOTS[next].name + ' needs ' + PLOT_GCC[next] + ' vaulted (have ' + s.vault + ')'
    return
  }
  s.burned += PLOTS[next].price      // demo: the real build burns on-chain
  s.plot = next
  render()
},3.2)

const aVault = action('',[RIGHT_X-1.5,BY,-4.4],()=>{
  if(s.gcc <= 0) return
  s.gcc--; s.vault++                 // bound to the player, never traded away
  render()
},3.2)

const aBuild = action('',[-4.6,BY,5.6],()=>{
  if(s.plot < 0){ lRepH.value = 'Buy a plot before building.'; return }
  if(s.house) return
  if(s.timber < HOUSE_COST){ lRepH.value = 'Raise a house: '+HOUSE_COST+' timber (not enough)'; return }
  s.timber -= HOUSE_COST
  s.house = true
  render()
})

const aHarvest = action('Work the farm',[0,BY,-0.6],()=>{
  if(!s.house){ lYield.value = 'Raise a house before the farm produces.'; return }
  if(s.houseDur <= 0 || s.farmDur <= 0){ lRepF.value = 'Repair before harvesting.'; return }
  s.produce += yieldPer()                       // counted, never rolled
  s.houseDur = Math.max(0, s.houseDur - HOUSE_WEAR)
  s.farmDur  = Math.max(0, s.farmDur  - FARM_WEAR)
  s.harvests++
  render()
})

const aMill = action('Mill produce into timber',[3.2,BY,-0.6],()=>{
  if(s.produce < TIMBER_RATE){ lMill.value = 'Mill: '+TIMBER_RATE+' produce -> 1 timber (not enough)'; return }
  s.produce -= TIMBER_RATE; s.timber++; render()
})

const aFixH = action('Repair the house',[-3.2,BY,-0.6],()=>{
  const c = repairCost(s.houseDur)
  if(c === 0) return
  if(s.produce < c){ lRepH.value = 'Repair house: '+c+' produce (not enough)'; return }
  s.produce -= c; s.houseDur = 100; render()
})

const aFixF = action('Repair the farm',[1.6,BY,-0.6],()=>{
  const c = repairCost(s.farmDur)
  if(c === 0) return
  if(s.produce < c){ lRepF.value = 'Repair farm: '+c+' produce (not enough)'; return }
  s.produce -= c; s.farmDur = 100; render()
})

const aTimber = action('',[RIGHT_X-1.5,BY,-3.4],()=>{
  s.timber += TIMBER_LOT
  s.burned += TIMBER_PRICE           // demo: the real build burns on-chain
  render()
},3.2)

const aBoost = action('',[RIGHT_X-1.5,BY,-1.0],()=>{
  if(s.produce < BOOST_COST){ lBoost.value = 'Boost: '+BOOST_COST+' produce (not enough)'; return }
  s.produce -= BOOST_COST; s.boosts++; render()
},3.2)

/* =========================== render =========================== */
function render(){
  vPlot.value  = s.plot < 0 ? 'none yet' : PLOTS[s.plot].name
  vPlot.color  = s.plot < 0 ? DIM : GOLD_L
  vBeds.value  = String(beds())
  vHouse.value = s.house ? 'built' : (s.plot < 0 ? '—' : 'not built')
  vHouse.color = s.house ? LIME : DIM
  vHD.value    = s.houseDur + '%'
  bHD.value    = bar(s.houseDur)
  bHD.color    = s.houseDur > 50 ? LIME : (s.houseDur > 20 ? GOLD_L : RED)
  vFD.value    = s.farmDur + '%'
  bFD.value    = bar(s.farmDur)
  bFD.color    = s.farmDur > 50 ? LIME : (s.farmDur > 20 ? GOLD_L : RED)
  lRepH.value  = 'Repair house: ' + repairCost(s.houseDur) + ' produce'
  lRepF.value  = 'Repair farm: '  + repairCost(s.farmDur)  + ' produce'

  vProd.value  = String(s.produce)
  vTimb.value  = String(s.timber)
  vHarv.value  = String(s.harvests)
  vBoost.value = String(s.boosts)
  lYield.value = s.house
      ? 'Each harvest: ' + yieldPer() + ' produce (' + beds() + ' beds x ' + YIELD_PER_BED + ')'
      : 'No house yet — the farm yields nothing.'
  vGcc.value   = String(s.gcc)
  vVault.value = String(s.vault)
  vVault.color = s.vault ? GOLD_L : CREAM
  vMult.value  = 'x' + vaultMult().toFixed(2) + '   (' + yieldPer() + ' per harvest)'
  vVCos.value  = '+' + vaultCos()
  nVCos.value  = VAULT_COS * s.vault > s.level * 5
      ? 'capped — ' + (VAULT_COS * s.vault) + ' earned, level ' + s.level + ' allows ' + (s.level * 5)
      : 'applies to every cat on the account'
  const nxt = s.plot + 1
  lLand.value = nxt < PLOTS.length
      ? PLOTS[nxt].name + ' needs ' + PLOT_GCC[nxt] + ' vaulted'
      : 'All territory unlocked.'
  aVault.label = s.gcc > 0
      ? 'Vault a Gold Cash Cat (' + s.gcc + ' on hand)'
      : 'No Gold Cash Cats — win them from bosses'

  vBurn.value  = commas(s.burned)
  vBurn.color  = s.burned ? '#e08a6a' : CREAM
  lMill.value  = 'Mill: ' + TIMBER_RATE + ' produce -> 1 timber'
  lBoost.value = 'Temporary stat boost: ' + BOOST_COST + ' produce'

  for(let i=0;i<plotRows.length;i++){
    const owned = i <= s.plot
    const col = owned ? LIME : (i===2 ? GOLD_L : CREAM)
    plotRows[i][0].value = PLOTS[i].name + (i === s.plot ? '  (held)' : '')
    for(let k=0;k<3;k++) plotRows[i][k].color = k===1 && !owned ? DIM : col
  }

  for(const n of houseParts) n.active = s.house
  for(const n of stakes) n.active = s.plot >= 0 && !s.house

  aBuy.label = s.plot >= PLOTS.length-1
      ? 'Largest plot held'
      : 'Buy ' + PLOTS[s.plot+1].name + ' — ' + commas(PLOTS[s.plot+1].price) + ' $CASHCATSLLC'
  aBuild.label = s.house ? 'House built' : 'Raise the house — ' + HOUSE_COST + ' timber'
  aBoost.label = 'Buy temporary stat boost — ' + BOOST_COST + ' produce'
  aTimber.label = 'Buy ' + TIMBER_LOT + ' timber — ' + commas(TIMBER_PRICE) + ' $CASHCATSLLC'
}

render()
