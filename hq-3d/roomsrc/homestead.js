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
// The server owns every number on this panel and persists them under
// ccl.house.v1; the client sends intents and draws what comes back. See the
// isServer block above render().
const isServer = world.isServer
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
  prim('box',[w,upper,d],'#cfc6b2',[pos[0],WAINSCOT+upper/2,pos[2]],{tex:'plaster',rough:0.95})
  prim('box',[w,WAINSCOT,d],'#b9ad93',[pos[0],WAINSCOT/2,pos[2]],{tex:'wainscot',rough:0.6})
  prim('box',[w>d?w:w+0.04,0.07,w>d?d+0.04:d],GOLD,[pos[0],WAINSCOT+0.035,pos[2]],{metal:0.85,rough:0.3})
}

/* shell — open beam roof, because sealed rooms render black with no lights */
prim('box',[W,0.3,D],'#c4bda9',[0,FLOOR_Y-0.15,0],{tex:'pavingRoom',rough:0.9})
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
const REPAIR_RATE = 1.4     // produce per durability point (farm only, now)

/*
 * UPKEEP — from the dev, verbatim:
 *
 *   Once you build your house on the land you purchased, there will be
 *   upkeep. If your house maintenance falls below 80%, the Chibi Rating and
 *   the time to yield crops will have a 5% debuff, meaning the CashCats'
 *   stats will be lowered and it will take 5% longer to yield crops.
 *
 *   To upkeep, you either pay with Gold Cash Cat (the items, not the contract
 *   token) or directly with CashCats LLC.
 *
 * Two things worth being exact about.
 *
 * The line is a cliff, not a slope. At 80% you are fine and at 79% you are
 * not; the spec gives one threshold and one figure, so this gives one
 * threshold and one figure rather than inventing a curve he did not ask for.
 *
 * "Gold Cash Cat (the items, not the contract token)" matters. The Gold Cash
 * Cat is the ultra-rare thing you fish out of the lake — an item you own.
 * $CASHCATSLLC is the contract. They are different, they are easy to confuse,
 * and the parenthesis exists because he expected them to be confused. So the
 * two upkeep routes here are: spend one held item, or burn tokens. House
 * repair no longer takes produce — the spec says "either... or", which is a
 * closed list, and produce is not on it.
 */
const UPKEEP_LINE   = 80    // maintenance % — below this the debuff bites
const UPKEEP_DEBUFF = 0.05  // 5%, on Chibi Rating and on time-to-yield
const UPKEEP_GCC    = 1     // Gold Cash Cat items for a full restore
const UPKEEP_TOKENS = 40000 // ...or pay in $CASHCATSLLC
const HARVEST_MS    = 20000 // base time to yield. the debuff lengthens this
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
  // Mirror only. The server fills every field in here; nothing on the client
  // is a source of truth any more. This used to start at 3, which handed a
  // free 3 Gold Cash Cats to anyone who reloaded the page.
  gcc: 0,        // Gold Cash Cats on hand, fished at the Docks
  vault: 0,      // ...and how many are stacked in the House Vault
  level: 6,      // the cat's level, which caps what the vault can give
  readyAt: 0,    // when the crop is next ready — the debuff pushes this out
}

