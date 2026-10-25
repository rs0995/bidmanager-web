import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const r = (p: string) => path.resolve(__dirname, p);

// Browser-only preview of the React Native app (react-native-web). Not used for iOS/Android builds.
export default defineConfig({
  root: __dirname,
  publicDir: false,
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: 'react-native-web' },
      {
        find: /^@react-native-community\/blur$/,
        replacement: r('shims/blur.tsx'),
      },
      // Live-mode native modules; the preview runs in demo mode (see shims/native.ts).
      {
        find: /^(react-native-keychain|@react-native-documents\/picker|react-native-blob-util|react-native-zip-archive)$/,
        replacement: r('shims/native.ts'),
      },
    ],
    extensions: [
      '.web.tsx',
      '.web.ts',
      '.web.js',
      '.tsx',
      '.ts',
      '.js',
      '.jsx',
      '.json',
    ],
  },
  define: {
    __DEV__: 'true',
    global: 'globalThis',
  },
  optimizeDeps: {
    esbuildOptions: {
      resolveExtensions: ['.web.js', '.js', '.jsx', '.ts', '.tsx'],
      loader: { '.js': 'jsx' },
    },
  },
  server: {
    port: 5173,
    open: false,
    fs: { allow: [r('..')] },
  },
});
