/*
 * CashCats HQ — The Workshop
 *
 * A playable demo of the economy the dev specified, built so the ruleset can
 * be checked on screen instead of argued about in chat.
 *
 *   - No RNG. Every cost is fixed and shown before you commit.
 *   - Upgrades are deterministic: pay the stated cost, always get the tier.
 *   - Equipment and buildings wear out. COSMETICS NEVER DO.
 *   - NFTs come in four tiers: Common, Copper, Silver, Gold.
 *   - Cosmetic Rating is account-wide (every cat you own gets it) and comes
 *     only from NFTs held or $CASHCATSLLC spent. Equipment Rating is per-cat.
 *   - Both ratings are capped by the cat's level, and gear has a level
 *     requirement to wear.
 *   - Spare loot dismantles into materials; low-grade materials combine into
 *     high-grade, so nothing is wasted.
 *   - One-way sink: the game burns $CASHCATSLLC and never pays any out.
 */

const PAPER='#f4f0e3', INK='#16150f', GREEN='#1a7f4b', GREEN_D='#0f5c35'
const GOLD='#a9812a', GOLD_L='#e8c25a', WOOD='#6b543a', WOOD_L='#8a6f4c'
const DIM='#8fa39a', CREAM='#e8f2ec', RED='#c0392b', LIME='#2ecc71'

const W=13, D=11, H=4.5, T=0.25, FLOOR_Y=0.06, WAINSCOT=1.3
const BACK_Z = -D/2+T/2+0.02, FRONT_Z = D/2-T/2-0.02
const LEFT_X = -W/2+T/2+0.02, RIGHT_X = W/2-T/2-0.02

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
function wall(size,pos){
  const [w,h,d]=size, upper=h-WAINSCOT
  prim('box',[w,upper,d],'#ffffff',[pos[0],WAINSCOT+upper/2,pos[2]],{tex:'plaster',rough:0.95})
  prim('box',[w,WAINSCOT,d],'#ffffff',[pos[0],WAINSCOT/2,pos[2]],{tex:'wainscot',rough:0.6})
  prim('box',[w>d?w:w+0.04,0.07,w>d?d+0.04:d],GOLD,[pos[0],WAINSCOT+0.035,pos[2]],{metal:0.85,rough:0.3})
}

/* shell. hyperfy has no light nodes — lighting comes only from the sky, so a
 * sealed room renders black. hence the open beam roof and emissive strips. */
prim('box',[W,0.3,D],'#ffffff',[0,FLOOR_Y-0.15,0],{tex:'pavingRoom',rough:0.9})
wall([W,H,T],[0,0,-D/2]); wall([T,H,D],[-W/2,0,0]); wall([T,H,D],[W/2,0,0])
wall([(W-3)/2,H,T],[-(W+3)/4,0,D/2]); wall([(W-3)/2,H,T],[(W+3)/4,0,D/2])
prim('box',[3,H-3,T],PAPER,[0,H-(H-3)/2,D/2])
for(let i=-2;i<=2;i++) prim('box',[W,0.22,0.32],'#d8d0b8',[0,H+0.1,i*(D/5)])
for(let i=-2;i<=2;i++) prim('box',[W-1.6,0.06,0.12],'#fff6d8',[0,H-0.2,i*(D/5)],{emissive:'#fff0c0'})

/* workbench */
prim('box',[8.4,0.95,1.3],'#ffffff',[0,FLOOR_Y+0.475,-3.1],{tex:'wood',rough:0.75})
prim('box',[8.6,0.12,1.5],'#ffffff',[0,FLOOR_Y+1.0,-3.1],{tex:'wood',rough:0.6})
prim('box',[8.6,0.05,1.55],GOLD,[0,FLOOR_Y+1.07,-3.1],{metal:0.85,rough:0.3})
for(const x of [-2.7,-0.9,0.9,2.7]) prim('box',[0.1,0.9,1.32],WOOD_L,[x,FLOOR_Y+0.48,-3.1])

/* =========================== economy model ===========================
 * Every number below is fixed and printed in-world before you can act on it.
 */

