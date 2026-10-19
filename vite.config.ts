import { defineConfig } from 'vite'

/**
 * GitHub Pages 项目站点是 https://<user>.github.io/<repo>/，
 * 资源必须用相对路径，否则部署后 404。
 * 部署脚本会传 `VITE_BASE=./`；本地 dev 仍是根路径。
 */
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
})
