// Drive the real trades.js VIP handlers and check the things that would cost
// somebody something if they were wrong: that the tier gate actually refuses,
// that no payout invents or destroys CashCoin, and that the advertised return
// is the return the code pays.
const fs = require('fs'), path = require('path')
function mk(){const s={};return new Proxy(function(){},{get(t,k){if(k==='then')return undefined;if(k in s)return s[k];if(['add','remove','set','copy','traverse'].includes(k))return()=>{};s[k]=mk();return s[k]},set(t,k,v){s[k]=v;return true},apply(){return mk()}})}
const store = {}, handlers = {}, notes = {}
// nV holds 10,000,000 and got 'vip' off the gate; nH is an ordinary holder.
const players = {
  nV: { userId:'V', id:'nV', name:'Vera', tier:'vip',    position:{x:0,y:0,z:0} },
  nH: { userId:'H', id:'nH', name:'Hal',  tier:'holder', position:{x:0,y:0,z:0} },
}
const app = {
  create:()=>mk(), add:()=>{}, remove:()=>{},
  on:(k,fn)=>{ handlers[k]=fn }, send:()=>{},
  sendTo:(pid,k,d)=>{ if((k==='vip'||k==='shop')&&d&&d.msg) (notes[pid]=notes[pid]||[]).push(d.msg) },
  configure:()=>{},
}
const world = {
  isServer:true, get:k=>store[k], set:(k,v)=>{ store[k]=v },
  getPlayer:pid=>players[pid]||null, getPlayers:()=>Object.values(players),
  on:()=>{}, load:()=>Promise.resolve(mk()), add:()=>{}, remove:()=>{}, chat:()=>{},
}
const props = new Proxy({},{get:(t,k)=>({url:'a://'+String(k)})})

const blank = { name:'', fish:0, catches:{}, forage:0, kinds:{}, ore:0, best:0,
  filed:0, coin:0, gold:0, rods:1, shovel:0, pick:0, park:0, napAt:0, bait:{}, onLine:null }
store['ccl.ledger.v1'] = {
  V: Object.assign({}, blank, { name:'Vera', coin:1000000, gold:5, catches:{}, kinds:{} }),
  H: Object.assign({}, blank, { name:'Hal',  coin:1000000, gold:5, catches:{}, kinds:{} }),
}
new Function('world','app','props','Vector3','num','console',
  fs.readFileSync(process.env.TR || path.join(__dirname,'trades.js'),'utf8')
)(world,app,props,function(){},a=>a,{log(){},warn(){},error(){}})

const say = pid => (notes[pid]||[]).slice(-1)[0] || ''
const led = () => store['ccl.ledger.v1']
const book = () => store['ccl.vip.v1'] || {staked:0,paid:0,plays:0,goldIn:0,goldOut:0}
let fails = 0
const ok = (n,c,e)=>{ if(!c) fails++; console.log((c?'  ok   ':'  FAIL ')+n+(e!==undefined?'   -> '+e:'')) }

// The cooldown is real time, so plays have to be spaced. Freeze it instead:
// Date.now is what the handler reads, and marching it forward is both faster
// and more deterministic than sleeping.
let clock = 1e12
const realNow = Date.now
Date.now = () => (clock += 1000)

handlers.hello({}, 'nV'); handlers.hello({}, 'nH')

/* ---- the gate ----
 *
 * Every one of these forces a WINNING roll before checking that nothing moved.
 * Asserting only "the balance did not change" passes whenever the rigged game
 * happens to tie -- which is how the first cut of this reported the gate
 * holding while the gate was commented out.
 */
const realRandom0 = Math.random
const rig = (vals, fn) => {
  let i = 0
  Math.random = () => (i < vals.length ? vals[i++] : vals[vals.length - 1])
  try { return fn() } finally { Math.random = realRandom0 }
}
const WIN2 = [0.9, 0.9, 0.0, 0.0], WIN3 = [0.9, 0.9, 0.9, 0.0, 0.0, 0.0]
let hBefore = led().H.coin
rig(WIN2, () => handlers.vip_dice({s:0}, 'nH'))
ok('an ordinary holder is refused a winning roll at the dice',
   led().H.coin === hBefore, say('nH'))
