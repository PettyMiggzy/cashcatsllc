/*
 * Fly the world and shoot every ground, so "it's built" can be checked
 * instead of asserted.
 *
 * The renderer runs at ~2.5fps under swiftshader, so as in capture.mjs the
 * render loop is taken off the clock and ticked by hand. Each viewpoint
 * teleports the player, points the camera, settles, and shoots.
 *
 *   node roomsrc/survey.mjs outdir [--only fields,docks]
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const args = process.argv.slice(2)
const outdir = path.resolve(args[0] || '/tmp/survey')
const flag = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1] }
const url = flag('url', 'http://localhost:3000')
const only = (flag('only', '') || '').split(',').filter(Boolean)

// name -> [x, y, z, yaw deg, pitch deg, zoom]
//
// Two things it is easy to get backwards, and I got both:
//   yaw 0 looks down -Z (the engine's default forward), 180 down +Z,
//   90 down -X and 270 down +X.
//   zoom pulls the CAMERA BACKWARDS along that view axis — a zoom of 16 at
//   yaw 0 puts the lens sixteen metres further along +Z than the player. The
//   first run stood on the plaza at zoom 16 and photographed the inside of
//   the Vault, then filed it as the plaza.
// So: stand at the subject, face it, and leave room BEHIND you for the lens.
const VIEWS = {
  plaza:     [   0, 0,  16,   0, -10,  9],
  office:    [   0, 0,  14,   0,  -6,  7],
  dedication:[  -9, 0,  20, 180,  -2,  4],
  markerW:   [ -27, 0,  14, 180,  -4,  4],
  // The four grounds want an establishing shot from above. At eye level with a
  // big zoom the lens ends up behind a signboard or inside a hedge — the first
  // Fields render was a close-up of a plank. Negative pitch orbits the camera
  // UP as well as back, so -32 at zoom 30 is a drone shot that clears clutter.
  fields:    [ -47, 0, -26,   0, -32, 30],
  fieldsIn:  [ -47, 0, -26,   0,  -6,  9],
  cottages:  [ -62, 0, -30, 270,  -8, 12],
  // the village from above, high enough to read the layout rather than a wall
  village:   [ -47, 0,  14,   0, -35, 55],
  topdown:   [ -47,28, -18,   0, -88,  2],
  homeOut:   [ -22, 0, -22,   0,  -8, 18],
  green:     [ -64, 0, -21,   0, -14, 16],
  guard:     [  48, 0,  20,   0,  -4,  6],
  guardIn:   [45.1, 0,  19,   0,   2,  2.5],
  market:    [ -47, 0, -10,   0,  -6, 10],
  mill:      [ -42, 0, -24,  90,  -4,  8],
  docks:     [ -47, 0,  50, 180, -30, 30],
  jetty:     [ -47, 0,  52, 180,  -4, 10],
  lake:      [ -47, 0,  60, 180,  -2, 12],
  ship:      [ -70, 0,  52, 180,  -8, 26],
  front:     [ -47, 0,  42,   0,  -4, 14],
  grove:     [  47, 0,  52, 180, -30, 30],
  groveIn:   [  47, 0,  52, 180,  -2,  8],
  seam:      [  47, 0, -28,   0, -30, 30],
  mine:      [  47, 0, -32,   0,   0,  9],
  // stand outside the colonnade looking down it at the arch. The old view put
  // the lens at z=14, which is exactly where the arch now is.
  pit:       [  48, 0,  22,   0,  -8, 16],
  pitIn:     [  48, 0,  14,   0,  -2,  7],
  // off-axis: dead centre at z=56 puts the lens directly behind the scratching
  // post, which then fills the frame and the park is a photo of a pole.
  catpark:   [ -14, 0,  46, 200, -26, 28],
  boss:      [   0, 0, -34,   0,  -8, 16],
  boxyard:   [ -17, 0,  52, 180,  -8, 10],
  camp:      [  47, 0, -18,   0, -22, 22],
  quay:      [ -47, 0,  33, 180, -18, 22],
  skyline:   [   0, 0,  40, 180,   8, 18],
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errs = []
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction(() => window.world?.entities?.player?.avatar, null, { timeout: 240000 })
await page.evaluate(() => { window.world.graphics.renderer.setAnimationLoop(null); window.__t = performance.now() })
await page.click('canvas', { position: { x: 640, y: 600 } }).catch(() => {})

const step = ms => page.evaluate(async ms => {
  const w = window.world
  window.__t += ms
  await new Promise(r => requestAnimationFrame(() => { w.tick(window.__t); r() }))
}, ms)

fs.mkdirSync(outdir, { recursive: true })
const names = Object.keys(VIEWS).filter(n => !only.length || only.includes(n))

for (const name of names) {
  const [x, y, z, yaw, pitch, zoom] = VIEWS[name]
  // teleport() snaps the physics capsule as well as the visual base; setting
  // .position alone leaves the body behind and the camera springs straight back
  await page.evaluate(({ x, y, z, yaw, pitch, zoom }) => {
    const p = window.world.entities.player
    p.teleport({ position: [x, y + 0.2, z], rotationY: yaw * Math.PI / 180 })
    p.cam.rotation.y = yaw * Math.PI / 180
    p.cam.rotation.x = pitch * Math.PI / 180
    p.cam.zoom = zoom
  }, { x, y, z, yaw, pitch, zoom })
  // let the loaders catch up and the camera lerp settle
  for (let i = 0; i < 38; i++) await step(1000 / 30)
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  const f = path.join(outdir, name + '.png')
  await page.screenshot({ path: f })
  console.log('  shot', name)
}
if (errs.length) {
  console.log('\npage errors (' + errs.length + '):')
  for (const e of [...new Set(errs)].slice(0, 12)) console.log('  ' + e)
}
console.log('wrote', names.length, 'shots to', outdir)
await browser.close()