// The four NFT tiers. Price is burned; the rating is permanent and applies to
// every cat on the account. Cosmetics do not wear, so this never decays.
const NFT = [
  { name:'None',   price:0,      cos:0   },
  { name:'Common', price:25000,  cos:10  },
  { name:'Copper', price:80000,  cos:25  },
  { name:'Silver', price:200000, cos:55  },
  { name:'Gold',   price:500000, cos:120 },
]
// The playable cats. Each carries one signature trait, per the dev: the cat
// is who you are, the class is what you do. Every trait is deterministic —
// "every 5th shift", "one part less" — never a chance.
const CATS = [
  { key:'catCash',    name:'Cash Cat',    trait:'Payday',
    desc:'every 5th shift pays double' },
  { key:'catLong',    name:'Long Cat',    trait:'Long Reach',
    desc:'gear wears 6 per shift instead of 8' },
  { key:'catSerious', name:'Serious Cat', trait:'Due Diligence',
    desc:'repairs cost 20% less' },
  { key:'catApple',   name:'Apple Cat',   trait:'Windfall',
    desc:'dismantling returns half again as much' },
  { key:'catPop',     name:'Pop Cat',     trait:'Pop Off',
    desc:'upgrades cost one part less' },
]

// Four classes. Every skill effect below is deterministic — "every 3rd hit",
// "below 25% HP" — so the no-RNG rule holds in combat too, not just at the
// workbench.
const CLASSES = [
  { name:'Warrior',   hp:140, atk:22, spd: 8, feeds:'HP',
    skills:[[1,'Guard Stance','take 25% less damage while standing still'],
            [4,'Shield Bash','every 3rd hit stuns'],
            [8,'Last Stand','below 25% HP, attack +50%']] },
  { name:'Archer',    hp: 95, atk:26, spd:14, feeds:'SPD',
    skills:[[1,'Quick Draw','first shot of a fight is instant'],
            [4,'Piercing Shot','every 3rd arrow ignores armour'],
            [8,'Arrow Storm','five-arrow volley, fixed damage']] },
  { name:'Elemental', hp: 90, atk:30, spd:10, feeds:'ATK',
    skills:[[1,'Spark','chains to 1 extra target'],
            [4,'Chain Bolt','chains to 3 targets'],
            [8,'Surge','every 5th cast lands double']] },
  { name:'Assassin',  hp: 85, atk:24, spd:20, feeds:'ATK',
    skills:[[1,'Backstab','+40% damage from behind'],
            [4,'Shadowstep','blink behind the target'],
            [8,'Execute','finishes a target below 15% HP']] },
]

// Gold Cash Cat — a separate token from $CASHCATSLLC, and the prized asset.
// Earned from boss chests or bought outright, spent in-game and burned, and
// bound to the player rather than tradeable between them.
const GCC_CA = '0x2f6A90cE9Dcece3215df206B3Ac6fF7368E27acc'
const BOSSES = [
  { name:'Field Boss',   chests:2  },
  { name:'Dungeon Boss', chests:4  },
  { name:'Raid Boss',    chests:7  },
  { name:'World Boss',   chests:15 },
]
const CHEST_RATE = 0.05        // per chest, per the dev
const MATS_COST  = 3           // gold cash cats -> premium crafting materials
const HERB_COST  = 2           // gold cash cats -> rare potion ingredients

const COS_PACK  = 5        // cosmetic rating per pack
const COS_COST  = 20000    // $CASHCATSLLC per pack, burned
const MAX_GEAR  = 5
const MAX_LEVEL = 10
const SHIFTS_PER_LEVEL = 4
const WEAR = 8             // equipment only — cosmetics never wear
const COMBINE_RATE = 5     // 5 scrap -> 1 part, so low grade is never wasted

const s = {
  cat: 0,               // index into CATS — which protagonist you are
  cls: 0,               // index into CLASSES — the cat's class
  owned: [0,0,0,0,0],   // how many of each tier the account holds
  bought: 0,       // cosmetic rating bought directly with tokens
  level: 1,
  shifts: 0,
  gear: 1,
  dur: 100,
  scrap: 0,
  parts: 0,
  spares: 0,
  burned: 0,
  gcc: 0,           // Gold Cash Cats held
  mats: 0,          // premium crafting materials
  herbs: 0,         // rare potion ingredients
  kills: 0,
  chests: 0,
  boss: 0,          // index into BOSSES
}

// caps scale with level: a rating can be bought, but not past what the cat
// has levelled into
const cosCap = () => s.level * 15
const eqpCap = () => s.level * 12

