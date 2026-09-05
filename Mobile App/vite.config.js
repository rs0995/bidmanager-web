import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Mobile web client — dev server binds 0.0.0.0 so a phone on the same Wi-Fi
// can open it, and proxies /client/* to the real backend so the phone's
// browser only ever sees same-origin requests (the production backend's
// CORS allowlist only includes the Electron scheme, not arbitrary LAN IPs).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const BACKEND = env.VITE_API_BASE_URL || 'https://161.118.170.233.sslip.io';
  return {
    plugins: [react()],
    base: './',
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        '/client': { target: BACKEND, changeOrigin: true, secure: true },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});
