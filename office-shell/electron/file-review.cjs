const fs = require('node:fs')
const path = require('node:path')

const MAX_FILES = 2_000
const MAX_FILE_BYTES = 256 * 1024
const MAX_SCAN_BYTES = 12 * 1024 * 1024
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.scss', '.svg', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml'])
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.codex', '.agents', '.next', '.vite'])
const SENSITIVE_NAME = /(?:^|[._-])(?:env|secret|secrets|credential|credentials|password|private|token|key)(?:$|[._-])|(?:api|access|private)[_-]?key|(?:client|auth)[_-]?secret/i

function reviewError(message, code = 'INVALID_REVIEW_PATH') {
  const error = new Error(message)
  error.code = code
  return error
}

function ordinaryRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw reviewError('Review root must be an absolute path')
  const stat = fs.lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw reviewError('Review root must be an ordinary directory')
  return fs.realpathSync(root)
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 512 || value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw reviewError('Invalid review file path')
  }
  const parts = value.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes(':'))) throw reviewError('Invalid review file path')
  if (!isReviewable(value)) throw reviewError('This file is not available for review', 'FILE_NOT_REVIEWABLE')
  return parts
}

function isReviewable(relativePath) {
  const parts = relativePath.split('/')
  if (parts.some(part => part.startsWith('.') || SKIP_DIRECTORIES.has(part.toLowerCase()) || SENSITIVE_NAME.test(part))) return false
  const base = parts.at(-1)
  return TEXT_EXTENSIONS.has(path.extname(base).toLowerCase())
}

function containedFile(root, parts) {
  let current = root
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index])
    let stat
    try { stat = fs.lstatSync(current) }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
    if (stat.isSymbolicLink()) throw reviewError('Linked files cannot be reviewed', 'FILE_NOT_REVIEWABLE')
    if (index < parts.length - 1 && !stat.isDirectory()) return null
    if (index === parts.length - 1 && !stat.isFile()) return null
  }
  const real = fs.realpathSync(current)
  if (!real.startsWith(root + path.sep)) throw reviewError('File is outside the review root')
  return current
}

function readText(root, relativePath) {
  const file = containedFile(root, safeRelativePath(relativePath))
  if (!file) return null
  const stat = fs.statSync(file)
  if (stat.size > MAX_FILE_BYTES) throw reviewError('File is too large to review', 'FILE_TOO_LARGE')
  const bytes = fs.readFileSync(file)
  if (bytes.length > MAX_FILE_BYTES || bytes.includes(0)) throw reviewError('File is not reviewable text', 'FILE_NOT_REVIEWABLE')
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw reviewError('File is not UTF-8 text', 'FILE_NOT_REVIEWABLE') }
}

function collect(root, budget) {
  const files = new Map()
  const visit = (directory, prefix) => {
    if (budget.truncated) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      budget.entries += 1
      if (budget.entries > MAX_FILES) { budget.truncated = true; return }
      if (entry.isSymbolicLink()) continue
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !SKIP_DIRECTORIES.has(entry.name.toLowerCase()) && !SENSITIVE_NAME.test(entry.name)) {
          const child = path.join(directory, entry.name)
          if (fs.realpathSync(child).startsWith(root + path.sep)) visit(child, relativePath)
        }
        continue
      }
      if (!entry.isFile() || !isReviewable(relativePath)) continue
      const file = path.join(directory, entry.name)
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) { budget.truncated = true; continue }
      budget.bytes += stat.size
      if (budget.bytes > MAX_SCAN_BYTES) { budget.truncated = true; return }
      try { files.set(relativePath, readText(root, relativePath)) }
      catch (error) {
        if (error.code === 'FILE_NOT_REVIEWABLE' || error.code === 'FILE_TOO_LARGE') { budget.truncated = true; continue }
        throw error
      }
    }
  }
  visit(root, '')
  return files
}

function roots(options) {
  if (!options || typeof options !== 'object') throw reviewError('Review roots are required')
  return { projectRoot: ordinaryRoot(options.projectRoot), baselineRoot: ordinaryRoot(options.baselineRoot) }
}

function listProjectChanges(options) {
  const { projectRoot, baselineRoot } = roots(options)
  const budget = { entries: 0, bytes: 0, truncated: false }
  const before = collect(baselineRoot, budget)
  const after = collect(projectRoot, budget)
  if (budget.truncated) return { files: [], truncated: true }
  const files = []
  for (const relativePath of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(relativePath)
    const b = after.get(relativePath)
    if (a === b) continue
    files.push({ path: relativePath, status: a === undefined ? 'added' : b === undefined ? 'deleted' : 'modified' })
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { files, truncated: budget.truncated }
}

function readProjectChange(options) {
  const { projectRoot, baselineRoot } = roots(options)
  const relativePath = options.relativePath
  safeRelativePath(relativePath)
  const before = readText(baselineRoot, relativePath)
  const after = readText(projectRoot, relativePath)
  if (before === after) throw reviewError('This file has no reviewable change', 'NO_CHANGE')
  return { path: relativePath, status: before === null ? 'added' : after === null ? 'deleted' : 'modified', before, after }
}

module.exports = { listProjectChanges, readProjectChange }