const gearRating  = t => t * 12
const gearReq     = t => t * 2 - 1          // level needed to wear tier t
const CAT = () => CATS[s.cat]
const upgradeCost = t => Math.max(1, 3 * t - (CAT().key === 'catPop' ? 1 : 0))
const repairCost  = () => Math.round((100 - s.dur) * (1 + 0.5*(s.gear-1)) * (CAT().key === 'catSerious' ? 0.8 : 1))
const wearPer     = () => CAT().key === 'catLong' ? 6 : WEAR
const yieldPer    = () => 10 * s.gear

// every NFT held contributes, so tiers stack rather than replace each other
const cosRaw = () => {
  let t = s.bought
  for(let i=1;i<NFT.length;i++) t += s.owned[i] * NFT[i].cos
  return t
}
const nftCount = () => { let n=0; for(let i=1;i<NFT.length;i++) n += s.owned[i]; return n }
const topTier  = () => { for(let i=NFT.length-1;i>=1;i--) if(s.owned[i]) return i; return 0 }
const nextTier = () => { for(let i=1;i<NFT.length;i++) if(!s.owned[i]) return i; return NFT.length-1 }
const cosRate = () => Math.min(cosRaw(), cosCap())
const eqpRate = () => Math.min(gearRating(s.gear), eqpCap())
// class sets the base spread; equipment feeds that class's own stat, and
// cosmetic rating (being account-wide) spreads across all three
const C = () => CLASSES[s.cls]
const statHP  = () => C().hp  + (C().feeds==='HP'  ? eqpRate() : 0) + Math.round(cosRate()*0.5)
const statATK = () => C().atk + (C().feeds==='ATK' ? eqpRate() : 0) + Math.round(cosRate()*0.2)
const statSPD = () => C().spd + (C().feeds==='SPD' ? eqpRate() : 0) + Math.round(cosRate()*0.2)
const power   = () => statHP() + 4*statATK() + 3*statSPD()

// the sandbox has no Intl, so toLocaleString leaves numbers unseparated
const commas = n => {
  const d = String(n), out = []
  for (let i = 0; i < d.length; i++) {
    if (i > 0 && (d.length - i) % 3 === 0) out.push(',')
    out.push(d[i])
  }
  return out.join('')
}

/* =========================== ui helpers =========================== */
function panel(w,h,size,pos,rotY,bg,border){
  const u=app.create('ui')
  u.space='world'; u.width=w; u.height=h; u.size=size
  u.backgroundColor=bg; u.borderColor=border; u.borderWidth=6; u.borderRadius=12
  u.padding=26; u.flexDirection='column'; u.lit=false; u.doubleside=true
  u.position.set(pos[0],pos[1],pos[2]); if(rotY) u.rotation.y=rotY
  app.add(u); return u
}
// the ui text layout soft-wraps and collapses embedded newlines, so every
// line of copy has to be its own node
function text(parent,val,sizePx,color,weight,mt){
  const t=app.create('uitext')
  t.value=val; t.fontSize=sizePx; t.color=color; t.lineHeight=1.35
  if(weight) t.fontWeight=weight
  if(mt) t.margin=[mt,0,0,0]
  parent.add(t); return t
}
// label/value row. the label sits in a fixed-width view so the numbers line
// up in a column even though the font is proportional.
function row(parent,label,sizePx,mt,labelW){
  const v=app.create('uiview')
  v.flexDirection='row'; v.alignItems='center'
  if(mt) v.margin=[mt,0,0,0]
  parent.add(v)
  const lw=app.create('uiview'); lw.width=labelW||270; lw.flexShrink=0; v.add(lw)
  const l=app.create('uitext')
  l.value=label; l.fontSize=sizePx; l.color=DIM
  lw.add(l)
  const r=app.create('uitext')
  r.value=''; r.fontSize=sizePx; r.color=CREAM; r.fontWeight=600; r.flexGrow=1
  v.add(r)
  return r
}
function indented(parent,sizePx,color,mt,indent){
  const t=app.create('uitext')
  t.value=''; t.fontSize=sizePx; t.color=color
  t.margin=[mt||0,0,0,indent||270]
  parent.add(t); return t
}
// three fixed-width cells, for the nft rack
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
function bar(pct,color){
  const filled = Math.max(0, Math.min(10, Math.round(pct/10)))
  let out=''
  for(let i=0;i<10;i++) out += i<filled ? '■ ' : '□ '
  return out
}