rig([0.5], () => handlers.vip_wheel({s:0, b:0}, 'nH'))
ok('and a winning spin at the wheel', led().H.coin === hBefore)
const hGold = led().H.gold
rig(WIN3, () => handlers.vip_high({}, 'nH'))
ok('and a winning hand at the high table', led().H.gold === hGold)
ok('and told why', /10,000,000/.test(say('nH')), say('nH'))

/* ---- stakes are always whole coins ---- */
// Roulette's 2x, 3x and 36x cannot produce a fraction at any stake at all.
// 1.9x on the dice is the only multiplier here that can, and it is the whole
// reason the ladder is in twenties.
const STAKES = [40, 200, 1000, 5000, 25000]
let ragged = []
for (const s of STAKES) for (const m of [1.9, 2, 3, 36]) {
  if (Math.abs(s * m - Math.round(s * m)) > 1e-9) ragged.push(s + ' x ' + m)
}
ok('every stake pays a whole number at every multiplier', ragged.length === 0, ragged.join(', '))

/* ---- exact payouts, with the dice loaded ----
 *
 * Statistics cannot own a payout claim. Thirty thousand spins of a 1-in-12 at
 * 11.4x carries a three sigma band of 5.5%, and the difference between paying
 * 11.4x and paying 12x is 5.0% -- so the sampling test passed a wheel that was
 * handing out an extra 60% of a stake on every single-number hit. It is a fine
 * test of whether the wheel is BIASED and no test at all of what it PAYS.
 *
 * So the pocket is chosen here instead of rolled, and the payout is checked to
 * the coin. Math.random is the only entropy the handlers use, and the room
 * script runs in this realm, so handing it a queue makes every outcome exact.
 */
const realRandom = Math.random
const loaded = (vals, fn) => {
  let i = 0
  Math.random = () => (i < vals.length ? vals[i++] : vals[vals.length - 1])
  try { return fn() } finally { Math.random = realRandom }
}
const deltaOf = (vals, fire) => {
  const before = led().V.coin
  loaded(vals, fire)
  return led().V.coin - before
}
// d6 is 1 + floor(r * 6): 0.9 rolls a six, 0.0 rolls a one.
// A pocket is floor(r * 37), so (n + 0.5) / 37 lands squarely in pocket n.
ok('dice: a win pays 1.9x, so 40 returns 76',
   deltaOf([0.9, 0.9, 0.0, 0.0], () => handlers.vip_dice({s:0}, 'nV')) === 36)
ok('dice: a loss costs the stake and no more',
   deltaOf([0.0, 0.0, 0.9, 0.9], () => handlers.vip_dice({s:0}, 'nV')) === -40)
ok('dice: a tie returns the stake untouched',
   deltaOf([0.5, 0.5, 0.5, 0.5], () => handlers.vip_dice({s:0}, 'nV')) === 0)

const pocket = n => (n + 0.5) / 37
ok('wheel: Red on 7 (red) pays 2x',
   deltaOf([pocket(7)], () => handlers.vip_wheel({s:0, b:0}, 'nV')) === 40)
ok('wheel: Black on 7 loses',
   deltaOf([pocket(7)], () => handlers.vip_wheel({s:0, b:1}, 'nV')) === -40)
ok('wheel: Black on 8 (black) pays 2x',
   deltaOf([pocket(8)], () => handlers.vip_wheel({s:0, b:1}, 'nV')) === 40)
ok('wheel: a dozen pays 3x',
   deltaOf([pocket(20)], () => handlers.vip_wheel({s:0, b:3}, 'nV')) === 80)
ok('wheel: the wrong dozen pays nothing',
   deltaOf([pocket(20)], () => handlers.vip_wheel({s:0, b:2}, 'nV')) === -40)
ok('wheel: a straight-up number pays 36x',
   deltaOf([pocket(17)], () => handlers.vip_wheel({s:0, b:5, n:17}, 'nV')) === 1400)
