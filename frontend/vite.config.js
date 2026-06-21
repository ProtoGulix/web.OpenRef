import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  cacheDir: '/tmp/vite-cache',
  server: {
    port: 3000,
    headers: {
      'Cache-Control': 'no-store',
    },
    proxy: {
      '/api': {
        target: 'http://backend:3001',
        changeOrigin: true,
        proxyTimeout: 120000,
        timeout: 120000,
      },
      '/storage': {
        target: 'http://backend:3001',
        changeOrigin: true,
      },
    },
  },
})