/* ===================== board 1: player info =====================
 * The dev asked for Cosmetic and Equipment Ratings to be on the player info
 * tab and visible to everyone, so they are the headline here.
 */
const info = panel(740,880,0.0042,[-3.6,2.6,BACK_Z],0,'#0e1f18',GOLD)
text(info,'PLAYER INFO',46,GOLD_L,700)
text(info,'public — anyone can view this',22,DIM,400,6)
const vCat   = row(info,'Cat',30,20,320)
const nCat   = indented(info,22,DIM,2,320)
const vCls   = row(info,'Class',30,12,320)
const vNft   = row(info,'NFT tier',30,8,320)
const vLvl   = row(info,'Level',30,8,320)
const vCos   = row(info,'Cosmetic Rating',30,16,320)
const nCos   = indented(info,22,DIM,2,320)
const vEqp   = row(info,'Equipment Rating',30,14,320)
const nEqp   = indented(info,22,DIM,2,320)
const vHP    = row(info,'HP',30,16,320)
const vATK   = row(info,'ATK',30,6,320)
const vSPD   = row(info,'SPD',30,6,320)
const vPow   = row(info,'Power',30,14,320)

/* ===================== board 2: the bench ===================== */
const gear = panel(740,800,0.0042,[3.6,2.75,BACK_Z],0,'#0e1f18',GOLD)
text(gear,'EQUIPMENT & MATERIALS',38,GOLD_L,700)
text(gear,'equipment wears. cosmetics never do.',22,DIM,400,6)
const vTier  = row(gear,'Gear tier',30,22,320)
const vDur   = row(gear,'Durability',30,8,320)
const vBar   = indented(gear,30,LIME,2,320)
const vScrap = row(gear,'Scrap',30,14,320)
const vParts = row(gear,'Parts',30,8,320)
const vSpare = row(gear,'Spare loot',30,8,320)
const vGcc   = row(gear,'Gold Cash Cats',30,14,320)
const vMats  = row(gear,'Premium materials',30,8,320)
const vHerbs = row(gear,'Rare ingredients',30,8,320)
const lNext  = text(gear,'',24,DIM,400,18)
const lRep   = text(gear,'',24,DIM,400,4)
const lComb  = text(gear,'',24,DIM,400,4)

/* ===================== board 3: house rules ===================== */
const rules = panel(700,580,0.0038,[LEFT_X,2.85,-2.6],Math.PI/2,PAPER,GOLD)
text(rules,'HOUSE RULES',46,GREEN_D,700)
function rule(n,head,body){
  text(rules,n+'. '+head,28,GREEN_D,700,n===1?22:16)
  text(rules,body,23,INK,400,4)
}
rule(1,'No paid randomness.','Upgrades never roll. Boss chests do — but killing a boss and opening its chests is free, so no roll is ever bought.')
rule(2,'No paid odds.','Nothing you buy changes a drop rate. Money buys the Gold Cash Cat directly, never a better chance at one.')
rule(3,'Equipment and buildings wear out.','Cosmetics never do. Higher tier costs more to repair.')
rule(4,'No blind boxes.','Every trait and price is listed before purchase.')
rule(5,'One-way sink.','The game burns $CASHCATSLLC. It never pays any out.')

/* ===================== board 3b: choose your class =====================
 * Class is per-cat and picked, never rolled. Skills unlock on level, so the
 * same level gate that caps the ratings also paces the abilities.
 */
const cls = panel(700,820,0.0038,[LEFT_X,2.9,2.0],Math.PI/2,'#14100e',GOLD)
text(cls,'CHOOSE YOUR CLASS',42,GOLD_L,700)
text(cls,'each cat is one class · skills unlock by level',22,DIM,400,6)
const ch = row3(cls,[240,250,140],24,20)
ch[0].value='CLASS'; ch[1].value='HP / ATK / SPD'; ch[2].value='GEAR FEEDS'
ch[0].color=DIM; ch[1].color=DIM; ch[2].color=DIM
const clsRows = []
for(let i=0;i<CLASSES.length;i++){
  const c = row3(cls,[240,250,140],28,10)
  c[0].value = CLASSES[i].name
  c[1].value = CLASSES[i].hp + ' / ' + CLASSES[i].atk + ' / ' + CLASSES[i].spd
  c[2].value = CLASSES[i].feeds
  clsRows.push(c)
}
const skHead = text(cls,'',30,GOLD_L,700,24)
const skRows = []
for(let i=0;i<3;i++){
  skRows.push([ text(cls,'',26,CREAM,600,i===0?12:12), text(cls,'',22,DIM,400,2) ])
}

