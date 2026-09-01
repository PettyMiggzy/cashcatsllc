import fs from 'fs-extra'
import path from 'path'
import { hashFile } from '../core/utils-server'

export class AssetsLocal {
  constructor() {
    this.url = process.env.ASSETS_BASE_URL
    this.dir = null
  }

  async init({ rootDir, worldDir }) {
    console.log('[assets] initializing')
    this.dir = path.join(worldDir, '/assets')
    // ensure assets directory exists
    await fs.ensureDir(this.dir)
    // copy over built-in assets
    await fs.copy(path.join(rootDir, 'src/world/assets'), this.dir)
  }

  /*
   * What may be stored, and why the list is short.
   *
   * The extension comes from the uploader and becomes the extension on disk,
   * and these files are served by @fastify/static from the world's own origin.
   * So without a list, anyone who can reach /api/upload can put a .html on
   * https://<the world>/assets/ — same origin as the page that keeps the auth
   * token and the Vault pass in localStorage. That is stored XSS with the
   * credentials sitting next to it.
   *
   * Everything the world legitimately uploads is a model, an avatar, an
   * image, a sound, a script or a sky. Nothing else needs to be storable, so
   * nothing else is. Rejecting is safer than sanitising: a list of what is
   * allowed cannot be walked around by a spelling nobody thought of.
   */
  static ALLOWED = new Set(['glb', 'vrm', 'png', 'jpg', 'jpeg', 'webp', 'mp3', 'js', 'hdr', 'json'])

  async upload(file) {
    const ext = String(file.name || '').split('.').pop().toLowerCase()
    if (!AssetsLocal.ALLOWED.has(ext)) {
      console.error(`[assets] refused upload of .${ext} — not an allowed asset type`)
      return
    }
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const hash = await hashFile(buffer)
    const filename = `${hash}.${ext}`
    const assetPath = path.join(this.dir, filename)
    const exists = await fs.exists(assetPath)
    if (exists) return
    await fs.writeFile(assetPath, buffer)
  }

  async exists(filename) {
    const filePath = path.join(this.dir, filename)
    const exists = await fs.exists(filePath)
    return exists
  }

  async list() {
    const assets = new Set()
    const files = fs.readdirSync(this.dir)
    for (const file of files) {
      const filePath = path.join(this.dir, file)
      const isDirectory = fs.statSync(filePath).isDirectory()
      if (isDirectory) continue
      const relPath = path.relative(this.dir, filePath)
      // HACK: we only want to include uploaded assets (not core/assets/*) so we do a check
      // if its filename is a 64 character hash
      const isAsset = relPath.split('.')[0].length === 64
      if (!isAsset) continue
      assets.add(relPath)
    }
    return assets
  }

  async delete(assets) {
    for (const asset of assets) {
      const fullPath = path.join(this.dir, asset)
      fs.removeSync(fullPath)
    }
  }
}
