/*
 * CashCats HQ — The Workshop
 *
 * Playable demo of the economy the dev specified:
 *   - NO RNG anywhere. Every cost is fixed and shown before you act.
 *   - Upgrades are deterministic: pay the stated cost, always get the tier.
 *   - Everything wears out, including top-tier gear.
 *   - Repair cost scales with tier (higher grade = higher-grade materials).
 *   - Golden Cash Cat = premium unlock, better yield, but wears faster and
 *     costs more to repair, so buying in is an entry to a bigger sink and
 *     never an exit from the loop.
 *   - No blind boxes: the Golden panel lists exactly what you get first.
 */

const PAPER='#f4f0e3', INK='#16150f', GREEN='#1a7f4b', GREEN_D='#0f5c35'
const GOLD='#a9812a', GOLD_L='#e8c25a', WOOD='#6b543a', WOOD_L='#8a6f4c'
const DIM='#8fa39a', CREAM='#e8f2ec', RED='#c0392b'

const W=13, D=11, H=4.5, T=0.25, FLOOR_Y=0.06, WAINSCOT=1.3

function prim(type,size,color,pos,opts={}){
  const n=app.create('prim')
  n.type=type; n.size=size; n.color=color
  n.position.set(pos[0],pos[1],pos[2])
  if(opts.rotY) n.rotation.y=opts.rotY
  if(opts.emissive) n.emissive=opts.emissive
  app.add(n); return n
}
function wall(size,pos){
  const [w,h,d]=size, upper=h-WAINSCOT
  prim('box',[w,upper,d],PAPER,[pos[0],WAINSCOT+upper/2,pos[2]])
  prim('box',[w,WAINSCOT,d],GREEN,[pos[0],WAINSCOT/2,pos[2]])
  prim('box',[w>d?w:w+0.04,0.07,w>d?d+0.04:d],GOLD,[pos[0],WAINSCOT+0.035,pos[2]])
}

/* shell */
prim('box',[W,0.3,D],PAPER,[0,FLOOR_Y-0.15,0])
wall([W,H,T],[0,0,-D/2]); wall([T,H,D],[-W/2,0,0]); wall([T,H,D],[W/2,0,0])
wall([(W-3)/2,H,T],[-(W+3)/4,0,D/2]); wall([(W-3)/2,H,T],[(W+3)/4,0,D/2])
prim('box',[3,H-3,T],PAPER,[0,H-(H-3)/2,D/2])
for(let i=-2;i<=2;i++) prim('box',[W,0.22,0.32],'#d8d0b8',[0,H+0.1,i*(D/5)])
for(let i=-2;i<=2;i++) prim('box',[W-1.6,0.06,0.12],'#fff6d8',[0,H-0.2,i*(D/5)],{emissive:'#fff0c0'})

/* workbench — three stations, one per action */
prim('box',[7.4,0.95,1.3],WOOD,[0,FLOOR_Y+0.475,-3.1])
prim('box',[7.6,0.12,1.5],WOOD_L,[0,FLOOR_Y+1.0,-3.1])
prim('box',[7.6,0.05,1.55],GOLD,[0,FLOOR_Y+1.07,-3.1])
// station markers so the three actions read as separate benches
for(const x of [-2.4,0,2.4]) prim('box',[0.1,0.9,1.32],WOOD_L,[x+1.2,FLOOR_Y+0.48,-3.1])

/* ---------------- economy model ---------------- */
// Every number here is deliberately fixed and published on the panels.
const MAX_TIER = 5
const BASE_YIELD = 10          // scrap per shift, tier 1, standard cat
const GOLD_MULT  = 1.6         // golden cats grind faster
const WEAR_STD   = 8           // durability lost per shift
const WEAR_GOLD  = 11          // golden gear works harder, wears harder
const GOLD_PRICE = 250000      // $CASHCATSLLC to unlock the Golden Cat

const s = {
  gold: false,
  tier: 1,
  durability: 100,
  scrap: 0,
  shifts: 0,
  burned: 0,
}

