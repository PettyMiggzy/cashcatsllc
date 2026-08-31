/*
 * Pose a VRM offline, exactly the way the client does.
 *
 * Loading the world in a browser to look at one wrong elbow costs three
 * minutes a go. This runs the real createEmoteFactory retarget against a real
 * animation clip and prints where the bones land, in about a second.
 *
 *   node roomsrc/probe_pose.mjs src/world/assets/avatar.vrm mp-idle.glb
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin } from '@pixiv/three-vrm'
import { createEmoteFactory } from '../src/core/extras/createEmoteFactory.js'
import fs from 'fs'

globalThis.self = globalThis
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} })
if (!globalThis.URL.createObjectURL) {
  globalThis.URL.createObjectURL = () => 'blob:stub'
  globalThis.URL.revokeObjectURL = () => {}
}

const DEG2RAD = Math.PI / 180
const vrmPath = process.argv[2] || 'src/world/assets/avatar.vrm'
const emotePath = 'src/world/assets/' + (process.argv[3] || 'mp-idle.glb')
const noRest = process.argv.includes('--no-rest')

const read = p => {
  const b = fs.readFileSync(p)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
const parse = (loader, ab) => new Promise((res, rej) => loader.parse(ab, '', res, rej))

const vrmLoader = new GLTFLoader()
vrmLoader.register(p => new VRMLoaderPlugin(p))
const glb = await parse(vrmLoader, read(vrmPath))
const emoteGlb = await parse(new GLTFLoader(), read(emotePath))

const skinnedMeshes = []
glb.scene.traverse(n => { if (n.isSkinnedMesh) skinnedMeshes.push(n) })
const skeleton = skinnedMeshes[0].skeleton

// --- mirror createVRMFactory, in order ---
glb.scene.updateMatrixWorld(true)
const restRotations = {}
for (const boneName in glb.userData.vrm.humanoid._normalizedHumanBones.humanBones) {
  const node = glb.userData.vrm.humanoid.getRawBoneNode(boneName)
  if (!node) continue
  restRotations[boneName] = {
    world: node.getWorldQuaternion(new THREE.Quaternion()),
    parent: node.parent ? node.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion(),
  }
}
const getBoneRest = noRest ? undefined : (n => restRotations[n])

const normBones = glb.userData.vrm.humanoid._normalizedHumanBones.humanBones
normBones.leftUpperArm.node.rotation.z = 75 * DEG2RAD
normBones.rightUpperArm.node.rotation.z = -75 * DEG2RAD
glb.userData.vrm.humanoid.update(0)
skeleton.update()

const bones = glb.userData.vrm.humanoid._rawHumanBones.humanBones
const rootToHips = bones.hips.node.matrixWorld.elements[13]
const version = glb.userData.vrm.meta?.metaVersion
const getBoneName = n => glb.userData.vrm.humanoid.getRawBoneNode(n)?.name

const clip = createEmoteFactory(emoteGlb, emotePath).toClip({ rootToHips, version, getBoneName, getBoneRest })
const mixer = new THREE.AnimationMixer(skinnedMeshes[0])
mixer.clipAction(clip).play()
mixer.update(0.5)
skeleton.bones.forEach(b => b.updateMatrixWorld())
glb.scene.updateMatrixWorld(true)

console.log('%s  <- %s%s', vrmPath.split('/').pop(), emotePath.split('/').pop(), noRest ? '  (rest mapping OFF)' : '')
console.log('  tracks bound: %d', clip.tracks.length)
const v = new THREE.Vector3()
for (const k of ['hips', 'head', 'leftUpperArm', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot']) {
  const n = glb.userData.vrm.humanoid.getRawBoneNode(k)
  if (!n) { console.log('  %-14s MISSING', k); continue }
  n.getWorldPosition(v)
  console.log('  %-14s %s %s %s', k, v.x.toFixed(3).padStart(7), v.y.toFixed(3).padStart(7), v.z.toFixed(3).padStart(7))
}
