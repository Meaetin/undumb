const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createProject, getActiveProject } = require('./project-workspace.cjs')

const base = path.resolve(os.tmpdir())
const userDataPath = fs.mkdtempSync(path.join(base, 'boss-office-project-test-'))
try {
  const created = createProject({ userDataPath, idea: 'A test website' })
  assert.equal(created.metadata.idea, 'A test website')
  assert.equal(fs.readFileSync(path.join(created.projectRoot, 'src', 'App.tsx'), 'utf8'),
    fs.readFileSync(path.join(created.baselineRoot, 'src', 'App.tsx'), 'utf8'))
  fs.writeFileSync(path.join(created.projectRoot, 'src', 'App.tsx'), 'changed')
  const loaded = getActiveProject({ userDataPath })
  assert.notEqual(fs.readFileSync(path.join(loaded.projectRoot, 'src', 'App.tsx'), 'utf8'),
    fs.readFileSync(path.join(loaded.baselineRoot, 'src', 'App.tsx'), 'utf8'))
  assert.throws(() => createProject({ userDataPath, idea: 'Another' }), /already exists/)
  console.log('Project starter and immutable baseline checks passed.')
} finally {
  const resolved = path.resolve(userDataPath)
  if (path.dirname(resolved) !== base || !path.basename(resolved).startsWith('boss-office-project-test-')) {
    throw new Error('Unsafe project test cleanup path')
  }
  fs.rmSync(resolved, { recursive: true, force: true })
}
