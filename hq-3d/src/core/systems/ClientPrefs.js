import { isBoolean, isNumber } from 'lodash-es'

import { System } from './System'
import { storage } from '../storage'
import { isTouch } from '../../client/utils'

/**
 * Client Prefs System
 *
 */
export class ClientPrefs extends System {
  constructor(world) {
    super(world)

    const isQuest = /OculusBrowser/.test(navigator.userAgent)

    const data = storage.get('prefs', {})

    // v2: reset ui scale for new mobile default (0.9)
    if (!data.v) {
      data.v = 2
      data.ui = null
    }
    // v3: reset shadows for new mobile default (med)
    if (data.v < 3) {
      data.v = 3
      data.shadows = null
    }
    // v4: reset shadows for new defaults (low or med)
    if (data.v < 4) {
      data.v = 4
      data.shadows = null
    }
    // v5: desktop drops to one shadow cascade.
    //
    // 'med' is three cascades, and a cascade is the whole scene submitted
    // again into a shadow map -- so the world was being drawn four times a
    // frame, once for the camera and three times for the sun. In a world that
    // puts a thousand props around you that is most of the frame, and this
    // art is flat-lit cartoon under an HDRI where the shadow is doing very
    // little of the work. 'low' is one cascade at 2048, which keeps a real
    // contact shadow under things and halves the geometry the GPU sees.
    // Anyone who wants the old look can set it back in settings.
    if (data.v < 5) {
      data.v = 5
      data.shadows = null
    }

    this.ui = isNumber(data.ui) ? data.ui : isTouch ? 0.9 : 1
    this.actions = isBoolean(data.actions) ? data.actions : true
    this.stats = isBoolean(data.stats) ? data.stats : false
    this.dpr = isNumber(data.dpr) ? data.dpr : 1
    this.shadows = data.shadows ? data.shadows : 'low' // none, low=1 cascade, med=3, high=3 @2048
    this.postprocessing = isBoolean(data.postprocessing) ? data.postprocessing : true
    this.bloom = isBoolean(data.bloom) ? data.bloom : true
    this.ao = isBoolean(data.ao) ? data.ao : true
    this.music = isNumber(data.music) ? data.music : 1
    this.sfx = isNumber(data.sfx) ? data.sfx : 1
    this.voice = isNumber(data.voice) ? data.voice : 1
    this.v = data.v

    this.changes = null
  }

  init() {
    this.world.chat.bindCommand('stats', () => {
      this.setStats(!this.stats)
    })
  }

  preFixedUpdate() {
    if (!this.changes) return
    this.emit('change', this.changes)
    this.changes = null
  }

  modify(key, value) {
    if (this[key] === value) return
    const prev = this[key]
    this[key] = value
    if (!this.changes) this.changes = {}
    if (!this.changes[key]) this.changes[key] = { prev, value: null }
    this.changes[key].value = value
    this.persist()
  }

  async persist() {
    // a small delay to ensure prefs that crash dont persist (eg old iOS with UHD shadows etc)
    await new Promise(resolve => setTimeout(resolve, 2000))
    storage.set('prefs', {
      ui: this.ui,
      actions: this.actions,
      stats: this.stats,
      dpr: this.dpr,
      shadows: this.shadows,
      postprocessing: this.postprocessing,
      bloom: this.bloom,
      ao: this.ao,
      music: this.music,
      sfx: this.sfx,
      voice: this.voice,
      v: this.v,
    })
  }

  setUI(value) {
    this.modify('ui', value)
  }

  setActions(value) {
    this.modify('actions', value)
  }

  setStats(value) {
    this.modify('stats', value)
  }

  setDPR(value) {
    this.modify('dpr', value)
  }

  setShadows(value) {
    this.modify('shadows', value)
  }

  setPostprocessing(value) {
    this.modify('postprocessing', value)
  }

  setBloom(value) {
    this.modify('bloom', value)
  }

  setAO(value) {
    this.modify('ao', value)
  }

  setMusic(value) {
    this.modify('music', value)
  }

  setSFX(value) {
    this.modify('sfx', value)
  }

  setVoice(value) {
    this.modify('voice', value)
  }

  destroy() {
    // ...
  }
}
