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
  let state: Record<string, any> = {};
  try {
    if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {}

  // Tombstone parity with server/server.ts: a deleted order id recorded here
  // must never be served again or re-inserted by a stale PUT.
  const tombstonesOf = (s: Record<string, any>): Record<string, string> =>
    (s.__deleted_order_ids__ && typeof s.__deleted_order_ids__ === 'object' ? s.__deleted_order_ids__ : {}) as Record<string, string>;
  const stripDeleted = (list: any[]): any[] => {
    const tombs = tombstonesOf(state);
    return Array.isArray(list) ? list.filter((o: any) => o && o.id && !tombs[o.id]) : [];
  };
  const writeState = () => {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
  };

  const url = req.url || '';
  if (url.includes('/api/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', devFallback: true, dbConnected: false }));
    return;
  }
  if (url.includes('/api/shared-state')) {
    if (req.method === 'GET') {
      state.cft_pos = stripDeleted(state.cft_pos || []);
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
          if (Array.isArray(update.cft_pos)) update.cft_pos = stripDeleted(update.cft_pos);
          state = { ...state, ...update };
          writeState();
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
    if (req.method === 'DELETE') {
      // A delete against a dead backend must still remove the row (and block
      // later re-inserts) — never answer DELETE with the order list.
      const id = decodeURIComponent((url.split('/api/orders/')[1] || '').split('?')[0] || '');
      if (id) {
        state.cft_pos = (state.cft_pos || []).filter((o: any) => o.id !== id);
        state.__deleted_order_ids__ = { ...tombstonesOf(state), [id]: new Date().toISOString() };
        writeState();
      }
      res.writeHead(204);
      res.end();
      return;
    }
    state.cft_pos = stripDeleted(state.cft_pos || []);
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
