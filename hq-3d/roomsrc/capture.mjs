/*
 * Screenshot the running world.
 *
 * The software renderer manages about 2.5 frames a second, which is far too
 * slow to hold a key down for: an action that wants a third of a second of
 * input never fires. So stop the render loop and drive world.tick() from a
 * clock we control. The tick has to happen *inside* a requestAnimationFrame
 * and we have to wait for the next one before shooting, or the compositor
 * never presents a frame and page.screenshot() hangs forever.
 *
 *   node roomsrc/capture.mjs out.png [--walk] [--seconds 3] [--cam 0,1.6,4]
 */
import { chromium } from 'playwright'
import path from 'path'

const args = process.argv.slice(2)
const out = args[0] || 'shot.png'
const flag = (n, d) => {
  const i = args.indexOf('--' + n)
  return i === -1 ? d : args[i + 1]
}
const walk = args.includes('--walk')
const zoom = parseFloat(flag('zoom', '0'))
const orbit = parseFloat(flag('orbit', '0'))   // degrees to swing the camera round
const seconds = parseFloat(flag('seconds', 2.5))
const url = flag('url', 'http://localhost:3000')

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('console', m => { if (m.type() === 'error') console.log('  page error:', m.text()) })

await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 })

// wait for the local player's avatar to actually exist
await page.waitForFunction(() => {
  const w = window.world
  return w && w.entities?.player?.avatar
}, null, { timeout: 180000 })

// take the clock off the renderer and onto us
await page.evaluate(({ zoom, orbit }) => {
  const w = window.world
  w.graphics.renderer.setAnimationLoop(null)
  window.__t = performance.now()
  // The default camera sits close behind the shoulder, which is no use for
  // looking at the avatar. Pull it back, and swing it round to see the front.
  const p = w.entities.player
  if (zoom) p.cam.zoom = zoom
  if (orbit) p.cam.rotation.y += orbit * Math.PI / 180
}, { zoom, orbit })

// Drive input as real key events. The engine reads its own control state
// each tick, so holding a key down across our manual ticks is enough — and
// unlike poking at internals it goes through the same path a player does.
const step = async ms => {
  await page.evaluate(async ms => {
    const w = window.world
    window.__t += ms
    await new Promise(r => requestAnimationFrame(() => { w.tick(window.__t); r() }))
  }, ms)
}

await page.click('canvas', { position: { x: 640, y: 600 } }).catch(() => {})

// settle, then optionally walk
for (let i = 0; i < 40; i++) await step(1000 / 30)
if (walk) {
  await page.keyboard.down('w')
  const frames = Math.round(seconds * 30)
  for (let i = 0; i < frames; i++) await step(1000 / 30)
  await page.keyboard.up('w')
}

// one more frame must be presented before the compositor has anything to grab
await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
await page.screenshot({ path: path.resolve(out) })
console.log('wrote', out)
await browser.close()
