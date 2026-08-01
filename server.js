const crypto = require('crypto');
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

function asPromise(db, method, sql, params = []) {
  return new Promise((resolve, reject) => {
    db[method](sql, params, function callback(error, value) {
      if (error) reject(error);
      else resolve(method === 'run' ? { lastID: this.lastID, changes: this.changes } : value);
    });
  });
}

function encodeInvoice(row) {
  if (!row) return null;
  return { ...row, items: JSON.parse(row.items || '[]') };
}

function createDatabase(dbFile) {
  const db = new sqlite3.Database(dbFile);
  db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON');
    db.run(`CREATE TABLE IF NOT EXISTS device_identity (
      id INTEGER PRIMARY KEY CHECK (id = 1), device_code TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS invoice_sequences (
      user_id TEXT NOT NULL, invoice_day TEXT NOT NULL, next_value INTEGER NOT NULL,
      PRIMARY KEY (user_id, invoice_day)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, inv_no TEXT NOT NULL,
      invoice_day TEXT NOT NULL, bill_to TEXT NOT NULL, items TEXT NOT NULL,
      tax_pct REAL NOT NULL, subtotal REAL NOT NULL, tax REAL NOT NULL, total REAL NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, firebase_update_time TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending', UNIQUE(user_id, inv_no)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS drafts (
      user_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL,
      firebase_update_time TEXT, sync_status TEXT NOT NULL DEFAULT 'pending'
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, operation TEXT NOT NULL, queued_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
      UNIQUE(user_id, entity_type, entity_id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS conflict_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, local_payload TEXT NOT NULL, remote_payload TEXT,
      created_at TEXT NOT NULL, resolved_at TEXT, resolution TEXT
    )`);
  });
  return db;
}

async function getDeviceCode(db) {
  const existing = await asPromise(db, 'get', 'SELECT device_code FROM device_identity WHERE id = 1');
  if (existing) return existing.device_code;
  const deviceCode = crypto.randomBytes(3).toString('hex').toUpperCase();
  await asPromise(db, 'run', 'INSERT INTO device_identity (id, device_code) VALUES (1, ?)', [deviceCode]);
  return deviceCode;
}

function validateUserId(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) throw new Error('A valid signed-in user is required.');
  return value;
}

