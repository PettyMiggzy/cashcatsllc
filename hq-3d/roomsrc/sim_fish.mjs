/*
 * Measure the catch table instead of trusting it.
 *
 * The rates painted on the board at the Docks are a promise, and the first
 * version of the roll broke that promise in a way no amount of reading the
 * code would have shown: bait weighting dragged the Gold Cash Cat with it, so
 * the advertised flat 0.5% was really 0.15% on a worm and 1.95% on a lure.
 * The second version fixed the rate and left one bait doing literally nothing,
 * because it drew a tier that is rolled before the weighted table is reached.
 *
 * Both were found here, by running six hundred thousand casts and looking at
 * the numbers. Run it after any change to FISH, BAITS or rollFish.
 *
 *   node roomsrc/sim_fish.mjs
 */
import fs from 'fs'
const src = fs.readFileSync('roomsrc/trades.js','utf8')
const between = (a,b) => { const i = src.indexOf(a), j = src.indexOf(b, i); return src.slice(i,j) }
const decls = between('const COMMON = 0','/*\n * Baits all cost')
            + between('const BAIT_DRAW = 4.0','const baitDraws')
            + 'const BIG_BONUS = ' + /const BIG_BONUS = ([\d.]+)/.exec(src)[1] + '\n'
const body  = between('  const GOLD_CAT = FISH.filter','  const casts = {}')
const sim = new Function(decls + `
  const num=(a,b)=>a+Math.random()*(b-a)
` + 'const baitDraws=(b,f)=>!!b&&b.draws.indexOf(f.key)!==-1\n' + body + `
  return { FISH, BAITS, RARITY, rollFish }`)()
const { FISH, BAITS, RARITY, rollFish } = sim
const N = 600000
const run = (label, tier, bait) => {
  const c = {}
  for (let i=0;i<N;i++){ const f = rollFish(tier,bait); c[f.name]=(c[f.name]||0)+1 }
  console.log('  '+label.padEnd(23)+FISH.filter(f=>c[f.name])
    .map(f=>f.name.replace('GOLD CASH CAT','GOLD')+' '+(100*c[f.name]/N).toFixed(2)+'%').join('  '))
}
console.log('posted: '+FISH.map(f=>f.name.replace('GOLD CASH CAT','GOLD')+' '+f.w+'%').join(', ')+'\n')
console.log('rolled, '+(N/1000)+'k casts each:')
run('wood, bare line',0,null)
run('wood + worm',0,BAITS[0])
run('silver + worm',1,BAITS[0])
run('silver + lure',1,BAITS[3])
run('gold + lure',2,BAITS[3])
run('gold + minnow',2,BAITS[2])
run('gold, bare line',2,null)