ok('wheel: a number you did not back pays nothing',
   deltaOf([pocket(17)], () => handlers.vip_wheel({s:0, b:5, n:3}, 'nV')) === -40)

/* ---- zero is the entire house edge, so it gets its own block ---- */
ok('zero beats Red', deltaOf([pocket(0)], () => handlers.vip_wheel({s:0, b:0}, 'nV')) === -40)
ok('zero beats Black', deltaOf([pocket(0)], () => handlers.vip_wheel({s:0, b:1}, 'nV')) === -40)
for (let b = 2; b <= 4; b++) {
  ok('zero beats dozen ' + (b - 1),
     deltaOf([pocket(0)], () => handlers.vip_wheel({s:0, b:b}, 'nV')) === -40)
}
ok('but a straight-up on zero pays like any other number',
   deltaOf([pocket(0)], () => handlers.vip_wheel({s:0, b:5, n:0}, 'nV')) === 1400)

const goldOf = (vals, fire) => {
  const before = led().V.gold
  loaded(vals, fire)
  return led().V.gold - before
}
ok('high table: three sixes against three ones wins one gold',
   goldOf([0.9,0.9,0.9, 0.0,0.0,0.0], () => handlers.vip_high({}, 'nV')) === 1)
ok('high table: the other way round loses one',
   goldOf([0.0,0.0,0.0, 0.9,0.9,0.9], () => handlers.vip_high({}, 'nV')) === -1)
ok('high table: a tie is a push',
   goldOf([0.5,0.5,0.5, 0.5,0.5,0.5], () => handlers.vip_high({}, 'nV')) === 0)

/* ---- the dice pit ----
 *
 * The house edge here is exactly computable and worth writing down, because
 * the number is printed on the wall of the room and the wall must not lie.
 * Two dice tie 146/1296 of the time, so a win and a loss are each 0.443675,
 * and at 1.9x the return is 0.443675 x 0.9 - 0.443675 = -0.04437. 4.44%.
 *
 * The empirical band below is three sigma wide and no wider. A single roll has
 * a standard deviation of about 35.8 coin at a stake of 40, so the measured
 * edge over N rolls carries a sigma of 0.895/sqrt(N) -- 0.45% at 40,000. The
 * first cut of this test ran 4,000 rolls and passed at 7.39%, which is 2.1
 * sigma out: a band loose enough to swallow a real payout bug while claiming
 * to check a 4.4% edge.
 */
const DICE_EDGE = 0.0443675
let seen = { win:0, lose:0, push:0 }
let coin0 = led().V.coin, staked0 = 0
let bookBefore = book().staked - book().paid
for (let i = 0; i < 40000; i++) {
  const before = led().V.coin
  handlers.vip_dice({s:0}, 'nV')
  const d = led().V.coin - before
  staked0 += 40
  if (d > 0) seen.win++; else if (d < 0) seen.lose++; else seen.push++
  if (d !== 0 && d !== 36 && d !== -40) { ok('dice paid an impossible amount', false, d); break }
}
ok('the dice pit only ever pays +36, -40 or nothing', true,
   seen.win + ' won, ' + seen.lose + ' lost, ' + seen.push + ' pushed')
// Three sigma, worked out rather than eyeballed. Each roll contributes +1, -1
// or 0 to (wins - losses) with variance 2p = 0.8874, so over N rolls the count
// gap carries a sigma of sqrt(N * 0.8874) -- 188 at forty thousand. A flat
// threshold of 220 was left over from when this loop ran 4,000 rolls; at 40,000
// it is 1.2 sigma and fails roughly one run in four for no reason at all.
const gapSigma = Math.sqrt(40000 * 2 * 0.443675)
ok('wins and losses are near enough even',
   Math.abs(seen.win - seen.lose) < 3 * gapSigma,
   seen.win + ' vs ' + seen.lose + ', 3 sigma = ' + Math.round(3 * gapSigma))