function createLocalApp({ dbFile, clientSecret, publicDir, firebaseConfigProvider }) {
  const db = createDatabase(dbFile);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', (req, res, next) => {
    if (!clientSecret || req.get('x-chillara-secret') !== clientSecret) return res.status(403).json({ error: 'Local API access denied.' });
    next();
  });

  const enqueue = async (userId, entityType, entityId, operation = 'upsert') => {
    await asPromise(db, 'run', `INSERT INTO sync_queue (user_id, entity_type, entity_id, operation, queued_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, entity_type, entity_id)
      DO UPDATE SET operation = excluded.operation, queued_at = excluded.queued_at, last_error = NULL`,
      [userId, entityType, entityId, operation, new Date().toISOString()]);
  };

  app.get('/api/invoices', async (req, res, next) => {
    try {
      const userId = validateUserId(req.query.userId);
      const rows = await asPromise(db, 'all', 'SELECT * FROM invoices WHERE user_id = ? ORDER BY invoice_day DESC, created_at DESC', [userId]);
      res.json(rows.map(encodeInvoice));
    } catch (error) { next(error); }
  });
  app.get('/api/invoices/:id', async (req, res, next) => {
    try { res.json(encodeInvoice(await asPromise(db, 'get', 'SELECT * FROM invoices WHERE id = ? AND user_id = ?', [req.params.id, validateUserId(req.query.userId)]))); }
    catch (error) { next(error); }
  });
  app.post('/api/invoices', async (req, res, next) => {
    try {
      const userId = validateUserId(req.body.userId);
      const payload = req.body.payload || {};
      const day = /^\d{4}-\d{2}-\d{2}$/.test(payload.date) ? payload.date : new Date().toISOString().slice(0, 10);
      const items = Array.isArray(payload.items) ? payload.items.slice(0, 100) : [];
      const subtotal = items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.rate) || 0), 0);
      const taxPct = Math.max(0, Math.min(100, Number(payload.taxPct) || 0));
      const now = new Date().toISOString();
      const deviceCode = await getDeviceCode(db);
      await asPromise(db, 'run', 'BEGIN IMMEDIATE');
      try {
        const sequence = await asPromise(db, 'get', 'SELECT next_value FROM invoice_sequences WHERE user_id = ? AND invoice_day = ?', [userId, day]);
        const number = sequence ? sequence.next_value : 1;
        await asPromise(db, 'run', `INSERT INTO invoice_sequences (user_id, invoice_day, next_value) VALUES (?, ?, ?)
          ON CONFLICT(user_id, invoice_day) DO UPDATE SET next_value = excluded.next_value`, [userId, day, number + 1]);
        const id = crypto.randomUUID();
        const invNo = `INV-${day.replace(/-/g, '')}-${deviceCode}-${String(number).padStart(3, '0')}`;
        const tax = subtotal * taxPct / 100;
        await asPromise(db, 'run', `INSERT INTO invoices (id, user_id, inv_no, invoice_day, bill_to, items, tax_pct, subtotal, tax, total, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, userId, invNo, day, String(payload.billTo || '').slice(0, 4000), JSON.stringify(items), taxPct, subtotal, tax, subtotal + tax, now, now]);
        await enqueue(userId, 'invoice', id);
        await asPromise(db, 'run', 'COMMIT');
        res.status(201).json(encodeInvoice(await asPromise(db, 'get', 'SELECT * FROM invoices WHERE id = ?', [id])));
      } catch (error) { await asPromise(db, 'run', 'ROLLBACK').catch(() => {}); throw error; }
    } catch (error) { next(error); }
  });
  app.post('/api/invoices/import', async (req, res, next) => {
    try {
      const userId = validateUserId(req.body.userId);
      const invoices = Array.isArray(req.body.invoices) ? req.body.invoices.slice(0, 1000) : [];
      for (const invoice of invoices) {
        if (!invoice?.id || !invoice.invNo || !invoice.date) continue;
        const now = invoice.updatedAt || invoice.createdAt || new Date().toISOString();
        await asPromise(db, 'run', `INSERT OR IGNORE INTO invoices (id, user_id, inv_no, invoice_day, bill_to, items, tax_pct, subtotal, tax, total, created_at, updated_at, firebase_update_time, sync_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`,
          [String(invoice.id), userId, String(invoice.invNo), String(invoice.date), String(invoice.billTo || ''), JSON.stringify(Array.isArray(invoice.items) ? invoice.items : []), Number(invoice.taxPct) || 0, Number(invoice.subtotal) || 0, Number(invoice.tax) || 0, Number(invoice.total) || 0, String(invoice.createdAt || now), String(invoice.updatedAt || now), invoice.firebaseUpdateTime || null]);
      }
      res.sendStatus(204);
    } catch (error) { next(error); }
  });
  app.get('/api/draft', async (req, res, next) => {
    try { const row = await asPromise(db, 'get', 'SELECT payload FROM drafts WHERE user_id = ?', [validateUserId(req.query.userId)]); res.json(row ? JSON.parse(row.payload) : null); }
    catch (error) { next(error); }
  });
  app.put('/api/draft', async (req, res, next) => {
    try { const userId = validateUserId(req.body.userId); await asPromise(db, 'run', `INSERT INTO drafts (user_id, payload, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`, [userId, JSON.stringify(req.body.payload || {}), new Date().toISOString()]); res.sendStatus(204); }
    catch (error) { next(error); }
  });
  app.delete('/api/draft', async (req, res, next) => {
    try { await asPromise(db, 'run', 'DELETE FROM drafts WHERE user_id = ?', [validateUserId(req.query.userId)]); res.sendStatus(204); }
    catch (error) { next(error); }
  });
  app.get('/api/profile', async (req, res, next) => {
    try { const row = await asPromise(db, 'get', 'SELECT payload FROM profiles WHERE user_id = ?', [validateUserId(req.query.userId)]); res.json(row ? JSON.parse(row.payload) : null); }
    catch (error) { next(error); }
  });
  app.put('/api/profile', async (req, res, next) => {
    try { const userId = validateUserId(req.body.userId); const now = new Date().toISOString(); await asPromise(db, 'run', `INSERT INTO profiles (user_id, payload, updated_at) VALUES (?, ?, ?, 'pending')
      ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at, sync_status = 'pending'`, [userId, JSON.stringify(req.body.payload || {}), now]); await enqueue(userId, 'profile', 'profile'); res.sendStatus(204); }
    catch (error) { next(error); }
  });
  app.get('/api/sync/pending', async (req, res, next) => {
    try {
      const userId = validateUserId(req.query.userId);
      const queue = await asPromise(db, 'all', 'SELECT * FROM sync_queue WHERE user_id = ? ORDER BY queued_at', [userId]);
      const jobs = await Promise.all(queue.map(async (job) => {
        const row = job.entity_type === 'invoice'
          ? await asPromise(db, 'get', 'SELECT * FROM invoices WHERE id = ? AND user_id = ?', [job.entity_id, userId])
          : await asPromise(db, 'get', 'SELECT * FROM profiles WHERE user_id = ?', [userId]);
        return { ...job, payload: job.entity_type === 'invoice' ? encodeInvoice(row) : row && JSON.parse(row.payload), firebaseUpdateTime: row && row.firebase_update_time };
      }));
      res.json(jobs.filter((job) => job.payload));
    } catch (error) { next(error); }
  });
  app.post('/api/sync/result', async (req, res, next) => {
    try {
      const { userId, entityType, entityId, status, firebaseUpdateTime, remotePayload, error } = req.body;
      validateUserId(userId);
      if (!['synced', 'conflict', 'failed'].includes(status)) throw new Error('Invalid sync status.');
      if (status === 'conflict') await asPromise(db, 'run', `INSERT INTO conflict_revisions (user_id, entity_type, entity_id, local_payload, remote_payload, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`, [userId, entityType, entityId, JSON.stringify(req.body.localPayload || {}), JSON.stringify(remotePayload || null), new Date().toISOString()]);
      if (entityType === 'invoice') await asPromise(db, 'run', 'UPDATE invoices SET sync_status = ?, firebase_update_time = COALESCE(?, firebase_update_time) WHERE id = ? AND user_id = ?', [status, firebaseUpdateTime || null, entityId, userId]);
      else await asPromise(db, 'run', 'UPDATE profiles SET sync_status = ?, firebase_update_time = COALESCE(?, firebase_update_time) WHERE user_id = ?', [status, firebaseUpdateTime || null, userId]);
      if (status === 'synced' || status === 'conflict') await asPromise(db, 'run', 'DELETE FROM sync_queue WHERE user_id = ? AND entity_type = ? AND entity_id = ?', [userId, entityType, entityId]);
      else await asPromise(db, 'run', 'UPDATE sync_queue SET attempts = attempts + 1, last_error = ? WHERE user_id = ? AND entity_type = ? AND entity_id = ?', [String(error || '').slice(0, 500), userId, entityType, entityId]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });
  app.get('/api/conflicts', async (req, res, next) => {
    try { res.json(await asPromise(db, 'all', 'SELECT * FROM conflict_revisions WHERE user_id = ? AND resolved_at IS NULL ORDER BY created_at DESC', [validateUserId(req.query.userId)])); }
    catch (error) { next(error); }
  });
  app.post('/api/conflicts/:id/resolve', async (req, res, next) => {
    try { await asPromise(db, 'run', 'UPDATE conflict_revisions SET resolved_at = ?, resolution = ? WHERE id = ? AND user_id = ?', [new Date().toISOString(), String(req.body.resolution || 'kept-local'), req.params.id, validateUserId(req.body.userId)]); res.sendStatus(204); }
    catch (error) { next(error); }
  });
  app.get('/firebase-config.json', (req, res) => { const config = firebaseConfigProvider && firebaseConfigProvider(); if (!config) return res.status(404).json({ error: 'Firebase configuration is unavailable.' }); res.set('Cache-Control', 'no-store').json(config); });
  app.use(express.static(publicDir));
  app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  app.use((error, req, res, next) => { console.error(error); res.status(400).json({ error: error.message || 'Local storage request failed.' }); });
  return { app, db };
}

function startLocalServer(options) {
  const { app, db } = createLocalApp(options);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, db, port: server.address().port }));
    server.once('error', reject);
  });
}

if (require.main === module) {
  const root = __dirname;
  startLocalServer({ dbFile: path.join(root, 'invoices.db'), clientSecret: process.env.CHILLARA_LOCAL_SECRET || 'development-only-secret', publicDir: path.join(root, 'public') })
    .then(({ port }) => console.log(`Chillara Illa running at http://127.0.0.1:${port}`))
    .catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { createLocalApp, startLocalServer };