const beds      = () => s.plot < 0 ? 0 : PLOTS[s.plot].beds
const vaultMult = () => 1 + VAULT_YIELD * s.vault
const vaultCos  = () => Math.min(VAULT_COS * s.vault, s.level * 5)   // level caps it
const yieldPer  = () => s.house ? Math.round(beds() * YIELD_PER_BED * vaultMult()) : 0
const repairCost= (dur) => Math.round((100 - dur) * REPAIR_RATE)
// One predicate, used by everything that cares. Reading `s.houseDur < 80` in
// four places is how a threshold ends up being 80 in three of them.
/*
 * Telling the rest of the world about this house.
 *
 * The debuff crosses an app boundary: the Chibi Rating lives in pets.js and
 * the house lives here, so pets.js reads `ccl.house.v1` out of shared server
 * storage. The contract it reads is exactly two fields, `house` and `cond`,
 * and nothing below may rename them.
 *
 * THE SERVER OWNS ALL OF THIS. It used to be client-local: the panel kept its
 * own numbers, handed itself three Gold Cash Cats on every page load, and
 * published whatever condition it liked -- so the 80% debuff was opt-in, the
 * land gate was a boolean anyone could set, and a reload wiped the lot. Now
 * the client sends intents and draws what comes back; every rule below runs
 * once, on the server, against a record that persists.
 *
 * Gold Cash Cats are READ from the trades ledger and never written there.
 * They are fished out of the lake, which is trades.js's business, and two apps
 * writing one storage key clobber each other -- each holds its own copy and
 * saves on its own clock. So this counts what it has spent in its own record
 * and subtracts. Same shape pets.js uses for chests, and for the same reason.
 */
const upkeepBad = () => s.house && s.houseDur < UPKEEP_LINE
const yieldMs   = () => Math.round(HARVEST_MS * (upkeepBad() ? 1 + UPKEEP_DEBUFF : 1))

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
const lNote  = text(hold,'',24,GOLD_L,700,10)   // what the server said about the last thing you pressed
const lUpkeep= text(hold,'',24,DIM,400,10)

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
prim('box',[9,0.12,4.2],'#a08d70',[0,FLOOR_Y+0.06,1.6],{tex:'soil',rough:1.0})
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
housePart(prim('box',[3.4,2.2,3.0],'#b79a72',[-4.6,FLOOR_Y+1.1,3.4],{tex:'wood',rough:0.8}))
housePart(prim('box',[3.8,0.28,3.4],'#b79a72',[-4.6,FLOOR_Y+2.3,3.4],{tex:'wood',rough:0.7}))
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

const send = (what, note) => {
  if (note) lastNote = note
  app.send('home', { do: what })
}

const aBuy   = action('', [LEFT_X+1.5, BY, -1.0], () => send('plot'),   3.2)
const aVault = action('', [RIGHT_X-1.5, BY, -4.4], () => send('vault'), 3.2)
const aBuild = action('', [-4.6, BY, 5.6], () => send('build'))
const aHarvest = action('Work the farm', [0, BY, -0.6], () => send('harvest'))
const aMill  = action('Mill produce into timber', [3.2, BY, -0.6], () => send('mill'))

/* the two upkeep routes, and only these two */
const aFixH  = action('Upkeep: pay a Gold Cash Cat', [-3.2, BY, -0.6], () => send('upkeepGold'))
const aFixH2 = action('Upkeep: pay in $CASHCATSLLC', [-3.2, BY, -2.2], () => send('upkeepToken'))
const aFixF  = action('Repair the farm', [1.6, BY, -0.6], () => send('repairFarm'))
const aTimber = action('', [RIGHT_X-1.5, BY, -3.4], () => send('timber'), 3.2)
const aBoost  = action('', [RIGHT_X-1.5, BY, -1.0], () => send('boost'),  3.2)

/* ---- the seam: condition out to shared storage, for the Chibi debuff ---- */

let lastNote = ''

if(!isServer){
  app.on('home', d => {
    if(!d) return
    if(d.s) for(const k in d.s) s[k] = d.s[k]
    if(d.msg) lastNote = d.msg
    render()
  })
  app.send('home', { do: 'hello' })
}

