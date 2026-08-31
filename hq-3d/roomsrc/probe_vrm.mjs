import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin } from '@pixiv/three-vrm'
import fs from 'fs'

globalThis.self = globalThis
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} })
if (!globalThis.URL.createObjectURL) {
  globalThis.URL.createObjectURL = () => 'blob:stub'
  globalThis.URL.revokeObjectURL = () => {}
}

const file = process.argv[2]
const armsDown = process.argv[3] !== 'noarms'
const buf = fs.readFileSync(file)
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)

const loader = new GLTFLoader()
loader.register(p => new VRMLoaderPlugin(p))

loader.parse(ab, '', (glb) => {
  const vrm = glb.userData.vrm
  if (!vrm) { console.log('NO VRM EXTENSION'); process.exit(1) }
  console.log('meta version:', vrm.meta?.metaVersion ?? '0.x')
  const nb = vrm.humanoid._normalizedHumanBones.humanBones
  const DEG2RAD = Math.PI/180
  if (armsDown) {
    nb.leftUpperArm.node.rotation.z = 75*DEG2RAD
    nb.rightUpperArm.node.rotation.z = -75*DEG2RAD
  }
  vrm.humanoid.update(0)
  glb.scene.updateMatrixWorld(true)

  const keys = ['hips','spine','head','leftUpperArm','leftHand','rightHand','leftUpperLeg','leftFoot','rightFoot']
  const v = new THREE.Vector3()
  for (const k of keys) {
    const n = vrm.humanoid.getRawBoneNode(k)
    if (!n) { console.log(k.padEnd(14), 'MISSING'); continue }
    n.getWorldPosition(v)
    console.log(k.padEnd(14), v.x.toFixed(3).padStart(7), v.y.toFixed(3).padStart(7), v.z.toFixed(3).padStart(7))
  }
  // mesh bbox after skinning-ish (bind pose bbox of scene)
  const box = new THREE.Box3().setFromObject(glb.scene)
  console.log('scene bbox min', box.min.toArray().map(n=>n.toFixed(2)).join(','), 'max', box.max.toArray().map(n=>n.toFixed(2)).join(','))
}, (e) => { console.log('ERR', e) })
