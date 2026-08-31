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
const CATS = ['serious', 'long', 'cash', 'pop', 'apple']

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
})).newPage({ viewport: { width: 1500, height: 620 } })
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
const scene = new THREE.Scene()
scene.background = new THREE.Color('#eceee9')
scene.add(new THREE.HemisphereLight('#ffffff', '#9aa39b', 2.4))
const key = new THREE.DirectionalLight('#fff4e0', 2.0); key.position.set(2, 4, 5); scene.add(key)
const fill = new THREE.DirectionalLight('#dfe8ff', 0.8); fill.position.set(-3, 2, 2); scene.add(fill)
const cam = new THREE.PerspectiveCamera(28, 1500 / 620, 0.1, 100)
cam.position.set(0, 0.95, 8.4); cam.lookAt(0, 0.85, 0)
const r = new THREE.WebGLRenderer({ antialias: true })
r.setSize(1500, 620); document.body.appendChild(r.domElement)
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
    glb.scene.position.set((i - (CATS.length - 1) / 2) * 1.28, 0, 0)
    glb.scene.rotation.y = Math.PI          // vrm0 faces away from the camera
    scene.add(glb.scene)
    if (++done === CATS.length) { r.render(scene, cam); window.__ready = true }
  }, undefined, e => { console.error('load ' + k + ': ' + e); window.__ready = true })
})
</script></body></html>`
await page.goto('http://localhost:8099/', { waitUntil: 'load', timeout: 120000 })

await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 })
await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
await page.screenshot({ path: out })
console.log('wrote', out, (fs.statSync(out).size / 1e6).toFixed(1) + ' MB')
process.exit(0)
