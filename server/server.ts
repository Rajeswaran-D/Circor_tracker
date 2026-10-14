import express, { Request, Response } from 'express';
import cors from 'cors';
import compression from 'compression';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getDbPool, isDbConnected, getSafeDbConfig, closeDbPool } from './db';
import {
  initSchema,
  saveOrdersToDb,
  loadOrdersFromDb,
  deleteOrderFromDb,
  saveProductsToDb,
  loadProductsFromDb,
  saveAuditLogsToDb,
  loadAuditLogsFromDb,
  saveRectificationsToDb,
  loadRectificationsFromDb,
  saveConfigToDb,
  loadConfigFromDb,
  saveCancellationsToDb,
  loadCancellationsFromDb,
  saveTemplatesToDb,
  loadTemplatesFromDb,
  DEFAULT_ORG_ID
} from './mysqlAdapter';
import type { PurchaseOrder, ProductMasterItem, CategoryTemplate, RectificationAction, AuditLogEntry, SystemConfig, CancellationRequest } from '../src/types';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const stateFile = process.env.STATE_FILE_PATH || path.join(os.homedir(), '.cft-project-e2e-tracker-shared-state.json');

// Performance optimizations: gzip/brotli compression, cors, json body parser
app.use(compression({
  threshold: 1024,
  level: 6
}));

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Organization-Id', 'Authorization']
}));

app.use(express.json({ limit: '30mb' }));

// In-Memory Fast Cache for sub-millisecond responses
let memoryState: Record<string, unknown> = {};
let isDirty = false;

// Load initial state from disk
try {
  if (fs.existsSync(stateFile)) {
    memoryState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    console.log(`[Storage] Initial state loaded from ${stateFile} (${Object.keys(memoryState).length} keys)`);
  }
} catch (err: any) {
  console.warn(`[Storage] Could not read existing state file: ${err.message}. Initializing empty.`);
  memoryState = {};
}

// Debounced background sync to disk
function scheduleStateSave() {
  if (isDirty) return;
  isDirty = true;
  setTimeout(() => {
    try {
      fs.writeFileSync(stateFile, JSON.stringify(memoryState, null, 2), 'utf8');
      isDirty = false;
    } catch (err: any) {
      console.error(`[Storage Error] Failed to write state to disk: ${err.message}`);
      isDirty = false;
    }
  }, 100);
}

function getOrgId(req: Request): string {
  return (req.headers['x-organization-id'] as string) || DEFAULT_ORG_ID;
}

