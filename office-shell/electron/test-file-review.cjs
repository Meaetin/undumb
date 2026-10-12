const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { listProjectChanges, readProjectChange } = require('./file-review.cjs')

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-office-review-'))
const projectRoot = path.join(temp, 'site')
const baselineRoot = path.join(temp, 'baseline')
const outside = path.join(temp, 'outside.txt')
const options = { projectRoot, baselineRoot }

function write(root, relativePath, content) {
  const target = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

try {
  fs.mkdirSync(projectRoot)
  fs.mkdirSync(baselineRoot)
  fs.writeFileSync(outside, 'private outside text')
  write(baselineRoot, 'src/App.tsx', 'Original app\n')
  write(projectRoot, 'src/App.tsx', 'Changed app\n')
  write(baselineRoot, 'src/old.css', 'old styles\n')
  write(projectRoot, 'src/new.css', 'new styles\n')
  write(projectRoot, '.env', 'SECRET=never expose\n')
  write(projectRoot, 'src/credentials.json', '{"password":"never expose"}\n')
  write(projectRoot, 'src/apiKey.ts', 'export const apiKey = "never expose"\n')
  write(projectRoot, 'node_modules/fake/index.js', 'do not scan\n')
  write(projectRoot, 'dist/bundle.js', 'do not scan\n')

  assert.deepEqual(listProjectChanges(options), { files: [
    { path: 'src/App.tsx', status: 'modified' },
    { path: 'src/new.css', status: 'added' },
    { path: 'src/old.css', status: 'deleted' },
  ], truncated: false })
  assert.deepEqual(readProjectChange({ ...options, relativePath: 'src/App.tsx' }), {
    path: 'src/App.tsx', status: 'modified', before: 'Original app\n', after: 'Changed app\n',
  })
  assert.deepEqual(readProjectChange({ ...options, relativePath: 'src/new.css' }), {
    path: 'src/new.css', status: 'added', before: null, after: 'new styles\n',
  })
  assert.deepEqual(readProjectChange({ ...options, relativePath: 'src/old.css' }), {
    path: 'src/old.css', status: 'deleted', before: 'old styles\n', after: null,
  })

  for (const unsafe of ['../outside.txt', '/outside.txt', 'C:/outside.txt', 'src/../../outside.txt', 'src\\App.tsx', '.env', 'src/credentials.json', 'src/apiKey.ts', 'node_modules/fake/index.js']) {
    assert.throws(() => readProjectChange({ ...options, relativePath: unsafe }), /Invalid review file path|not available for review/)
  }
  assert.throws(() => readProjectChange({ ...options, relativePath: 'src/no-change.tsx' }), /no reviewable change/)

  try {
    fs.symlinkSync(outside, path.join(projectRoot, 'src', 'linked.txt'))
    assert.equal(listProjectChanges(options).files.some(item => item.path === 'src/linked.txt'), false)
    assert.throws(() => readProjectChange({ ...options, relativePath: 'src/linked.txt' }), /Linked files cannot be reviewed/)
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error
  }

  write(projectRoot, 'src/binary.txt', Buffer.from([0, 1, 2]))
  assert.deepEqual(listProjectChanges(options), { files: [], truncated: true }, 'A new unreadable file makes the scan incomplete')
  assert.throws(() => readProjectChange({ ...options, relativePath: 'src/binary.txt' }), /not reviewable text/)
  fs.rmSync(path.join(projectRoot, 'src', 'binary.txt'))
  write(projectRoot, 'src/App.tsx', Buffer.from([0, 1, 2]))
  assert.deepEqual(listProjectChanges(options), { files: [], truncated: true }, 'Replacing text with binary must not look like a deletion')
  write(projectRoot, 'src/App.tsx', 'Changed app\n')

  write(projectRoot, 'src/large.txt', 'x'.repeat(256 * 1024 + 1))
  assert.deepEqual(listProjectChanges(options), { files: [], truncated: true })
  assert.throws(() => readProjectChange({ ...options, relativePath: 'src/large.txt' }), /too large to review/)
  console.log('File review checks passed: changes, safe text reading, secret exclusions, containment, links, limits.')
} finally {
  if (path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith('boss-office-review-')) fs.rmSync(temp, { recursive: true, force: true })
}
