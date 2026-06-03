const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'invoices.db');

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin === 'null' || origin.startsWith('file://') || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
app.use(bodyParser.json({ limit: '2mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static UI files from public folder
app.use('/', express.static(path.join(__dirname, 'public')));

// Serve index.html or redirect
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/', (req, res) => {
  res.redirect('/index.html');
});

// Ensure DB exists and schema
function initDb() {
  const db = new sqlite3.Database(DB_FILE);
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invNo TEXT UNIQUE,
      date TEXT,
      billTo TEXT,
      items TEXT,
      taxPct REAL,
      subtotal REAL,
      tax REAL,
      total REAL,
      createdAt TEXT
    )`);
  });
  return db;
}

const db = initDb();

// Save invoice (create)
app.post('/api/invoices', (req, res) => {
  const payload = req.body || {};
  const date = payload.date || new Date().toISOString().slice(0,10);
  const billTo = payload.billTo || '';
  const items = JSON.stringify(payload.items || []);
  const taxPct = Number(payload.taxPct) || 0;
  let subtotal = Number(payload.subtotal);
  if (isNaN(subtotal)) {
    subtotal = 0;
    try { JSON.parse(items).forEach(i=> subtotal += (Number(i.qty)||0)*(Number(i.rate)||0)); } catch(e){}
  }
  const tax = subtotal * (taxPct/100);
  const total = subtotal + tax;
  const invNoProvided = payload.invNo && payload.invNo.trim().length > 0;
  const createdAt = new Date().toISOString();

  const stmt = db.prepare(`INSERT INTO invoices (invNo,date,billTo,items,taxPct,subtotal,tax,total,createdAt) VALUES (?,?,?,?,?,?,?,?,?)`);
  stmt.run(invNoProvided ? payload.invNo : null, date, billTo, items, taxPct, subtotal, tax, total, createdAt, function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    const id = this.lastID;
    if (!invNoProvided) {
      // generate invoice number based on id
      const d = new Date(date);
      const ymd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
      const newInv = `INV-${ymd}-${String(id).padStart(3,'0')}`;
      db.run(`UPDATE invoices SET invNo = ? WHERE id = ?`, [newInv, id], function(uerr) {
        if (uerr) console.error('Failed to update invNo', uerr.message);
        db.get(`SELECT * FROM invoices WHERE id = ?`, [id], (gerr, row)=>{
          if (gerr) { res.status(500).json({error: gerr.message}); return; }
          row.items = JSON.parse(row.items || '[]');
          res.json(row);
        });
      });
    } else {
      db.get(`SELECT * FROM invoices WHERE id = ?`, [id], (gerr, row)=>{
        if (gerr) { res.status(500).json({error: gerr.message}); return; }
        row.items = JSON.parse(row.items || '[]');
        res.json(row);
      });
    }
  });
  stmt.finalize();
});

// List invoices with optional filters
app.get('/api/invoices', (req, res) => {
  const from = req.query.from || null;
  const to = req.query.to || null;
  const invNo = req.query.invNo || null;
  let sql = 'SELECT * FROM invoices WHERE 1=1';
  const params = [];
  if (from) { sql += ' AND date >= ?'; params.push(from); }
  if (to) { sql += ' AND date <= ?'; params.push(to); }
  if (invNo) { sql += ' AND invNo LIKE ?'; params.push('%'+invNo+'%'); }
  sql += ' ORDER BY date DESC, id DESC LIMIT 1000';

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    rows.forEach(r=> r.items = JSON.parse(r.items||'[]'));
    res.json(rows);
  });
});

// Get single invoice
app.get('/api/invoices/:id', (req, res) => {
  const id = Number(req.params.id);
  db.get('SELECT * FROM invoices WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Not found' });
    row.items = JSON.parse(row.items||'[]');
    res.json(row);
  });
});

// Export CSV
app.get('/api/export', (req, res) => {
  db.all('SELECT * FROM invoices ORDER BY id', [], (err, rows) => {
    if (err) return res.status(500).send(err.message);
    const cols = ['id','invNo','date','billTo','subtotal','taxPct','tax','total','createdAt'];
    const lines = [cols.join(',')];
    rows.forEach(r=>{
      const vals = cols.map(c=> {
        let val = '';
        if (c === 'id') val = r.id;
        else if (c === 'invNo') val = r.invNo;
        else if (c === 'date') val = r.date;
        else if (c === 'billTo') val = r.billTo;
        else if (c === 'subtotal') val = r.subtotal;
        else if (c === 'taxPct') val = r.taxPct;
        else if (c === 'tax') val = r.tax;
        else if (c === 'total') val = r.total;
        else if (c === 'createdAt') val = r.createdAt;
        return '"'+ String((val||'')).replace(/"/g,'""') +'"';
      });
      lines.push(vals.join(','));
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="invoices.csv"');
    res.send(lines.join('\n'));
  });
});

// Serve the git-ignored Firebase configuration file
app.get('/firebase-config.json', (req, res) => {
  const configPath = path.join(__dirname, 'firebase-config.json');
  if (fs.existsSync(configPath)) {
    res.sendFile(configPath);
  } else {
    res.status(404).json({ error: 'Firebase configuration file not found.' });
  }
});

app.listen(PORT, () => {
  console.log(`Chillara Illa billing server running at http://localhost:${PORT}`);
});

module.exports = { DB_FILE };
