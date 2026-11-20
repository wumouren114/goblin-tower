// 极简静态服务器：沙箱里 vite dev 会 spawn EPERM，这里用纯 node http 提供已构建的 dist/
// 用法: node scripts/serve-dist.mjs [port] [rootDir]
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'

const port = Number(process.argv[2] || 5199)
const root = path.resolve(process.cwd(), process.argv[3] || 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
}

createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  let file = path.join(root, url === '/' ? 'index.html' : url)
  if (!file.startsWith(root)) { res.writeHead(403).end('forbidden'); return }
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (!existsSync(file) || !statSync(file).isFile()) {
    // SPA 回退
    const idx = path.join(root, 'index.html')
    if (existsSync(idx)) { file = idx } else { res.writeHead(404).end('not found'); return }
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  })
  createReadStream(file).pipe(res)
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} at http://127.0.0.1:${port}`)
})
