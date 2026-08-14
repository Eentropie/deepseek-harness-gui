import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveHostOrigin } from './server/plugin-control.ts'
import { pluginControlPlugin } from './server/vite-plugin.ts'

const HOST_ORIGIN = resolveHostOrigin()

/**
 * Keep the browser same-origin with this standalone GUI while forwarding the
 * Harness transport to its unchanged loopback Host. Rewriting both Host and
 * Origin preserves the Host's DNS-rebinding boundary without requiring a
 * trusted-host or CORS change on port 3080.
 */
function harnessProxy(): ProxyOptions {
  return {
    target: HOST_ORIGIN,
    changeOrigin: true,
    ws: true,
    configure(proxy) {
      proxy.on('proxyReq', (request) => {
        request.setHeader('origin', HOST_ORIGIN)
      })
      proxy.on('proxyReqWs', (request) => {
        request.setHeader('origin', HOST_ORIGIN)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), pluginControlPlugin()],
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: { '/api': harnessProxy() },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: { '/api': harnessProxy() },
  },
})
