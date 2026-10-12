import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'

const root = resolve(import.meta.dirname)
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.glb': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8' }
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname))
    if (path !== root && !path.startsWith(root + sep)) { response.writeHead(403); response.end('Forbidden'); return }
    const info = await stat(path)
    if (!info.isFile()) { response.writeHead(404); response.end('Not found'); return }
    response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    response.end(await readFile(path))
  } catch { response.writeHead(404); response.end('Not found') }
})
const port = Number(process.env.PORT || 5180)
server.listen(port, '127.0.0.1', () => console.log(`Office prototype: http://127.0.0.1:${port}`))
