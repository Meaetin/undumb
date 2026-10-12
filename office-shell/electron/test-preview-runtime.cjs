const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { startTrustedVite, validateBounds, PreviewRuntime } = require('./preview-runtime.cjs')

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { agent: false, headers: { Connection: 'close' } }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.on('end', () => resolve({ status: response.statusCode, body }))
    }).on('error', reject)
  })
}

test('trusted preview serves React source without executing project configuration or scripts', async () => {
  const temp = fs.mkdtempSync(path.join(__dirname, '.preview-test-'))
  const projectRoot = path.join(temp, 'site')
  const marker = path.join(temp, 'untrusted-code-ran')
  fs.cpSync(path.join(__dirname, 'project-starter'), projectRoot, { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'src/App.tsx'), 'export default function App() { return <h1>Preview works</h1> }')
  fs.writeFileSync(path.join(projectRoot, 'vite.config.ts'), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'vite config ran'); export default {}`)
  fs.writeFileSync(path.join(projectRoot, 'postcss.config.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'postcss config ran'); module.exports = {}`)
  fs.writeFileSync(path.join(projectRoot, 'babel.config.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'babel config ran'); module.exports = {}`)
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ scripts: { dev: `node -e "require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'script ran')"` } }))
  let server
  try {
    const started = await startTrustedVite({
      project: { projectRoot, metadata: { id: 'test-project' } },
      cacheRoot: path.join(temp, 'trusted-cache'),
    })
    server = started.server
    assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+\/$/)
    const page = await get(started.url)
    assert.equal(page.status, 200)
    assert.match(page.body, /src\/main\.tsx/)
    const module = await get(new URL('/src/App.tsx', started.url))
    assert.equal(module.status, 200)
    assert.match(module.body, /Preview works/)
    assert.equal(fs.existsSync(marker), false)
    await server.waitForRequestsIdle()
  } finally {
    if (server) await server.close()
    if (path.dirname(path.resolve(temp)) !== __dirname) throw new Error('Unsafe test cleanup path')
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

test('preview bounds stay within the office window', () => {
  const window = { getContentBounds: () => ({ width: 1000, height: 700 }) }
  assert.deepEqual(validateBounds({ x: 10, y: 20, width: 400, height: 300 }, window), { x: 10, y: 20, width: 400, height: 300 })
  assert.equal(validateBounds(null, window), null)
  assert.throws(() => validateBounds({ x: 900, y: 20, width: 200, height: 300 }, window), RangeError)
  assert.throws(() => validateBounds({ x: 0, y: 0, width: 0, height: 1 }, window), RangeError)
})

test('preview navigation is restricted to its exact loopback origin', () => {
  const runtime = Object.create(PreviewRuntime.prototype)
  runtime.origin = 'http://127.0.0.1:12345'
  assert.equal(runtime.allowedNavigation('http://127.0.0.1:12345/example'), true)
  assert.equal(runtime.allowedNavigation('http://127.0.0.1:54321/'), false)
  assert.equal(runtime.allowedNavigation('https://example.com/'), false)
  assert.equal(runtime.allowedNavigation('file:///C:/secret'), false)
})
