// Drive the real trades.js server through two players and check that goods and
// coin are conserved -- a market that can create or destroy either is worse
// than no market at all.
const fs = require('fs'), path = require('path')
function mk(){const s={};return new Proxy(function(){},{get(t,k){if(k==='then')return undefined;if(k in s)return s[k];if(['add','remove','set','copy','traverse'].includes(k))return()=>{};s[k]=mk();return s[k]},set(t,k,v){s[k]=v;return true},apply(){return mk()}})}
const store = {}, handlers = {}, notes = {}, boards = {}
// The network id and the user id MUST differ here. They used to be the same
// string, which quietly made the harness incapable of catching the one bug this
// area actually had: the market passed a userId to app.sendTo() and
// world.getPlayer(), both of which key on the network id. With A === A that
// looked fine; with real players the seller was never told their goods sold.
const players = {
  nA: { userId:'A', id:'nA', name:'Alice', position:{x:0,y:0,z:0} },
  nB: { userId:'B', id:'nB', name:'Bob',   position:{x:0,y:0,z:0} },
}
const app = {
  create:()=>mk(), add:()=>{}, remove:()=>{},
  on:(k,fn)=>{ handlers[k]=fn }, send:()=>{},
  sendTo:(pid,k,d)=>{
    if(k==='shop'&&d&&d.msg) (notes[pid]=notes[pid]||[]).push(d.msg)
    if(k==='market') boards[pid]=(d&&d.rows)||[]
  },
  configure:()=>{},
}
const world = {
  isServer:true, get:k=>store[k],
  // by reference, exactly like the real Storage.set does now -- so the test
  // sees the live book instead of a snapshot taken at save time
  set:(k,v)=>{ store[k]=v },
  getPlayer:pid=>players[pid]||null, getPlayers:()=>Object.values(players),
  on:()=>{}, load:()=>Promise.resolve(mk()), add:()=>{}, remove:()=>{}, chat:()=>{},
}
const props = new Proxy({},{get:(t,k)=>({url:'a://'+String(k)})})
// Seed BEFORE the app loads: it does `book = world.get(KEY) || {}`, so this
// object becomes the live ledger rather than something copied over it.
store['ccl.ledger.v1'] = {
  A: { name:'Alice', fish:0, catches:{fishPerch:5}, forage:0, kinds:{}, ore:0, best:0,
       filed:0, coin:0, gold:0, rods:1, shovel:0, pick:0, park:0, napAt:0, bait:{}, onLine:null },
  B: { name:'Bob', fish:0, catches:{}, forage:0, kinds:{}, ore:0, best:0,
       filed:0, coin:500, gold:0, rods:1, shovel:0, pick:0, park:0, napAt:0, bait:{}, onLine:null },
}
new Function('world','app','props','Vector3','num','console',
  fs.readFileSync(process.env.TR || path.join(__dirname,'trades.js'),'utf8'))(world,app,props,function(){},a=>a,{log(){},warn(){},error(){}})

const say = (pid)=> (notes[pid]||[]).slice(-1)[0] || ''
const led = () => store['ccl.ledger.v1'] || {}
const mkt = () => store['ccl.market.v1'] || {rows:[]}
const ok = (n,c,e)=>console.log((c?'  ok   ':'  FAIL ')+n+(e!==undefined?'   -> '+e:''))

handlers.hello({}, 'nA'); handlers.hello({}, 'nB')
const totalFish = () => (led().A?.catches?.fishPerch||0) + (led().B?.catches?.fishPerch||0)
                      + mkt().rows.filter(r=>r.key==='fishPerch').reduce((s,r)=>s+r.qty,0)
const totalCoin = () => (led().A?.coin||0) + (led().B?.coin||0)
const f0 = totalFish(), c0 = totalCoin()
console.log('  start: 5 fish, 500 coin in the system\n')

handlers.list({kind:'fish', key:'fishPerch', qty:3, price:50}, 'nA')
ok('listing escrows the goods out of the seller', led().A.catches.fishPerch === 2, 'Alice holds '+led().A.catches.fishPerch)
ok('the row is on the board', mkt().rows.length === 1)
ok('nothing created or destroyed', totalFish() === f0 && totalCoin() === c0)

handlers.list({kind:'fish', key:'fishPerch', qty:9, price:50}, 'nA')
ok('cannot list more than you hold', mkt().rows.length === 1, say('nA'))

handlers.buy_listing({id:1}, 'nA')
ok('cannot buy your own listing', mkt().rows.length === 1, say('nA'))

handlers.buy_listing({id:1}, 'nB')
ok('buyer gets the goods', led().B.catches.fishPerch === 3, 'Bob holds '+(led().B.catches?.fishPerch))
ok('buyer paid', led().B.coin === 350, 'Bob coin '+led().B.coin)
ok('seller credited', led().A.coin === 150, 'Alice coin '+led().A.coin)
ok('listing is gone', mkt().rows.length === 0)
ok('conserved after the trade', totalFish() === f0 && totalCoin() === c0,
   'fish '+totalFish()+'/'+f0+'  coin '+totalCoin()+'/'+c0)

handlers.list({kind:'fish', key:'fishPerch', qty:2, price:400}, 'nA')
handlers.buy_listing({id:2}, 'nB')
ok('refused when the buyer cannot afford it', mkt().rows.length === 1, say('nB'))
handlers.unlist({id:2}, 'nB')
ok('a stranger cannot cancel your listing', mkt().rows.length === 1, say('nB'))
handlers.unlist({id:2}, 'nA')
ok('cancelling returns the escrow', led().A.catches.fishPerch === 2, 'Alice holds '+led().A.catches.fishPerch)
ok('conserved after cancel', totalFish() === f0 && totalCoin() === c0)

// --- the seller has to hear about it, and their ledger has to follow ---
// This is the case the old harness could not see. Alice lists, Bob buys, and
// Alice is a different network id from her user id.
notes.nA = []; boards.nA = []; boards.nB = []
handlers.list({kind:'fish', key:'fishPerch', qty:1, price:60}, 'nA')
ok('the seller sees their own row as theirs',
   boards.nA.length === 1 && boards.nA[0].mine === true, JSON.stringify(boards.nA[0]))
ok('a stranger does not', boards.nB.length === 1 && boards.nB[0].mine === false)
ok('nobody else\'s account id is on the wire', boards.nB[0].by === undefined)
const aCoin = led().A.coin
handlers.buy_listing({id:3}, 'nB')
ok('the seller is told their goods sold', /bought your/.test(say('nA')), say('nA'))
ok('and the coin actually reached them', led().A.coin === aCoin + 60, 'Alice coin '+led().A.coin)
ok('the board cleared for everyone', boards.nA.length === 0 && boards.nB.length === 0)

// The cap needs enough stock to actually reach it -- with 2 fish left, six of
// the eight attempts were refused for stock and the cap was never exercised.
led().A.catches.fishPerch = 20
const f1 = totalFish(), c1 = totalCoin()
for (let i=0;i<9;i++) handlers.list({kind:'fish', key:'fishPerch', qty:1, price:10}, 'nA')
ok('listing cap holds at six', mkt().rows.length === 6, mkt().rows.length+' rows')
ok('the refusal says why', /Six listings/.test(say('nA')), say('nA'))
ok('conserved at the cap', totalFish() === f1 && totalCoin() === c1,
   'fish '+totalFish()+'/'+f1+'  coin '+totalCoin()+'/'+c1)