/* ===================== board 3c: choose your cat =====================
 * The cat is the protagonist; the class is the job. Both are picked, never
 * rolled, and both are listed in full before you commit.
 */
const cast = panel(700,760,0.0038,[RIGHT_X,2.85,2.6],-Math.PI/2,'#12100e',GOLD)
text(cast,'WORLD OF CASHCATS',42,GOLD_L,700)
text(cast,'choose your cat · each carries one signature trait',22,DIM,400,6)
const castRows = []
for(let i=0;i<CATS.length;i++){
  const v=app.create('uiview'); v.flexDirection='column'
  v.margin=[i===0?22:14,0,0,0]; cast.add(v)
  const n=app.create('uitext')
  n.value=''; n.fontSize=30; n.color=CREAM; n.fontWeight=600; v.add(n)
  const d=app.create('uitext')
  d.value=CATS[i].trait + ' — ' + CATS[i].desc
  d.fontSize=22; d.color=DIM; d.margin=[2,0,0,0]; v.add(d)
  castRows.push([n,d])
}
text(cast,'The class you pick decides what you do.',22,'#c9bfa6',400,22)
text(cast,'The cat you pick decides what you bring.',22,'#c9bfa6',400,2)

// The chosen cat, sculpted, on a plinth beside their board. The meshes ride
// in on this app's model (roomsrc/cats.glb, built by roomsrc/mkcats.py);
// picking a cat just toggles which node is active.
const STATUE_X = RIGHT_X - 1.05, STATUE_Z = 0.8
prim('box',[1.9,0.32,1.9],'#ffffff',[STATUE_X,FLOOR_Y+0.16,STATUE_Z],{tex:'pavingRoom',rough:0.9})
prim('box',[1.75,0.05,1.75],GOLD,[STATUE_X,FLOOR_Y+0.34,STATUE_Z],{metal:0.8,rough:0.35})

const NODE_OF = {
  catCash:'cat_cash', catLong:'cat_long', catSerious:'cat_serious',
  catApple:'cat_apple', catPop:'cat_pop',
}
const SIZE_OF = { catCash:0.74, catLong:0.60, catSerious:0.70, catApple:0.68, catPop:0.68 }
const statues = {}
for (const c of CATS) {
  const st = app.get(NODE_OF[c.key])
  if (!st) continue
  const sc = SIZE_OF[c.key]
  st.position.set(STATUE_X, FLOOR_Y + 0.36, STATUE_Z)
  st.scale.set(sc, sc, sc)
  st.rotation.y = -Math.PI/2          // turned to face out into the room
  st.active = false
  statues[c.key] = st
}


/* ===================== board 3d: boss drops =====================
 * The Gold Cash Cat is the prized asset and it drops from chests. This is the
 * one place in the game with a real roll in it, so the odds and the chest
 * counts are posted rather than buried.
 */
const boss = panel(700,780,0.0038,[LEFT_X,2.85,-5.6],Math.PI/2,'#1d1410',GOLD)
text(boss,'GOLD CASH CAT',44,GOLD_L,700)
text(boss,'boss drops · ' + Math.round(CHEST_RATE*100) + '% per chest',22,DIM,400,6)
const bh = row3(boss,[260,190,180],24,20)
bh[0].value='BOSS'; bh[1].value='CHESTS'; bh[2].value='EXPECTED'
bh[0].color=DIM; bh[1].color=DIM; bh[2].color=DIM
const bossRows = []
for(let i=0;i<BOSSES.length;i++){
  const c = row3(boss,[260,190,180],28,10)
  c[0].value = BOSSES[i].name
  c[1].value = String(BOSSES[i].chests)
  c[2].value = (BOSSES[i].chests * CHEST_RATE).toFixed(2) + ' per kill'
  bossRows.push(c)
}
text(boss,'Killing a boss and opening its chests costs',23,'#c9bfa6',400,20)
text(boss,'nothing. You never buy a roll.',23,'#c9bfa6',400,2)
text(boss,'Bound to you — Gold Cash Cats cannot be traded',23,'#c9bfa6',400,14)
text(boss,'to another player in-game.',23,'#c9bfa6',400,2)
text(boss,'Or buy the token outright and burn it in-game:',22,DIM,400,14)
text(boss,GCC_CA,19,GOLD_L,600,4)
const lBoss = text(boss,'',24,DIM,400,18)
const lGcc  = text(boss,'',23,DIM,400,6)