const diceNet = led().V.coin - coin0
const diceEdge = -diceNet / staked0
const diceSigma = 0.895 / Math.sqrt(40000)
ok('the dice edge is the 4.4% printed on the wall',
   Math.abs(diceEdge - DICE_EDGE) < 3 * diceSigma,
   (diceEdge * 100).toFixed(2) + '% vs ' + (DICE_EDGE * 100).toFixed(2) +
   '%, 3 sigma = ' + (3 * diceSigma * 100).toFixed(2) + '%')

// What the room keeps must be exactly what the players lost. Not "about" --
// the house has no ledger of its own to absorb a rounding error into, so any
// gap here is CashCoin the world invented or destroyed.
const bookKept = (book().staked - book().paid) - bookBefore
ok('the book kept exactly what the ledger lost', bookKept === -diceNet,
   'book ' + comma(bookKept) + ' vs ledger ' + comma(-diceNet))

/* ---- the wheel: every bet type must return the same 95% ---- */
const WHEEL_NAME = ['Red', 'Black', '1 to 12', '13 to 24', '25 to 36', 'one number']
// Sigma per spin differs enormously by bet type -- an 18-in-37 at 2x barely
// moves, a 1-in-37 at 36x is mostly noise -- so each band is worked out from
// that bet's own variance rather than one loose range reused three times.
const RTP = 36 / 37
for (const t of [{ b:0, p:2, k:18 }, { b:2, p:3, k:12 }, { b:5, p:36, k:1 }]) {
  const N = 30000
  const q = t.k / 37
  const sigma = Math.sqrt(q * t.p * t.p - RTP * RTP) / Math.sqrt(N)
  const start = led().V.coin
  let put = 0
  for (let i = 0; i < N; i++) { handlers.vip_wheel({s:0, b:t.b, n:7}, 'nV'); put += 40 }
  const back = (led().V.coin - start + put) / put
  // A fairness check, not a payout check -- the exact tests above own that.
  ok('the wheel is not biased on ' + WHEEL_NAME[t.b],
     Math.abs(back - RTP) < 3 * sigma,
     (back * 100).toFixed(2) + '% vs ' + (RTP * 100).toFixed(2) +
     '%, 3 sigma = ' + (3 * sigma * 100).toFixed(2) + '%')
}

/* ---- the wheel cannot be played for free, or for more than you hold ---- */
led().V.coin = 30
handlers.vip_wheel({s:0, b:0}, 'nV')
ok('you cannot stake what you do not hold', led().V.coin === 30, say('nV'))
handlers.vip_dice({s:4}, 'nV')
ok('nor at the top table', led().V.coin === 30, say('nV'))

/* ---- the high table moves exactly one Gold Cash Cat ---- */
led().V.coin = 1000000
led().V.gold = 500
let g = { win:0, lose:0, push:0 }
for (let i = 0; i < 3000; i++) {
  const before = led().V.gold
  if (before < 1) { led().V.gold = 500; continue }
  handlers.vip_high({}, 'nV')
  const d = led().V.gold - before
  if (d === 1) g.win++; else if (d === -1) g.lose++; else if (d === 0) g.push++
  else { ok('the high table moved more than one gold', false, d); break }
}
ok('the high table only ever moves one Gold Cash Cat', true,
   g.win + ' won, ' + g.lose + ' lost, ' + g.push + ' pushed')
ok('and it is an even game', Math.abs(g.win - g.lose) < 200, g.win + ' vs ' + g.lose)

/* ---- the book adds up ---- */
const b = book()
ok('the book counted every hand', b.plays > 20000, b.plays + ' plays')
ok('the book never paid out more than went in', b.paid <= b.staked,
   comma(b.staked - b.paid) + ' kept of ' + comma(b.staked))
ok('gold in and gold out both got counted', b.goldIn > 0 && b.goldOut > 0,
   b.goldIn + ' in, ' + b.goldOut + ' out')

function comma(n){const s=String(Math.floor(n));let o='';for(let i=0;i<s.length;i++){if(i&&(s.length-i)%3===0)o+=',';o+=s[i]}return o}
Date.now = realNow
console.log(fails ? '\n  ' + fails + ' FAILED' : '\n  all clear')
process.exit(fails ? 1 : 0)
