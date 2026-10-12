const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function main() {
  const root = path.resolve(process.argv[2] || '')
  if (!process.argv[2] || !fs.statSync(path.join(root, 'BossOffice.exe')).isFile()) {
    throw new Error('Pass the portable output folder')
  }
  const appRoot = path.join(root, 'resources', 'app')
  const { startTrustedVite } = require(path.join(appRoot, 'electron', 'preview-runtime.cjs'))
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-office-portable-preview-'))
  let server
  try {
    const projectRoot = path.join(temp, 'site')
    fs.cpSync(path.join(appRoot, 'electron', 'project-starter'), projectRoot, { recursive: true })
    const runtime = await startTrustedVite({
      project: { projectRoot, metadata: { id: 'portable-preview-smoke' } },
      cacheRoot: path.join(temp, 'cache'),
    })
    server = runtime.server
    const index = await fetch(runtime.url)
    assert.equal(index.status, 200)
    assert.match(await index.text(), /<div id="root"><\/div>/)
    const app = await fetch(new URL('/src/App.tsx', runtime.url))
    assert.equal(app.status, 200)
    assert.match(await app.text(), /Your website starts here/)
    console.log('Portable trusted preview served the starter from packaged files.')
  } finally {
    if (server) await server.close()
    const resolved = path.resolve(temp)
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
        !path.basename(resolved).startsWith('boss-office-portable-preview-')) {
      throw new Error('Unsafe portable preview cleanup path')
    }
    fs.rmSync(resolved, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
