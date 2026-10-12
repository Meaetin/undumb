const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const MAX_SETTINGS_BYTES = 64 * 1024

const DEFAULT_SETTINGS = Object.freeze({
  leadNetwork: true,
  internNetwork: true,
  internFileEdits: true,
  terminalCommands: true,
  approvalReviewer: 'user',
})
const CAPABILITIES = Object.freeze({
  leadNetwork: false,
  internNetwork: false,
  internFileEdits: true,
  terminalCommands: false,
  approvalReviewer: true,
})

function validateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid office controls settings')
  const keys = Object.keys(DEFAULT_SETTINGS)
  if (Object.keys(value).length !== keys.length || keys.some(key => key === 'approvalReviewer'
    ? !['user', 'auto_review'].includes(value[key]) : typeof value[key] !== 'boolean')) {
    throw new Error('Invalid office controls settings')
  }
  if (!value.terminalCommands) throw new Error('Terminal command blocking is not supported by this Codex protocol')
  return Object.fromEntries(keys.map(key => [key, value[key]]))
}

class OfficeControls {
  constructor({ userDataPath }) {
    if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) throw new Error('userDataPath must be an absolute path')
    this.storagePath = path.join(userDataPath, 'office-controls.json')
    let saved
    try {
      const stat = fs.lstatSync(this.storagePath)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SETTINGS_BYTES) throw new Error('Office controls file is invalid')
      saved = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'))
    }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Could not load office controls: ${error.message}`)
    }
    if (saved) {
      if (saved.version !== 1) throw new Error('Unsupported office controls version')
      // Existing version-1 settings predate the reviewer choice.
      const migrated = { approvalReviewer: 'user', ...saved.settings }
      this.settings = validateSettings(migrated)
      // Early prototypes could store network=false. The MVP allows command
      // internet and hosted research, so restore both to true on load.
      if (!this.settings.leadNetwork || !this.settings.internNetwork || !Object.hasOwn(saved.settings, 'approvalReviewer')) {
        this.settings.leadNetwork = true
        this.settings.internNetwork = true
        this.persist(this.settings)
      }
    } else this.settings = { ...DEFAULT_SETTINGS }
  }

  getState() {
    return { settings: { ...this.settings }, capabilities: { ...CAPABILITIES } }
  }

  update(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Controls update must be an object')
    const keys = Object.keys(patch)
    if (!keys.length || keys.some(key => !(key in DEFAULT_SETTINGS) || (key === 'approvalReviewer'
      ? !['user', 'auto_review'].includes(patch[key]) : typeof patch[key] !== 'boolean'))) {
      throw new Error('Unknown or invalid office control')
    }
    if (keys.some(key => key === 'leadNetwork' || key === 'internNetwork')) {
      throw new Error('Network controls are unavailable in this MVP')
    }
    const next = validateSettings({ ...this.settings, ...patch })
    this.persist(next)
    this.settings = next
    return this.getState()
  }

  persist(next) {
    fs.mkdirSync(path.dirname(this.storagePath), { recursive: true })
    const directory = fs.lstatSync(path.dirname(this.storagePath))
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Office controls directory is invalid')
    try {
      const current = fs.lstatSync(this.storagePath)
      if (!current.isFile() || current.isSymbolicLink() || current.size > MAX_SETTINGS_BYTES) throw new Error('Office controls file is invalid')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const temp = `${this.storagePath}.${randomUUID()}.tmp`
    try {
      const fd = fs.openSync(temp, 'wx', 0o600)
      try {
        fs.writeFileSync(fd, JSON.stringify({ version: 1, settings: next }))
        fs.fsyncSync(fd)
      } finally { fs.closeSync(fd) }
      fs.renameSync(temp, this.storagePath)
    } finally {
      try { fs.unlinkSync(temp) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
}

module.exports = { OfficeControls, DEFAULT_SETTINGS, CAPABILITIES }
