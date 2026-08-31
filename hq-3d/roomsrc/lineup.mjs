/*
 * Render the whole cast in a row, front on.
 *
 * Answers one question at a glance: do five cats read as five characters?
 * Walking each one around the world to find out costs a capture a cat; this
 * loads them all into one page and shoots it once.
 *
 *   node roomsrc/lineup.mjs out.png [--pose idle]
 */
import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFile } from 'fs/promises'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HQ = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const out = path.resolve(process.argv[2] || 'lineup.png')
// --each writes one transparent portrait per cat next to `out`, for the
// character-select cards; without it they all go in one row.
const EACH = process.argv.includes('--each')
const CATS = EACH ? ['cash', 'long', 'serious', 'apple', 'pop']
                  : ['serious', 'long', 'cash', 'pop', 'apple']

const TYPES = { '.js': 'text/javascript', '.vrm': 'model/gltf-binary', '.html': 'text/html' }
let PAGE = ''
const server = createServer(async (req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '')
    // Serve the page itself too. setContent gives it the origin "null", and
    // a null origin may not import modules over http — every script came
    // back blocked by CORS.
    if (rel === '' || rel === 'index.html') {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end(PAGE)
    }
    const file = path.join(HQ, rel)
    if (!file.startsWith(HQ)) throw new Error('outside')
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('nope')
  }
})
await new Promise(r => server.listen(8099, r))

const page = await (await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--no-sandbox', '--disable-dev-shm-usage'],
})).newPage({ viewport: EACH ? { width: 560, height: 820 } : { width: 1500, height: 620 } })
page.on('console', m => { if (m.type() === 'error') console.log('  page:', m.text()) })

PAGE = `<!doctype html><html><body style="margin:0">
<script type="importmap">{"imports":{
  "three":"http://localhost:8099/node_modules/three/build/three.module.js",
  "three/":"http://localhost:8099/node_modules/three/",
  "@pixiv/three-vrm":"http://localhost:8099/node_modules/@pixiv/three-vrm/lib/three-vrm.module.js"
}}</script>
<script type="module">
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin } from '@pixiv/three-vrm'
const CATS = ${JSON.stringify(CATS)}
const EACH = ${EACH}
const W = EACH ? 560 : 1500, H = EACH ? 820 : 620
const scene = new THREE.Scene()
if (!EACH) scene.background = new THREE.Color('#eceee9')
scene.add(new THREE.HemisphereLight('#ffffff', '#9aa39b', 2.4))
const key = new THREE.DirectionalLight('#fff4e0', 2.0); key.position.set(2, 4, 5); scene.add(key)
const fill = new THREE.DirectionalLight('#dfe8ff', 0.8); fill.position.set(-3, 2, 2); scene.add(fill)
const cam = new THREE.PerspectiveCamera(EACH ? 22 : 28, W / H, 0.1, 100)
cam.position.set(0, 0.92, EACH ? 6.4 : 8.4); cam.lookAt(0, 0.86, 0)
const r = new THREE.WebGLRenderer({ antialias: true, alpha: EACH })
r.setClearAlpha(EACH ? 0 : 1)
r.setSize(W, H); document.body.appendChild(r.domElement)
const loader = new GLTFLoader(); loader.register(p => new VRMLoaderPlugin(p))
const DEG = Math.PI / 180
let done = 0
CATS.forEach((k, i) => {
  loader.load('http://localhost:8099/roomsrc/cast_vrm/cat_' + k + '.vrm', glb => {
    const vrm = glb.userData.vrm
    const nb = vrm.humanoid._normalizedHumanBones.humanBones
    nb.leftUpperArm.node.rotation.z = 68 * DEG
    nb.rightUpperArm.node.rotation.z = -68 * DEG
    vrm.humanoid.update(0)
    glb.scene.position.set(EACH ? 0 : (i - (CATS.length - 1) / 2) * 1.28, 0, 0)
    glb.scene.rotation.y = Math.PI          // vrm0 faces away from the camera
    glb.scene.visible = !EACH
    scene.add(glb.scene)
    window.__cats = window.__cats || {}
    window.__cats[CATS[i]] = glb.scene
    if (++done === CATS.length) {
      if (!EACH) r.render(scene, cam)
      window.__show = k => {
        for (const n in window.__cats) window.__cats[n].visible = (n === k)
        r.render(scene, cam)
      }
      window.__ready = true
    }
  }, undefined, e => { console.error('load ' + k + ': ' + e); window.__ready = true })
})
</script></body></html>`
await page.goto('http://localhost:8099/', { waitUntil: 'load', timeout: 120000 })

await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 })
const shoot = async file => {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  await page.screenshot({ path: file, omitBackground: EACH })
  console.log('wrote', file, (fs.statSync(file).size / 1e6).toFixed(2) + ' MB')
}
if (EACH) {
  for (const k of CATS) {
    await page.evaluate(k => window.__show(k), k)
    await shoot(path.join(path.dirname(out), 'cat_' + k + '.png'))
  }
} else {
  await shoot(out)
}
process.exit(0)