/* ===================== board 4: the nft rack ===================== */
const rack = panel(700,660,0.0038,[RIGHT_X,2.95,-1.0],-Math.PI/2,'#1d1a10',GOLD)
text(rack,'CASH CAT NFT TIERS',42,GOLD_L,700)
text(rack,'every trait and price listed up front — no mystery box',22,DIM,400,6)
const hd = row3(rack,[230,240,150],26,22)
hd[0].value='TIER'; hd[1].value='PRICE'; hd[2].value='COSMETIC'
hd[0].color=DIM; hd[1].color=DIM; hd[2].color=DIM
const rackRows = []
for(let i=1;i<NFT.length;i++){
  const c = row3(rack,[230,240,150],30,10)
  c[0].value = NFT[i].name
  c[1].value = commas(NFT[i].price)
  c[2].value = '+' + NFT[i].cos
  rackRows.push(c)
}
text(rack,'Cosmetic Rating is account-wide: every cat you',23,'#c9bfa6',400,20)
text(rack,'own gets it, equipped or not. It never wears out.',23,'#c9bfa6',400,2)
text(rack,'It comes only from NFTs held or $CASHCATSLLC',23,'#c9bfa6',400,10)
text(rack,'spent, and is capped by your level.',23,'#c9bfa6',400,2)

const goldPic = app.create('image')
goldPic.src = props.gold ? props.gold.url : null
goldPic.width = 1.5; goldPic.height = 1.5
goldPic.color = 'transparent'; goldPic.lit = false; goldPic.doubleside = true
goldPic.position.set(RIGHT_X-0.04, 0.95, -3.0)
goldPic.rotation.y = -Math.PI/2
app.add(goldPic)

/* ===================== board 5: the burn ledger ===================== */
const ledger = panel(620,420,0.0042,[-3.4,2.5,FRONT_Z],Math.PI,'#1d1010','#7a3b2a')
text(ledger,'BURN LEDGER',42,'#e08a6a',700)
const vBurn = row(ledger,'Burned this run',30,22,300)
const vShift= row(ledger,'Shifts worked',30,8,300)
text(ledger,'There is no token faucet in this game.',24,'#d8b0a0',400,20)
text(ledger,'Nothing here pays $CASHCATSLLC out.',24,'#d8b0a0',400,2)
text(ledger,'To make money, buy and sell tokens and',22,'#a08078',400,14)
text(ledger,'NFTs the normal way.',22,'#a08078',400,2)

/* ===================== board 6: what is next ===================== */
const next = panel(620,420,0.0042,[3.4,2.5,FRONT_Z],Math.PI,'#12241c',GREEN_D)
text(next,'NEXT BUILD: HOUSING',40,LIME,700)
text(next,'Buy land, build a house, run a farm.',24,CREAM,400,20)
text(next,'Farms yield resources for:',24,CREAM,400,10)
text(next,'  · temporary stat boosts',23,'#a9c4b6',400,6)
text(next,'  · materials for equipment',23,'#a9c4b6',400,2)
text(next,'  · trades with other players',23,'#a9c4b6',400,2)
text(next,'Buildings wear out too.',23,DIM,400,14)

/* =========================== actions =========================== */
function action(label,pos,fn,dist){
  const a=app.create('action')
  a.label=label; a.distance=dist||3.4; a.duration=0.35
  a.position.set(pos[0],pos[1],pos[2])
  a.onTrigger=fn
  app.add(a); return a
}
const BY = FLOOR_Y+1.2

const aWork = action('Work a shift',[-3.6,BY,-2.6],()=>{
  if(s.dur<=0){ lRep.value='Gear is broken — repair before working.'; return }
  s.shifts++
  // Payday lands on a counter, not a roll
  const double = CAT().key === 'catCash' && s.shifts % 5 === 0
  s.scrap += yieldPer() * (double ? 2 : 1)
  s.dur = Math.max(0, s.dur - wearPer())
  // deterministic, not a drop roll: every third shift leaves spare loot
  if(s.shifts % 3 === 0) s.spares++
  if(s.level < MAX_LEVEL && s.shifts % SHIFTS_PER_LEVEL === 0) s.level++
  render()
})

