import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '../frontend/node_modules/vite/dist/node/index.js';
import react from '../frontend/node_modules/@vitejs/plugin-react/dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendModules = path.resolve(__dirname, '../frontend/node_modules');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: path.resolve(frontendModules, 'react'),
      'react-dom': path.resolve(frontendModules, 'react-dom'),
      'lucide-react': path.resolve(frontendModules, 'lucide-react'),
      'react-refresh': path.resolve(frontendModules, 'react-refresh'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  preview: {
    port: 4174,
    strictPort: true,
  },
});
