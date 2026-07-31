import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiPort = Number(env.VITE_API_PORT || 8000)
  const apiTarget = `http://127.0.0.1:${apiPort}`

  return {
    plugins: [react()],
    // Use relative paths so the build works served from any origin
    base: './',
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/v1': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/health': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