const aRepair = action('Repair gear',[-1.8,BY,-2.6],()=>{
  const c=repairCost()
  if(c===0) return
  if(s.scrap<c){ lRep.value='Repair: '+c+' scrap  (not enough)'; return }
  s.scrap-=c; s.dur=100; render()
})

const aCombine = action('Combine materials',[0,BY,-2.6],()=>{
  if(s.scrap<COMBINE_RATE){ lComb.value='Combine: '+COMBINE_RATE+' scrap -> 1 part  (not enough)'; return }
  s.scrap-=COMBINE_RATE; s.parts++; render()
})

const aUpgrade = action('Upgrade gear',[1.8,BY,-2.6],()=>{
  if(s.gear>=MAX_GEAR) return
  const nt=s.gear+1
  if(s.level<gearReq(nt)){ lNext.value='Tier '+nt+' needs level '+gearReq(nt); return }
  const c=upgradeCost(s.gear)
  if(s.parts<c){ lNext.value='Upgrade: '+c+' parts  (not enough)'; return }
  s.parts-=c; s.gear=nt; render()     // deterministic: never fails
})

const aDismantle = action('Dismantle spare loot',[3.6,BY,-2.6],()=>{
  if(s.spares<=0) return
  s.scrap += Math.round(s.spares * (CAT().key === 'catApple' ? 9 : 6))  // nothing is wasted
  s.spares = 0
  render()
})

const aMint = action('',[RIGHT_X-1.5,BY,-1.0],()=>{
  const t = nextTier()
  s.owned[t]++
  s.burned += NFT[t].price            // demo: the real build burns on-chain
  render()
},3.6)

const aBoss = action('',[LEFT_X+1.4,BY,-5.6],()=>{
  const b = BOSSES[s.boss]
  s.kills++
  // the roll the dev asked for. free to attempt — you are never buying it.
  let got = 0
  for (let i = 0; i < b.chests; i++) {
    s.chests++
    if (Math.random() < CHEST_RATE) got++
  }
  s.gcc += got
  lBoss.value = got
      ? b.name + ' down — ' + got + ' Gold Cash Cat' + (got > 1 ? 's' : '')
      : b.name + ' down — no drop from ' + b.chests + ' chests'
  lBoss.color = got ? GOLD_L : DIM
  s.boss = (s.boss + 1) % BOSSES.length
  render()
},3.6)

const aMats = action('',[2.4,BY,-2.6],()=>{
  if (s.gcc < MATS_COST) { lGcc.value = 'Premium materials: ' + MATS_COST + ' GCC (not enough)'; return }
  s.gcc -= MATS_COST; s.mats++; render()
})

const aHerb = action('',[3.6,BY,-2.6],()=>{
  if (s.gcc < HERB_COST) { lGcc.value = 'Rare ingredients: ' + HERB_COST + ' GCC (not enough)'; return }
  s.gcc -= HERB_COST; s.herbs++; render()
})

const aCat = action('',[RIGHT_X-1.4,BY,2.0],()=>{
  s.cat = (s.cat + 1) % CATS.length     // picked, never rolled
  render()
},3.6)

const aCls = action('',[LEFT_X+1.4,BY,2.0],()=>{
  s.cls = (s.cls + 1) % CLASSES.length     // picked, never rolled
  render()
},3.6)

const aCos = action('',[RIGHT_X-1.5,BY,-3.0],()=>{
  s.bought += COS_PACK
  s.burned += COS_COST
  render()
},3.6)

