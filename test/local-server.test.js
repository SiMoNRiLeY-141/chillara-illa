const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { startLocalServer } = require('../server');

test('local storage allocates device-scoped invoice numbers and queues work', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chillara-test-'));
  const secret = 'test-secret';
  const { server, db, port } = await startLocalServer({ dbFile: path.join(dir, 'invoices.db'), clientSecret: secret, publicDir: path.join(__dirname, '../public') });
  t.after(() => server.close(() => db.close(() => fs.rmSync(dir, { recursive: true, force: true }))));
  const request = async (url, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, { ...options, headers: { 'x-chillara-secret': secret, 'content-type': 'application/json' } });
    if (!response.ok) assert.fail(await response.text());
    return response.status === 204 ? null : response.json();
  };
  const payload = { date: '2026-08-01', billTo: 'Test', items: [{ desc: 'Item', qty: 2, rate: 10 }], taxPct: 5 };
  const first = await request('/api/invoices', { method: 'POST', body: JSON.stringify({ userId: 'user-a', payload }) });
  const second = await request('/api/invoices', { method: 'POST', body: JSON.stringify({ userId: 'user-a', payload }) });
  assert.match(first.inv_no, /^INV-20260801-[A-F0-9]{6}-001$/);
  assert.match(second.inv_no, /^INV-20260801-[A-F0-9]{6}-002$/);
  assert.equal(first.total, 21);
  const jobs = await request('/api/sync/pending?userId=user-a');
  assert.equal(jobs.length, 2);
});

test('the local API rejects callers without the per-launch secret', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chillara-test-'));
  const { server, db, port } = await startLocalServer({ dbFile: path.join(dir, 'invoices.db'), clientSecret: 'secret', publicDir: path.join(__dirname, '../public') });
  t.after(() => server.close(() => db.close(() => fs.rmSync(dir, { recursive: true, force: true }))));
  const response = await fetch(`http://127.0.0.1:${port}/api/invoices?userId=user-a`);
  assert.equal(response.status, 403);
});
