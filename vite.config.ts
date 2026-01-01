import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      proxy: {
        '/api/agent': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false
        },
        '/api/e2b': {
          target: 'https://api.e2b.dev',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/e2b/, ''),
          secure: true,
          ws: true,
          configure: (proxy, _options) => {

            proxy.on('error', (err, _req, _res) => {
              console.log('proxy error', err);
            });
            proxy.on('proxyReq', (proxyReq, req, _res) => {
              console.log('Sending Request to the Target:', req.method, req.url);
            });
            proxy.on('proxyRes', (proxyRes, req, _res) => {
              console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
            });
          }
        },
        '/api/sandbox_exec': {
          target: 'https://api.e2b.dev', // Default/Fallback
          changeOrigin: true,
          secure: true,
          ws: true,
          configure: (proxy, _options) => {
            proxy.on('error', (err, _req, _res) => {
              console.error('[Proxy Error]', err);
            });
            proxy.on('proxyReq', (proxyReq, req, _res) => {
              const match = req.url?.match(/^\/api\/sandbox_exec\/([^/]+)\/(.*)/);
              if (match) {
                const targetHost = match[1];
                const newPath = '/' + match[2];
                // Critically important: Set Host header for E2B Gateway routing
                proxyReq.setHeader('Host', targetHost);
                proxyReq.path = newPath;
              }
            });
          },
          // router handles finding the correct target host
          router: (req) => {
            const matches = req.url?.match(/^\/api\/sandbox_exec\/([^/]+)/);
            return matches ? 'https://' + matches[1] : 'https://api.e2b.dev';
          }
        }
      }
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.E2B_API_KEY': JSON.stringify(env.E2B_API_KEY),
      'process.env.GITHUB_TOKEN': JSON.stringify(env.GITHUB_TOKEN),
      'process.env.TAVILY_API_KEY': JSON.stringify(env.TAVILY_API_KEY),
      'process.env.PR_URL': JSON.stringify(env.PR_URL),
      'process.env.REPO_URL': JSON.stringify(env.REPO_URL),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
      // Don't bundle server-only dependencies
      dedupe: ['@kubernetes/client-node'],
    },
    optimizeDeps: {
      exclude: ['@kubernetes/client-node', 'k8s'],
    },
    test: {
      exclude: ['**/node_modules/**', '**/dist/**', '**/cypress/**', '**/.{idea,git,cache,output,temp}/**', '**/__tests__/e2e/**'],
      globals: true,
      environment: 'node',
      testTimeout: 20000, // Increase global timeout to 20s
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
        },
        output: {
          manualChunks: undefined,
        },
        // Don't bundle server-only dependencies
        external: ['@kubernetes/client-node', 'k8s'],
      },
    },
  };
});