/* =========================== render =========================== */
function render(){
  const top = topTier(), cnt = nftCount()
  vNft.value = cnt ? NFT[top].name + '   (' + cnt + ' held)' : 'None'
  vNft.color = top===4 ? GOLD_L : (top===0 ? DIM : CREAM)
  vLvl.value = s.level + ' / ' + MAX_LEVEL

  const cr = cosRate(), er = eqpRate()
  vCos.value = cr + ' / ' + cosCap()
  vCos.color = cosRaw() > cosCap() ? GOLD_L : CREAM
  nCos.value = cosRaw() > cosCap()
      ? 'capped — ' + cosRaw() + ' held, level ' + s.level + ' allows ' + cosCap()
      : 'applies to every cat on the account'
  vEqp.value = er + ' / ' + eqpCap()
  nEqp.value = 'this cat only'
  vHP.value  = String(statHP())
  vATK.value = String(statATK())
  vSPD.value = String(statSPD())
  vPow.value = String(power())
  vPow.color = LIME

  vCat.value = CAT().name
  vCat.color = GOLD_L
  nCat.value = CAT().trait + ' — ' + CAT().desc
  for (const c of CATS) {
    if (statues[c.key]) statues[c.key].active = (c.key === CAT().key)
  }
  for(let i=0;i<castRows.length;i++){
    const on = i === s.cat
    castRows[i][0].value = CATS[i].name + (on ? '  ◄' : '')
    castRows[i][0].color = on ? LIME : CREAM
    castRows[i][1].color = on ? '#a9c4b6' : '#5f7168'
  }

  vCls.value = C().name
  vCls.color = GOLD_L
  for(let i=0;i<clsRows.length;i++){
    const on = i === s.cls
    clsRows[i][0].value = CLASSES[i].name + (on ? '  ◄' : '')
    for(let k=0;k<3;k++) clsRows[i][k].color = on ? LIME : (k===0 ? CREAM : DIM)
  }
  skHead.value = 'SKILLS — ' + C().name
  for(let i=0;i<3;i++){
    const [lv,nm,desc] = C().skills[i]
    const on = s.level >= lv
    skRows[i][0].value = 'Lv ' + lv + '   ' + nm + (on ? '' : '   (locked)')
    skRows[i][0].color = on ? LIME : '#5f7168'
    skRows[i][1].value = desc
    skRows[i][1].color = on ? DIM : '#4a5952'
  }

  aCls.label = 'Switch class — ' + CLASSES[(s.cls+1) % CLASSES.length].name + ' (free, no roll)'
  aCat.label = 'Play as ' + CATS[(s.cat+1) % CATS.length].name
  aBoss.label = 'Fight the ' + BOSSES[s.boss].name + ' — ' + BOSSES[s.boss].chests + ' chests, free'
  aMats.label = 'Buy premium materials — ' + MATS_COST + ' Gold Cash Cat'
  aHerb.label = 'Buy rare ingredients — ' + HERB_COST + ' Gold Cash Cat'
  if (!lGcc.value) lGcc.value = 'Spend them on materials, potion ingredients, or the House Vault.'

  vTier.value = s.gear + ' / ' + MAX_GEAR + '   (rating ' + gearRating(s.gear) + ')'
  vDur.value  = s.dur + '%'
  vBar.value  = bar(s.dur)
  vBar.color  = s.dur > 50 ? LIME : (s.dur > 20 ? GOLD_L : RED)
  vScrap.value= String(s.scrap)
  vParts.value= String(s.parts)
  vSpare.value= String(s.spares)
  vGcc.value  = String(s.gcc)
  vGcc.color  = s.gcc ? GOLD_L : CREAM
  vMats.value = String(s.mats)
  vHerbs.value= String(s.herbs)

  if(s.gear>=MAX_GEAR) lNext.value = 'Gear is max tier.'
  else if(s.level<gearReq(s.gear+1)) lNext.value = 'Tier '+(s.gear+1)+' needs level '+gearReq(s.gear+1)
  else lNext.value = 'Upgrade to tier '+(s.gear+1)+': '+upgradeCost(s.gear)+' parts — guaranteed'
  lRep.value  = 'Repair to 100%: ' + repairCost() + ' scrap'
  lComb.value = 'Combine: ' + COMBINE_RATE + ' scrap -> 1 part'

  for(let i=0;i<rackRows.length;i++){
    const n = s.owned[i+1]
    const col = n ? LIME : ((i+1)===4 ? GOLD_L : CREAM)
    rackRows[i][0].value = NFT[i+1].name + (n ? (n>1 ? '  x'+n : '  (held)') : '')
    rackRows[i][0].color = col
    rackRows[i][1].color = n ? LIME : DIM
    rackRows[i][2].color = col
  }

  vBurn.value  = commas(s.burned)
  vBurn.color  = s.burned ? '#e08a6a' : CREAM
  vShift.value = String(s.shifts)

  const nt = nextTier()
  aMint.label = 'Mint ' + NFT[nt].name + ' NFT — ' + commas(NFT[nt].price) + ' $CASHCATSLLC'
  aCos.label = 'Buy +' + COS_PACK + ' Cosmetic Rating — ' + commas(COS_COST) + ' $CASHCATSLLC'
}

render()