if(isServer){
  const KEY = 'ccl.house.v1'
  const LEDGER = 'ccl.ledger.v1'
  let book = null
  const load = () => { if(!book) book = world.get(KEY) || {}; return book }
  // Saved on every write rather than on a timer. These are clicks on a panel,
  // not a tick -- there is no volume here to throttle, and losing a house
  // someone just built to an unlucky restart is not a trade worth making.
  const save = () => { world.set(KEY, load()) }

  // Gold Cash Cats held, straight off the trades ledger, less whatever this
  // homestead has already spent. Read only -- see the note above this block.
  const goldHeld = uid => {
    const L = (world.get(LEDGER) || {})[uid]
    const earned = L && typeof L.gold === 'number' ? L.gold : 0
    return Math.max(0, earned - (rec(uid).goldSpent || 0))
  }

  const BLANK = {
    plot: -1, house: false, cond: 100, farm: 100, produce: 0, timber: 0,
    harvests: 0, boosts: 0, burned: 0, vault: 0, goldSpent: 0, level: 6,
    readyAt: 0,
  }
  function rec(uid){
    const b = load()
    if(!b[uid]) b[uid] = {}
    const r = b[uid]
    for(const k in BLANK) if(r[k] === undefined || r[k] === null) r[k] = BLANK[k]
    return r
  }

  // The same derived numbers the client used to compute for itself. They live
  // here now so the client cannot disagree with them.
  const rBeds  = r => r.plot < 0 ? 0 : PLOTS[r.plot].beds
  const rMult  = r => 1 + VAULT_YIELD * r.vault
  const rYield = r => r.house ? Math.round(rBeds(r) * YIELD_PER_BED * rMult(r)) : 0
  const rBad   = r => r.house && r.cond < UPKEEP_LINE
  const rMs    = r => Math.round(HARVEST_MS * (rBad(r) ? 1 + UPKEEP_DEBUFF : 1))
  const rFarmCost = r => Math.round((100 - r.farm) * REPAIR_RATE)

  const push = (pid, uid, msg) => {
    const r = rec(uid)
    app.sendTo(pid, 'home', {
      msg: msg || '',
      s: {
        plot: r.plot, house: r.house, houseDur: r.cond, farmDur: r.farm,
        produce: r.produce, timber: r.timber, harvests: r.harvests,
        boosts: r.boosts, burned: r.burned, vault: r.vault, level: r.level,
        readyAt: r.readyAt, gcc: goldHeld(uid),
      },
    })
  }

  app.on('home', (d, pid) => {
    const p = world.getPlayer(pid); if(!p) return
    const uid = p.userId || p.id
    const r = rec(uid)
    const what = d && d.do
    let msg = ''
    let wrote = false

    if(what === 'plot'){
      const next = r.plot + 1
      if(next >= PLOTS.length) msg = 'You already hold the largest plot.'
      else if(r.vault < PLOT_GCC[next])
        msg = PLOTS[next].name + ' needs ' + PLOT_GCC[next] + ' vaulted (have ' + r.vault + ')'
      else { r.burned += PLOTS[next].price; r.plot = next; wrote = true }

    } else if(what === 'vault'){
      if(goldHeld(uid) <= 0) msg = 'No Gold Cash Cat to vault. They are fished at the Docks.'
      else { r.goldSpent++; r.vault++; wrote = true }

    } else if(what === 'build'){
      if(r.plot < 0) msg = 'Buy a plot before building.'
      else if(r.house) msg = 'The house is already up.'
      else if(r.timber < HOUSE_COST) msg = 'Raise a house: ' + HOUSE_COST + ' timber (you have ' + r.timber + ')'
      else { r.timber -= HOUSE_COST; r.house = true; wrote = true }

    } else if(what === 'harvest'){
      const t = Date.now()
      if(!r.house) msg = 'Raise a house before the farm produces.'
      else if(r.cond <= 0 || r.farm <= 0) msg = 'Repair before harvesting.'
      else if(t < r.readyAt)
        msg = 'Not ready — ' + Math.ceil((r.readyAt - t)/1000) + 's to go' +
              (rBad(r) ? '  (+5%: house below ' + UPKEEP_LINE + '%)' : '')
      else {
        r.readyAt = t + rMs(r)
        r.produce += rYield(r)
        r.cond = Math.max(0, r.cond - HOUSE_WEAR)
        r.farm = Math.max(0, r.farm - FARM_WEAR)
        r.harvests++
        wrote = true
      }

    } else if(what === 'mill'){
      if(r.produce < TIMBER_RATE) msg = 'Mill: ' + TIMBER_RATE + ' produce -> 1 timber (you have ' + r.produce + ')'
      else { r.produce -= TIMBER_RATE; r.timber++; wrote = true }

    } else if(what === 'upkeepGold'){
      if(!r.house) msg = 'No house to maintain.'
      else if(r.cond >= 100) msg = 'The house is already at 100%.'
      else if(goldHeld(uid) < UPKEEP_GCC)
        msg = 'Upkeep: ' + UPKEEP_GCC + ' Gold Cash Cat (you hold ' + goldHeld(uid) + ')'
      else { r.goldSpent += UPKEEP_GCC; r.cond = 100; wrote = true }

    } else if(what === 'upkeepToken'){
      if(!r.house) msg = 'No house to maintain.'
      else if(r.cond >= 100) msg = 'The house is already at 100%.'
      // demo build: the burn is counted, nothing is minted and no wallet is
      // connected. The Premium Shop the dev described runs on this same rail.
      else { r.burned += UPKEEP_TOKENS; r.cond = 100; wrote = true }

    } else if(what === 'repairFarm'){
      const c = rFarmCost(r)
      if(c === 0) msg = 'The farm is in good order.'
      else if(r.produce < c) msg = 'Repair farm: ' + c + ' produce (you have ' + r.produce + ')'
      else { r.produce -= c; r.farm = 100; wrote = true }

    } else if(what === 'timber'){
      r.timber += TIMBER_LOT; r.burned += TIMBER_PRICE; wrote = true

    } else if(what === 'boost'){
      if(r.produce < BOOST_COST) msg = 'Boost: ' + BOOST_COST + ' produce (you have ' + r.produce + ')'
      else { r.produce -= BOOST_COST; r.boosts++; wrote = true }
    }

    if(wrote){ r.at = Date.now(); save() }
    push(pid, uid, msg)
  })

  world.on('leave', () => { if(book) save() })
}

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
  lRepH.value  = s.houseDur >= 100
      ? 'House fully maintained.'
      : ('Upkeep: ' + UPKEEP_GCC + ' Gold Cash Cat, or ' +
         commas(UPKEEP_TOKENS) + ' $CASHCATSLLC')
  lRepF.value  = 'Repair farm: '  + repairCost(s.farmDur)  + ' produce'
  lNote.value  = lastNote
  // the debuff, named and costed, on the line it applies to
  lUpkeep.value = upkeepBad()
      ? ('BELOW ' + UPKEEP_LINE + '% — Chibi Rating -5%, crops take 5% longer (' +
         (yieldMs()/1000).toFixed(1) + 's)')
      : ('Above ' + UPKEEP_LINE + '% — no debuff. Crops yield every ' +
         (yieldMs()/1000).toFixed(1) + 's.')
  lUpkeep.color = upkeepBad() ? RED : DIM

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
      : 'No Gold Cash Cats — fish one out of the lake at the Docks'

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

/* the deed office: a desk to sign at, and the yield stacked against the wall */
ob('desk',    [-4.6, 0, -3.4],  Math.PI, 1.05)
ob('chair',   [-4.6, 0, -2.3],  0,       1.05)
ob('shelf',   [ 6.6, 0, -1.0],  Math.PI / 2, 2.1)
ob('cabinet', [ 6.6, 0,  2.0],  Math.PI / 2, 2.0)
ob('sack',    [ 4.8, 0,  4.4],  0.3,     0.85)
ob('sack',    [ 5.6, 0,  4.0], -0.7,     0.85)
ob('sack',    [ 5.1, 0,  3.3],  1.4,     0.85)
ob('barrel',  [-6.2, 0,  3.8],  0.2,     1.05)
ob('crate',   [-5.1, 0,  4.4], -0.5,     1.0)
ob('planter', [ 0.0, 0,  4.9],  0,       1.0)
ob('lantern', [-4.6, 1.1, -3.4], 0.4,    0.4)