// Background sync to MySQL when state changes
async function syncStateToMySql(orgId: string, update: Record<string, unknown>): Promise<void> {
  const pool = await getDbPool();
  if (!pool) return;

  try {
    if (update.cft_pos && Array.isArray(update.cft_pos)) {
      await saveOrdersToDb(pool, orgId, update.cft_pos as PurchaseOrder[]);
    }
    if (update.cft_products && Array.isArray(update.cft_products)) {
      await saveProductsToDb(pool, orgId, update.cft_products as ProductMasterItem[]);
    }
    if (update.cft_audit && Array.isArray(update.cft_audit)) {
      await saveAuditLogsToDb(pool, orgId, update.cft_audit as AuditLogEntry[]);
    }
    if (update.cft_rectifications && Array.isArray(update.cft_rectifications)) {
      await saveRectificationsToDb(pool, orgId, update.cft_rectifications as RectificationAction[]);
    }
    if (update.cft_config && typeof update.cft_config === 'object') {
      await saveConfigToDb(pool, orgId, update.cft_config as SystemConfig);
    }
    if (update.cft_cancellations && Array.isArray(update.cft_cancellations)) {
      await saveCancellationsToDb(pool, orgId, update.cft_cancellations as CancellationRequest[]);
    }
    if (update.cft_templates && Array.isArray(update.cft_templates)) {
      await saveTemplatesToDb(pool, orgId, update.cft_templates as CategoryTemplate[]);
    }
  } catch (err: any) {
    console.warn(`[MySQL Sync Warning] Async sync encountered non-fatal error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Health & Diagnostics
// ---------------------------------------------------------------------------

app.get('/api/health', async (_req: Request, res: Response) => {
  // Re-validates the pool so the endpoint never falsely claims MySQL is connected.
  await getDbPool();
  const dbConnected = isDbConnected();
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    dbConnected,
    storageProvider: dbConnected ? 'mysql' : 'memory-with-file-sync',
    uptime: process.uptime(),
    db: getSafeDbConfig()
  });
});

// ---------------------------------------------------------------------------
// 2. Shared State Live-Sync (Frontend Store Gateway)
// ---------------------------------------------------------------------------

app.get('/api/shared-state', async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('X-Served-By', 'cft-production-engine');

  const pool = await getDbPool();
  if (pool) {
    try {
      const [orders, products, templates, audit, rects, config, cancellations] = await Promise.all([
        loadOrdersFromDb(pool, orgId).catch(() => null),
        loadProductsFromDb(pool, orgId).catch(() => null),
        loadTemplatesFromDb(pool, orgId).catch(() => null),
        loadAuditLogsFromDb(pool, orgId).catch(() => null),
        loadRectificationsFromDb(pool, orgId).catch(() => null),
        loadConfigFromDb(pool, orgId).catch(() => null),
        loadCancellationsFromDb(pool, orgId).catch(() => null)
      ]);

      const mergedState: Record<string, unknown> = { ...memoryState };
      if (orders && orders.length > 0) mergedState.cft_pos = orders;
      if (products && products.length > 0) mergedState.cft_products = products;
      if (templates && templates.length > 0) mergedState.cft_templates = templates;
      if (audit && audit.length > 0) mergedState.cft_audit = audit;
      if (rects && rects.length > 0) mergedState.cft_rectifications = rects;
      if (config) mergedState.cft_config = config;
      if (cancellations && cancellations.length > 0) mergedState.cft_cancellations = cancellations;

      memoryState = mergedState;
      res.json(memoryState);
      return;
    } catch {
      // Fallback seamlessly to memoryState
    }
  }

  res.json(memoryState);
});

app.put('/api/shared-state', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const update = req.body as Record<string, unknown>;
    if (!update || typeof update !== 'object') {
      res.status(400).json({ error: 'Invalid shared state payload' });
      return;
    }

    memoryState = {
      ...memoryState,
      ...update
    };

    scheduleStateSave();

    // Async sync to MySQL if connected
    void syncStateToMySql(orgId, update);

    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// 3. Purchase Orders REST Endpoints
// ---------------------------------------------------------------------------

app.get('/api/orders', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const pool = await getDbPool();
    if (pool) {
      try {
        const orders = await loadOrdersFromDb(pool, orgId);
        if (orders.length > 0) {
          res.json(orders);
          return;
        }
      } catch {}
    }
    const orders = (memoryState.cft_pos as PurchaseOrder[]) || [];
    res.json(orders);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders/:id', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    // Prefer MySQL when available so a restart/reload reflects committed rows.
    const pool = await getDbPool();
    if (pool) {
      try {
        const orders = await loadOrdersFromDb(pool, orgId);
        const found = orders.find(p => p.id === req.params.id || p.poNumber === req.params.id);
        if (found) {
          res.json(found);
          return;
        }
      } catch {
        // Fall through to memory below; DB errors must not mask memory state.
      }
    }
    const orders = (memoryState.cft_pos as PurchaseOrder[]) || [];
    const found = orders.find(p => p.id === req.params.id || p.poNumber === req.params.id);
    if (!found) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    res.json(found);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const newOrder = req.body as PurchaseOrder;
    if (!newOrder || !newOrder.id || !newOrder.poNumber) {
      res.status(400).json({ error: 'Missing required order fields (id, poNumber)' });
      return;
    }

    const currentOrders = ((memoryState.cft_pos as PurchaseOrder[]) || []).filter(o => o.id !== newOrder.id);
    const updated = [newOrder, ...currentOrders];
    memoryState.cft_pos = updated;
    scheduleStateSave();

    void syncStateToMySql(orgId, { cft_pos: updated });
    res.status(201).json(newOrder);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/orders/:id', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const orderUpdate = req.body as PurchaseOrder;
    const currentOrders = (memoryState.cft_pos as PurchaseOrder[]) || [];
    const idx = currentOrders.findIndex(o => o.id === req.params.id);

    if (idx < 0) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    currentOrders[idx] = { ...currentOrders[idx], ...orderUpdate, lastUpdatedAt: new Date().toISOString() };
    memoryState.cft_pos = currentOrders;
    scheduleStateSave();

    void syncStateToMySql(orgId, { cft_pos: currentOrders });
    res.json(currentOrders[idx]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/orders/:id', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const currentOrders = (memoryState.cft_pos as PurchaseOrder[]) || [];
    const filtered = currentOrders.filter(o => o.id !== req.params.id);

    memoryState.cft_pos = filtered;
    scheduleStateSave();

    // Delete from MySQL as well — memory-only delete resurrects on reload.
    const pool = await getDbPool();
    if (pool) {
      try {
        await deleteOrderFromDb(pool, orgId, req.params.id);
      } catch (err: any) {
        res.status(502).json({ error: `Memory updated but MySQL delete failed: ${err.message}` });
        return;
      }
    }

    void syncStateToMySql(orgId, { cft_pos: filtered });
    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 4. Products & Catalog Endpoints
// ---------------------------------------------------------------------------

app.get('/api/products', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const pool = await getDbPool();
    if (pool) {
      try {
        const prods = await loadProductsFromDb(pool, orgId);
        if (prods.length > 0) {
          res.json(prods);
          return;
        }
      } catch {}
    }
    res.json(memoryState.cft_products || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const prod = req.body as ProductMasterItem;
    const current = (memoryState.cft_products as ProductMasterItem[]) || [];
    const updated = [...current.filter(p => p.id !== prod.id), prod];
    memoryState.cft_products = updated;
    scheduleStateSave();
    void syncStateToMySql(orgId, { cft_products: updated });
    res.status(201).json(prod);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 5. Audit Log & Rectification Endpoints
// ---------------------------------------------------------------------------

app.get('/api/audit-log', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const pool = await getDbPool();
    if (pool) {
      try {
        const logs = await loadAuditLogsFromDb(pool, orgId);
        if (logs.length > 0) {
          res.json(logs);
          return;
        }
      } catch {}
    }
    res.json(memoryState.cft_audit || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/audit-log', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const entry = req.body as AuditLogEntry;
    const current = (memoryState.cft_audit as AuditLogEntry[]) || [];
    const updated = [entry, ...current];
    memoryState.cft_audit = updated;
    scheduleStateSave();
    void syncStateToMySql(orgId, { cft_audit: updated });
    res.status(201).json(entry);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rectifications', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const pool = await getDbPool();
    if (pool) {
      try {
        const rects = await loadRectificationsFromDb(pool, orgId);
        if (rects.length > 0) {
          res.json(rects);
          return;
        }
      } catch {}
    }
    res.json(memoryState.cft_rectifications || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 6. Templates, Config & Cancellation Endpoints
// ---------------------------------------------------------------------------

app.get('/api/templates', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const pool = await getDbPool();
    if (pool) {
      try {
        const tmpls = await loadTemplatesFromDb(pool, orgId);
        if (tmpls.length > 0) {
          res.json(tmpls);
          return;
        }
      } catch {}
    }
    res.json(memoryState.cft_templates || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/templates', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const tmpl = req.body as CategoryTemplate;
    const current = (memoryState.cft_templates as CategoryTemplate[]) || [];
    const updated = [...current.filter(t => t.id !== tmpl.id), tmpl];
    memoryState.cft_templates = updated;
    scheduleStateSave();
    void syncStateToMySql(orgId, { cft_templates: updated });
    res.status(201).json(tmpl);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const pool = await getDbPool();
    if (pool) {
      try {
        const cfg = await loadConfigFromDb(pool, orgId);
        if (cfg) {
          res.json(cfg);
          return;
        }
      } catch {}
    }
    res.json(memoryState.cft_config || { atRiskThresholdDays: 3, delayedThresholdDays: 7, offlineSyncQueue: [], enablePushNotifications: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/config', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const newCfg = req.body as SystemConfig;
    memoryState.cft_config = newCfg;
    scheduleStateSave();
    void syncStateToMySql(orgId, { cft_config: newCfg });
    res.json(newCfg);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cancellations', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const pool = await getDbPool();
    if (pool) {
      try {
        const cancs = await loadCancellationsFromDb(pool, orgId);
        if (cancs.length > 0) {
          res.json(cancs);
          return;
        }
      } catch {}
    }
    res.json(memoryState.cft_cancellations || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cancellations', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const cancellation = req.body as CancellationRequest;
    const current = (memoryState.cft_cancellations as CancellationRequest[]) || [];
    const updated = [cancellation, ...current.filter(c => c.id !== cancellation.id)];
    memoryState.cft_cancellations = updated;
    scheduleStateSave();
    void syncStateToMySql(orgId, { cft_cancellations: updated });
    res.status(201).json(cancellation);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 7. Database Schema Initialization & Status
// ---------------------------------------------------------------------------

app.post('/api/db/init-schema', async (_req: Request, res: Response) => {
  const pool = await getDbPool();
  if (!pool) {
    res.status(503).json({ error: 'MySQL is not configured or unavailable. Operating with local fallback.' });
    return;
  }

  try {
    const result = await initSchema(pool);
    res.json({ success: true, message: `Executed ${result.executedCount} statements successfully.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/db/status', async (_req: Request, res: Response) => {
  // Re-validates the pool so the endpoint never falsely claims MySQL is connected.
  await getDbPool();
  const connected = isDbConnected();
  res.json({
    connected,
    storageProvider: connected ? 'mysql' : 'memory-with-file-sync',
    stateKeysCount: Object.keys(memoryState).length,
    ordersCount: ((memoryState.cft_pos as any[]) || []).length,
    db: getSafeDbConfig()
  });
});

// ---------------------------------------------------------------------------
// Production Static Frontend Serving
// ---------------------------------------------------------------------------

const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, {
    maxAge: '1y',
    immutable: true,
    index: false
  }));

  app.use((req: Request, res: Response, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(path.join(distPath, 'index.html'));
    }
    next();
  });
}

// Start Server
const httpServer = app.listen(PORT, async () => {
  console.log(`====================================================`);
  console.log(`🚀 CFT Tracker Backend Server running on port ${PORT}`);
  console.log(`⚡ Mode: ${process.env.NODE_ENV || 'production'}`);
  console.log(`⚡ Compression: Enabled (gzip/brotli)`);
  console.log(`⚡ Static Client: ${fs.existsSync(distPath) ? 'Available (dist/)' : 'Not Built (run npm run build)'}`);
  console.log(`====================================================`);

  // Attempt background DB connection & auto-schema init
  try {
    const pool = await getDbPool();
    if (pool) {
      console.log(`[Database] Auto-verifying MySQL schema tables...`);
      await initSchema(pool);
      console.log(`[Database] Schema tables verified & ready.`);
    }
  } catch (err: any) {
    console.warn(`[Database] Background schema verification notice: ${err.message}`);
  }
});

// Graceful shutdown — releases pool resources on SIGINT/SIGTERM.
async function shutdown(signal: string): Promise<void> {
  console.log(`[Server] Received ${signal}, shutting down...`);
  httpServer.close(async () => {
    await closeDbPool();
    process.exit(0);
  });
  // Force exit if connections hang.
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
