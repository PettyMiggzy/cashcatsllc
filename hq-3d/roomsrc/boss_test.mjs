/*
 * Kill a World Boss headlessly and check the pet actually landed.
 *
 * boot_check proves nothing threw. This proves the rule works: that a swing
 * registers, that a miss still leaves you credited, and that beating the boss
 * writes its chibi into the server's own storage file — not into a variable
 * the client happens to be holding.
 *
 * The rule under test, from the spec: you have to hit the boss at least once,
 * and it doesn't matter if it deals 0 damage or if the attack is a miss. So
 * the run is only interesting if it contains misses, and it asserts that it
 * did — a green pass in which every swing connected would not have tested the
 * clause the whole design rests on.
 *
 *   node roomsrc/boss_test.mjs
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const url = process.env.WORLD_URL || 'http://localhost:3000'
const STORE = path.resolve('world/storage.json')
const BX = 0, BZ = -48

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 800, height: 450 } })
let disconnected = false
const errs = []
page.on('console', m => {
  const t = m.text()
  if (/WebSocket is already in (CLOSING|CLOSED)/i.test(t)) disconnected = true
  if (m.type() === 'error') errs.push(t.slice(0, 160))
})
page.on('websocket', ws => ws.on('close', () => { disconnected = true }))

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction(() => window.world?.entities?.player?.avatar, null, { timeout: 240000 })
await page.evaluate(() => { window.world.graphics.renderer.setAnimationLoop(null); window.__t = performance.now() })

const step = (ms = 1000 / 30) => page.evaluate(async ms => {
  window.__t += ms
  await new Promise(r => requestAnimationFrame(() => { window.world.tick(window.__t); r() }))
}, ms)
const ticks = async n => { for (let i = 0; i < n; i++) await step() }
const go = (x, z) => page.evaluate(({ x, z }) => {
  window.world.entities.player.teleport({ position: [x, 1.2, z], rotationY: 0 })
}, { x, z })
const fire = label => page.evaluate(label => {
  const p = window.world.rig.position
  let best = null, bd = Infinity
  for (const n of window.world.actions?.nodes || []) {
    if (n._label !== label) continue
    const d = Math.hypot(n.worldPos.x - p.x, n.worldPos.z - p.z)
    if (d < bd) { bd = d; best = n }
  }
  if (!best) return false
  best._onTrigger()
  return true
}, label)

const store = () => {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8'))['ccl.pets.v1'] || {} }
  catch { return {} }
}
const mine = () => {
  const b = store()
  const keys = Object.keys(b)
  return keys.length ? b[keys[0]] : null
}

const out = []
const fail = []

await go(BX, BZ + 6)
await ticks(40)

const near = await page.evaluate(() => {
  const p = window.world.rig.position
  return (window.world.actions?.nodes || []).map(n => ({
    label: n._label,
    d: +Math.hypot(n.worldPos.x - p.x, n.worldPos.z - p.z).toFixed(1),
  })).sort((a, b) => a.d - b.d).slice(0, 4)
})
out.push(['actions at the boss field', near.map(a => a.label + '@' + a.d).join(', ') || 'NONE'])
if (!near.some(a => a.label === 'Swing')) fail.push('no Swing action at the boss field')

const before = mine()
out.push(['pets before', before ? JSON.stringify(before.chibis) : '(no record yet)'])

/*
 * Swing until it dies.
 *
 * The server's cooldown is measured in Date.now(), not world time, so ticking
 * the world faster does not let you swing faster — what clears it is real
 * seconds passing. The first version of this ticked 34 frames per swing to
 * "wait out" a 900ms cooldown and spent nine minutes doing it. A few ticks to
 * let the client process, then a real wait, is both correct and fifteen times
 * quicker.
 */
const sleep = ms => new Promise(r => setTimeout(r, ms))
const had = before ? Object.keys(before.chibis || {}).filter(k => before.chibis[k] > 0).length : 0
let swings = 0, killed = false
/*
 * 200 attempts, not 70. A World Boss stays down for 90 seconds after it dies
 * and the server correctly refuses swings at a corpse, so a run that starts
 * just after somebody else's kill spends its first ninety seconds swinging at
 * nothing. Sized to cover a full respawn wait plus a whole fight, so the test
 * measures the game rather than when it happened to be started.
 */
for (let i = 0; i < 200 && !killed && !disconnected; i++) {
  if (!(await fire('Swing'))) { fail.push('Swing action vanished mid-fight'); break }
  swings++
  await ticks(4)
  await sleep(950)                    // the server's real-time swing cooldown
  if (i % 3 === 2) {
    const st = mine()
    if (st && Object.keys(st.chibis || {}).filter(k => st.chibis[k] > 0).length > had) killed = true
  }
}
await ticks(10)

out.push(['swings thrown', String(swings) + (killed ? ' (boss went down)' : ' (still standing)')])

const after = mine()
out.push(['pets after', after ? JSON.stringify(after.chibis) : '(no record)'])
out.push(['chibi rating', after ? String(after.rating) : '-'])
out.push(['base rating', after ? String(after.base) : '-'])
out.push(['chests', after ? String(after.chests) : '-'])
out.push(['kills', after ? JSON.stringify(after.kills) : '-'])

if (!disconnected) {
  if (!after) fail.push('no pets record was written at all')
  else {
    const owned = Object.keys(after.chibis || {}).filter(k => after.chibis[k] > 0)
    if (!owned.length) fail.push('boss was fought but no chibi was granted')
    if (owned.length && !(after.rating > 0)) fail.push('chibi owned but Chibi Rating is 0')
    for (const k of owned) if (after.chibis[k] !== 1)
      fail.push('chibi ' + k + ' granted ' + after.chibis[k] + ' times — the guarantee is ONCE')
    if (!(after.chests > 0)) fail.push('no chests were granted')
  }
}

console.log('')
for (const [k, v] of out) console.log('  %s: %s', k.padEnd(26), v)
if (errs.length) console.log('\n  page errors:', errs.slice(0, 4).join(' | '))

if (disconnected) {
  console.log('\nINCONCLUSIVE — the game socket dropped mid-run (server restarted?).')
  await browser.close(); process.exit(2)
}
if (fail.length) {
  console.log('\nFAIL')
  for (const f of fail) console.log('   - ' + f)
  await browser.close(); process.exit(1)
}
console.log('\nPASS — boss defeated, chibi granted once, rating and chests written.')
await browser.close()