// the app sandbox has no Intl, so toLocaleString leaves numbers unseparated
const commas = n => {
  const d = String(n), out = []
  for (let i = 0; i < d.length; i++) {
    if (i > 0 && (d.length - i) % 3 === 0) out.push(',')
    out.push(d[i])
  }
  return out.join('')
}

const upgradeCost = t => 120 * t * t            // deterministic, published
const repairCost  = () => Math.round((100 - s.durability) * (s.gold ? 1.8 : 1.0) * (1 + 0.5 * (s.tier - 1)))
const yieldPer    = () => Math.round(BASE_YIELD * s.tier * (s.gold ? GOLD_MULT : 1))
const wearPer     = () => (s.gold ? WEAR_GOLD : WEAR_STD)

/* ---------------- ui helpers ---------------- */
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
// label/value row. the label sits in a fixed-width view so the numbers line
// up in a column even though the font is proportional.
function row(parent,label,sizePx,mt){
  const v=app.create('uiview')
  v.flexDirection='row'; v.alignItems='center'
  if(mt) v.margin=[mt,0,0,0]
  parent.add(v)
  const lw=app.create('uiview')
  lw.width=270; lw.flexShrink=0
  v.add(lw)
  const l=app.create('uitext')
  l.value=label; l.fontSize=sizePx; l.color=DIM
  lw.add(l)
  const r=app.create('uitext')
  r.value=''; r.fontSize=sizePx; r.color=CREAM; r.fontWeight=600; r.flexGrow=1
  v.add(r)
  return r
}
// a full-width line indented to sit under the value column
function indented(parent,sizePx,color,mt){
  const t=app.create('uitext')
  t.value=''; t.fontSize=sizePx; t.color=color
  t.margin=[mt||0,0,0,270]
  parent.add(t); return t
}

/* ---------------- status board ---------------- */
const status = panel(820,660,0.0050,[0,2.45,-D/2+T/2+0.02],0,'#0e1f18',GOLD)
text(status,'THE WORKSHOP',56,GOLD_L,700)
text(status,'live economy demo — every number below is fixed and published',24,DIM,400,8)

const vCat  = row(status,'Cat',36,24)
const vTier = row(status,'Gear tier',36,10)
const vDur  = row(status,'Durability',36,10)
const vBar  = indented(status,36,'#2ecc71',4)
const vScrap= row(status,'Scrap',36,10)

const lNext = text(status,'',28,DIM,400,26)
const lRep  = text(status,'',28,DIM,400,6)
const lTot  = text(status,'',24,'#5f7168',400,20)

function bar(pct){
  const filled = Math.max(0, Math.min(10, Math.round(pct/10)))
  let out=''
  for(let i=0;i<10;i++) out += i<filled ? '■ ' : '□ '
  return out
}

function render(){
  vCat.value  = s.gold ? 'GOLDEN  (x1.6 yield)' : 'STANDARD'
  vCat.color  = s.gold ? GOLD_L : CREAM
  vTier.value = s.tier + ' / ' + MAX_TIER
  vDur.value  = s.durability + '%'
  vBar.value  = bar(s.durability)
  vBar.color  = s.durability > 50 ? '#2ecc71' : (s.durability > 20 ? GOLD_L : RED)
  vScrap.value= String(s.scrap)
  lNext.value = s.tier >= MAX_TIER
      ? 'Gear is max tier.'
      : 'Next upgrade: ' + upgradeCost(s.tier) + ' scrap  — guaranteed, never rolled'
  lRep.value  = 'Repair to 100%: ' + repairCost() + ' scrap'
  lTot.value  = 'Shifts worked ' + s.shifts + '   ·   $CASHCATSLLC burned ' + commas(s.burned)
}

/* ---------------- rules board (full disclosure) ----------------
 * The ui text layout soft-wraps and collapses embedded newlines, so each
 * line here is its own node rather than one \n-separated block.
 */
