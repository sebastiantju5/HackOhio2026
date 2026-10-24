import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const fileHashes = new Map()

function sameContents(file) {
  try {
    const hash = createHash('sha1').update(readFileSync(file)).digest('hex')
    const unchanged = fileHashes.get(file) === hash
    fileHashes.set(file, hash)
    return unchanged
  } catch {
    return false
  }
}

function skipUnchangedReloads() {
  return {
    name: 'skip-unchanged-reloads',
    configureServer(server) {
      const send = server.ws.send.bind(server.ws)
      server.ws.send = (payload, ...rest) => {
        if (payload?.type === 'full-reload' && payload.path) {
          const path = payload.path
          const file = path.startsWith(server.config.root)
            ? path
            : `${server.config.root}${path.startsWith('/') ? path : `/${path}`}`
          if (sameContents(file)) return
        }
        return send(payload, ...rest)
      }
    },
    handleHotUpdate({ file }) {
      if (sameContents(file)) return []
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), skipUnchangedReloads()],
  server: {
    proxy: {
      '/api': 'http://localhost:5001',
    },
    watch: {
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100,
      },
    },
  },
})
