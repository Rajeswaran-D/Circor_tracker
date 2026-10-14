import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Plugin } from 'vite'

function handleDevFallback(req: any, res: any) {
  if (!res || !('writeHead' in res) || res.headersSent) return;

  const stateFile = process.env.STATE_FILE_PATH || path.join(os.homedir(), '.cft-project-e2e-tracker-shared-state.json');
  let state: Record<string, unknown> = {};
  try {
    if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {}

  const url = req.url || '';
  if (url.includes('/api/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', devFallback: true, dbConnected: false }));
    return;
  }
  if (url.includes('/api/shared-state')) {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
      return;
    }
    if (req.method === 'PUT') {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk; });
      req.on('end', () => {
        try {
          const update = JSON.parse(body);
          state = { ...state, ...update };
          fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
          res.writeHead(204);
          res.end();
        } catch {
          res.writeHead(400);
          res.end();
        }
      });
      return;
    }
  }
  if (url.includes('/api/orders')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state.cft_pos || []));
    return;
  }
  if (url.includes('/api/products')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state.cft_products || []));
    return;
  }
  if (url.includes('/api/templates')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state.cft_templates || []));
    return;
  }
  if (url.includes('/api/config')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state.cft_config || { atRiskThresholdDays: 3, delayedThresholdDays: 7 }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', fallback: true }));
}

function backendProxyPlugin(): Plugin {
  return {
    name: 'cft-backend-proxy',
    configureServer(server) {
      server.middlewares.use('/api', (_req, _res, next) => {
        // Let proxy handle unless standalone server is unreachable
        next();
      });
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    backendProxyPlugin(),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure: (proxy, _options) => {
          proxy.on('error', (_err, req, res) => {
            handleDevFallback(req, res);
          });
        }
      }
    }
  }
})