const rules = panel(700,500,0.0038,[-W/2+T/2+0.02,2.9,-1.2],Math.PI/2,PAPER,GOLD)
text(rules,'HOUSE RULES',46,GREEN_D,700)
function rule(n,head,body){
  text(rules,n+'. '+head,30,GREEN_D,700,n===1?26:20)
  text(rules,body,25,INK,400,4)
}
rule(1,'No RNG.','Upgrades always succeed. Costs are fixed and shown before you commit.')
rule(2,'No paid odds.','Nothing you buy changes the chance of anything.')
rule(3,'Everything wears out.','Including golden gear. Higher tier costs more to repair.')
rule(4,'No blind boxes.','Every trait is listed before purchase.')

/* ---------------- golden cat offer (traits disclosed) ---------------- */
const shop = panel(700,660,0.0038,[W/2-T/2-0.02,3.0,-1.2],-Math.PI/2,'#1d1a10',GOLD)
text(shop,'GOLDEN CASH CAT',46,GOLD_L,700)
text(shop,'EXACT TRAITS — no mystery box',24,DIM,400,8)
const gY = row(shop,'Yield',30,22);        gY.value='x1.60'
const gW = row(shop,'Wear per shift',30,8); gW.value='11  (vs 8)'
const gR = row(shop,'Repair cost',30,8);    gR.value='x1.80'
const gT = row(shop,'Tier cap',30,8);       gT.value='5'
const gC = row(shop,'Cosmetic',30,8);       gC.value='Gold coat'
const gP = row(shop,'Price',30,18);         gP.value=commas(GOLD_PRICE); gP.color=GOLD_L
text(shop,'Burned on purchase — the tokens leave supply.',22,DIM,400,8)
text(shop,'Grinds faster. Costs more to keep running.',24,'#c9bfa6',400,18)
text(shop,'Never pay-to-win: no stat here is out of',24,'#c9bfa6',400,2)
text(shop,'reach for a free player.',24,'#c9bfa6',400,2)

const goldPic = app.create('image')
goldPic.src = props.gold ? props.gold.url : null
goldPic.width = 1.5; goldPic.height = 1.5
goldPic.color = 'transparent'; goldPic.lit = false; goldPic.doubleside = true
goldPic.position.set(W/2-T/2-0.06, 0.95, -2.9)
goldPic.rotation.y = -Math.PI/2
app.add(goldPic)

/* ---------------- actions ---------------- */
function action(label,pos,fn,dist){
  const a=app.create('action')
  a.label=label; a.distance=dist||3.6; a.duration=0.35
  a.position.set(pos[0],pos[1],pos[2])
  a.onTrigger=fn
  app.add(a); return a
}

action('Work a shift',[-2.4,FLOOR_Y+1.2,-2.6],()=>{
  if(s.durability<=0){ lNext.value='Gear is broken — repair before working.'; return }
  s.scrap += yieldPer()
  s.durability = Math.max(0, s.durability - wearPer())
  s.shifts++
  render()
})

action('Repair gear',[0,FLOOR_Y+1.2,-2.6],()=>{
  const c=repairCost()
  if(c===0) return
  if(s.scrap<c){ lRep.value='Repair to 100%: '+c+' scrap  (not enough)'; return }
  s.scrap-=c; s.durability=100; render()
})

action('Upgrade gear',[2.4,FLOOR_Y+1.2,-2.6],()=>{
  if(s.tier>=MAX_TIER) return
  const c=upgradeCost(s.tier)
  if(s.scrap<c){ lNext.value='Next upgrade: '+c+' scrap  (not enough)'; return }
  s.scrap-=c; s.tier++; render()      // deterministic: never fails
})

action('Unlock Golden Cash Cat',[W/2-1.5,FLOOR_Y+1.2,-1.2],()=>{
  if(s.gold) return
  s.gold=true
  s.burned += GOLD_PRICE            // demo: real build burns on-chain
  render()
},3.8)

render()
