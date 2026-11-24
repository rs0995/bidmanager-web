import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const r = (p: string) => path.resolve(__dirname, p);

// The server only allows the desktop app's origin (CORS), so the browser preview
// can't call it directly. src/lib/api.ts sends web requests to /__bm_proxy/<path>
// with the real server in `x-bm-target`; this forwards them from Node, where CORS
// doesn't apply. Dev-only: native builds call the server directly.
function serverProxy(): Plugin {
  const FORWARD = ['content-type', 'x-admin-key', 'x-api-key'];
  return {
    name: 'bm-server-proxy',
    configureServer(server) {
      server.middlewares.use('/__bm_proxy', async (req, res) => {
        const target = String(req.headers['x-bm-target'] || '');
        if (!/^https?:\/\//.test(target)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ detail: 'Missing or invalid x-bm-target' }));
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const headers: Record<string, string> = {};
        for (const h of FORWARD) {
          const v = req.headers[h];
          if (typeof v === 'string') headers[h] = v;
        }
        try {
          const upstream = await fetch(target + (req.url || ''), {
            method: req.method,
            headers,
            body:
              req.method === 'GET' || req.method === 'HEAD' || !chunks.length
                ? undefined
                : Buffer.concat(chunks),
          });
          res.statusCode = upstream.status;
          res.setHeader(
            'content-type',
            upstream.headers.get('content-type') || 'application/json',
          );
          res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch (err) {
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              detail: `Preview proxy could not reach ${target}: ${(err as Error).message}`,
            }),
          );
        }
      });
    },
  };
}

// Browser-only preview of the React Native app (react-native-web). Not used for iOS/Android builds.
export default defineConfig({
  root: __dirname,
  publicDir: false,
  plugins: [react(), serverProxy()],
  resolve: {
    alias: [{ find: /^react-native$/, replacement: 'react-native-web' }],
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
    port: 5174,
    open: false,
    fs: { allow: [r('..')] },
  },
});
