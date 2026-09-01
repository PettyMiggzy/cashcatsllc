/*
 * Play the three trades headlessly and check the ledger actually moved.
 *
 * boot_check.py proves no script crashed. That is not the same as the game
 * working: a fishing spot whose action never fires, or a server handler that
 * silently drops every cast because the reach check is wrong, boots perfectly
 * clean. So drive the real action nodes the way a player does — find them in
 * world.actions.nodes and trigger them — then read the server's own storage
 * file and see whether anything was filed.
 *
 *   node roomsrc/play_test.mjs
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const url = process.env.WORLD_URL || 'http://localhost:3000'
const LEDGER = path.resolve('world/storage.json')

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 800, height: 450 } })
const errs = []
// A dropped socket is not a failing game. Four runs in this build reported
// FAIL because the server was restarted underneath them, and a test that
// cannot tell "broken" from "unplugged" will eventually make the opposite
// mistake and call a real failure a blip.
let disconnected = false
page.on('console', m => {
  const t = m.text()
  if (/WebSocket is already in (CLOSING|CLOSED)|disconnected|ERR_CONNECTION_(RESET|REFUSED)/i.test(t)) disconnected = true
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

// the actions the app registered, by label, nearest first
const actions = () => page.evaluate(() => {
  const p = window.world.rig.position
  return (window.world.actions?.nodes || []).map(n => ({
    label: n._label,
    d: Math.hypot(n.worldPos.x - p.x, n.worldPos.z - p.z),
  })).sort((a, b) => a.d - b.d).slice(0, 6)
})
// Fire the NEAREST action with this label, not the first one found. There are
// three jetties and three actions all labelled 'Cast'; firing the first one
// casts at a jetty you are not standing on, the server's reach check rejects
// it, and the test sits there waiting for a bite that is never coming.
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

const readLedger = () => {
  try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8'))['ccl.ledger.v1'] || {} }
  catch { return {} }
}
const totals = () => {
  const b = readLedger()
  let f = 0, g = 0, o = 0, t = 0
  for (const k in b) { f += b[k].fish; g += b[k].forage; o += b[k].ore; t += b[k].filed }
  return { f, g, o, t }
}

const before = totals()
const results = []

/* ---------------- fishing ---------------- */
await go(-47, 64)                       // the Long Jetty head
await ticks(40)
const near = await actions()
results.push(['actions at the Long Jetty', near.map(a => a.label + '@' + a.d.toFixed(1)).join(', ')])

let caught = 0, missed = 0
for (let round = 0; round < 6; round++) {
  if (!(await fire('Cast'))) { results.push(['cast', 'NO Cast ACTION FOUND']); break }
  // wait for the bite (server rolls 1.4-4.8s), then strike inside the window
  let bit = false
  for (let i = 0; i < 220 && !bit; i++) {
    await step()
    bit = await page.evaluate(() =>
      !!(window.world.actions?.nodes || []).find(n => n._label === 'STRIKE!'))
  }
  if (!bit) { missed++; continue }
  await fire('STRIKE!')
  await ticks(20)
  caught++
}
results.push(['fishing', caught + ' struck, ' + missed + ' never bit'])

/* ---------------- foraging ---------------- */
await go(47 + Math.cos(0.31) * 7.5, 52 + Math.sin(0.31) * 7.5)
await ticks(40)
const gLabels = (await actions()).filter(a => a.label.startsWith('Gather'))
results.push(['gather actions in reach', gLabels.map(a => a.label).join(', ') || 'NONE'])
let gathered = 0
for (const a of gLabels.slice(0, 3)) { if (await fire(a.label)) { gathered++; await ticks(12) } }

/* ---------------- mining ---------------- */
await go(47 - 10, -27 - 11.4 + 3)
await ticks(40)
const mLabels = (await actions()).filter(a => a.label.startsWith('Mine'))
results.push(['mine actions in reach', mLabels.map(a => a.label).join(', ') || 'NONE'])
if (mLabels.length) for (let i = 0; i < 10; i++) { await fire(mLabels[0].label); await ticks(8) }

await ticks(150)                        // let the server's throttled save land
const after = totals()

console.log('\n--- what happened ---')
for (const [k, v] of results) console.log('  %s: %s', k, v)
console.log('\n--- the ledger ---')
console.log('  fish   %d -> %d', before.f, after.f)
console.log('  forage %d -> %d', before.g, after.g)
console.log('  ore    %d -> %d', before.o, after.o)
console.log('  filed  %d -> %d', before.t, after.t)

const fails = []
if (after.f <= before.f) fails.push('no fish were filed')
if (after.g <= before.g) fails.push('no forage was filed')
if (after.o <= before.o && !mLabels.length) fails.push('no mine actions existed')
if (errs.length) console.log('\npage errors:\n  ' + [...new Set(errs)].slice(0, 8).join('\n  '))

const alive = await page.evaluate(() => !!window.world?.network?.socket &&
  window.world.network.socket.readyState === 1).catch(() => false)
await browser.close()

if (disconnected || !alive) {
  console.log('\nINCONCLUSIVE: the client lost its connection during the run.')
  console.log('  Nothing was proved either way. Re-run with the server left alone —')
  console.log('  installing a room rewrites world/db.sqlite underneath a live server.')
  process.exit(2)
}
if (fails.length) { console.log('\nFAIL: ' + fails.join('; ')); process.exit(1) }
console.log('\nOK: all three trades filed to the ledger')
