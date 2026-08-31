/*
 * Record a clip of the running world.
 *
 * Not page video capture: the software renderer manages a couple of frames a
 * second, so anything recorded in real time comes out as a slideshow. Drive
 * the clock ourselves instead, shoot one still per frame, and let ffmpeg lay
 * them down at the frame rate we actually want. Slow to record, smooth to
 * watch.
 *
 * A route is a list of steps, each with the keys held and how long for:
 *
 *   node roomsrc/record.mjs out.webm [--fps 24] [--width 1280] [--route tour]
 */
import { chromium } from 'playwright'
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const args = process.argv.slice(2)
const flag = (n, d) => {
  const i = args.indexOf('--' + n)
  return i === -1 ? d : args[i + 1]
}
const out = path.resolve(args[0] || 'clip.webm')
const fps = parseInt(flag('fps', '24'))
const width = parseInt(flag('width', '1280'))
const height = Math.round((width * 9) / 16)
const url = flag('url', 'http://localhost:3000')
const zoom = parseFloat(flag('zoom', '3.0'))
const routeName = flag('route', 'tour')
const ffmpeg = flag('ffmpeg', process.env.FFMPEG || '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux')

// Each leg: how long, which keys are held, and any camera nudge per second.
const ROUTES = {
  tour: [
    { t: 1.2, keys: [], turn: 0 },
    { t: 2.6, keys: ['w'], turn: 0 },
    { t: 1.6, keys: ['w'], turn: -34 },
    { t: 2.4, keys: ['w'], turn: 0 },
    { t: 1.6, keys: ['w'], turn: 30 },
    { t: 2.2, keys: ['w'], turn: 0 },
    { t: 1.4, keys: [], turn: 26 },
  ],
  walk: [
    { t: 1.0, keys: [], turn: 0 },
    { t: 5.0, keys: ['w'], turn: 0 },
    { t: 1.0, keys: [], turn: 0 },
  ],
  spin: [{ t: 8.0, keys: [], turn: 45 }],
}
const route = ROUTES[routeName]
if (!route) {
  console.error('no such route: %s (have: %s)', routeName, Object.keys(ROUTES).join(', '))
  process.exit(1)
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccrec-'))
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width, height } })
page.on('console', m => { if (m.type() === 'error') console.log('  page error:', m.text()) })

await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 })
await page.waitForFunction(() => window.world?.entities?.player?.avatar, null, { timeout: 180000 })

await page.evaluate(zoom => {
  const w = window.world
  w.graphics.renderer.setAnimationLoop(null)
  window.__t = performance.now()
  if (zoom) w.entities.player.cam.zoom = zoom
}, zoom)
await page.click('canvas', { position: { x: width / 2, y: height - 60 } }).catch(() => {})

const step = async (ms, turn) => {
  await page.evaluate(async ({ ms, turn }) => {
    const w = window.world
    if (turn) w.entities.player.cam.rotation.y += (turn * Math.PI) / 180
    window.__t += ms
    await new Promise(r => requestAnimationFrame(() => { w.tick(window.__t); r() }))
  }, { ms, turn })
}

// let the world settle before the first frame — physics, textures, the sky
for (let i = 0; i < 30; i++) await step(1000 / fps, 0)

const total = route.reduce((n, leg) => n + Math.round(leg.t * fps), 0)
console.log('recording %d frames at %dfps (%.1fs) into %s', total, fps, total / fps, dir)

let n = 0
let held = []
const t0 = Date.now()
for (const leg of route) {
  for (const k of leg.keys) if (!held.includes(k)) await page.keyboard.down(k)
  for (const k of held) if (!leg.keys.includes(k)) await page.keyboard.up(k)
  held = leg.keys
  const frames = Math.round(leg.t * fps)
  for (let i = 0; i < frames; i++) {
    await step(1000 / fps, leg.turn / fps)
    await page.screenshot({ path: path.join(dir, String(n).padStart(5, '0') + '.png') })
    if (++n % 20 === 0) {
      const per = (Date.now() - t0) / n / 1000
      console.log('  %d/%d  (%.1fs/frame, ~%dm left)', n, total, per,
                  Math.round(((total - n) * per) / 60))
    }
  }
}
for (const k of held) await page.keyboard.up(k)
await browser.close()

const enc = spawnSync(ffmpeg, [
  '-y', '-framerate', String(fps), '-i', path.join(dir, '%05d.png'),
  ...(out.endsWith('.webm')
    ? ['-c:v', 'libvpx', '-b:v', '3M', '-crf', '10', '-auto-alt-ref', '0']
    : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20']),
  out,
], { encoding: 'utf8' })
if (enc.status !== 0) {
  console.error(enc.stderr?.split('\n').slice(-12).join('\n'))
  console.error('frames kept in %s', dir)
  process.exit(1)
}
fs.rmSync(dir, { recursive: true, force: true })
console.log('wrote %s (%.1f MB)', out, fs.statSync(out).size / 1e6)
