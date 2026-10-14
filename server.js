const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const DB_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DB_DIR, { recursive: true });

if (!ADMIN_PASSWORD || !SESSION_SECRET) {
  console.error('Set ADMIN_PASSWORD and SESSION_SECRET environment variables before starting.');
  process.exit(1);
}

const db = new Database(path.join(DB_DIR, 'parceltrack.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_number TEXT UNIQUE NOT NULL,
  contents TEXT NOT NULL DEFAULT 'Not specified',
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Shipment information received',
  eta TEXT DEFAULT '',
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  event_date TEXT NOT NULL,
  location TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
`);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(session({
  name: 'parceltrack.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  }
}));
app.use('/api/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));

const now = () => new Date().toISOString();
const clean = (v, max=300) => String(v ?? '').trim().slice(0, max);
const isAdmin = (req, res, next) => {
  if (req.session && req.session.admin === true) return next();
  return res.status(401).json({ error: 'Please sign in to manage shipments.' });
};
const getShipment = db.prepare('SELECT * FROM shipments WHERE tracking_number = ?');
const getEvents = db.prepare('SELECT event_date, location, title, details FROM events WHERE shipment_id = ? ORDER BY sort_order ASC, id ASC');
function shipmentOutput(row) {
  if (!row) return null;
  return { trackingNumber: row.tracking_number, contents: row.contents, origin: row.origin,
    destination: row.destination, status: row.status, eta: row.eta, updatedAt: row.updated_at,
    events: getEvents.all(row.id) };
}

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/login', (req, res) => {
  const username = clean(req.body.username, 100);
  const password = String(req.body.password ?? '');
  const userOk = username === ADMIN_USER;
  const passOk = crypto.timingSafeEqual(
    Buffer.from(crypto.createHash('sha256').update(password).digest('hex')),
    Buffer.from(crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex'))
  );
  if (!userOk || !passOk) return res.status(401).json({ error: 'Incorrect username or password.' });
  req.session.admin = true;
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/session', (req, res) => res.json({ authenticated: !!req.session?.admin }));

app.get('/api/track/:trackingNumber', (req, res) => {
  const number = clean(req.params.trackingNumber, 80).toUpperCase();
  const row = getShipment.get(number);
  if (!row) return res.status(404).json({ error: 'No shipment was found for that tracking number. Check the number and try again.' });
  res.json(shipmentOutput(row));
});

app.get('/api/admin/shipments', isAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM shipments ORDER BY updated_at DESC').all();
  res.json(rows.map(shipmentOutput));
});

app.post('/api/admin/shipments', isAdmin, (req, res) => {
  const trackingNumber = clean(req.body.trackingNumber, 80).toUpperCase();
  const contents = clean(req.body.contents || 'Not specified', 300);
  const origin = clean(req.body.origin, 200);
  const destination = clean(req.body.destination, 200);
  const status = clean(req.body.status || 'Shipment information received', 100);
  const eta = clean(req.body.eta, 100);
  const events = Array.isArray(req.body.events) ? req.body.events.slice(0, 100) : [];
  if (!trackingNumber || !origin || !destination) return res.status(400).json({ error: 'Tracking number, origin, and destination are required.' });
  if (!/^[A-Z0-9-]{4,80}$/.test(trackingNumber)) return res.status(400).json({ error: 'Use 4–80 letters, numbers, or hyphens for the tracking number.' });
  try {
    const timestamp = now();
    const tx = db.transaction(() => {
      const result = db.prepare(`INSERT INTO shipments (tracking_number, contents, origin, destination, status, eta, updated_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(trackingNumber, contents, origin, destination, status, eta, timestamp, timestamp);
      const insertEvent = db.prepare(`INSERT INTO events (shipment_id, event_date, location, title, details, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)`);
      events.forEach((e, i) => {
        const date = clean(e.date, 100), location = clean(e.location, 200), title = clean(e.title, 160), details = clean(e.details, 500);
        if (date && location && title) insertEvent.run(result.lastInsertRowid, date, location, title, details, i);
      });
      return result.lastInsertRowid;
    });
    tx();
    res.status(201).json(shipmentOutput(getShipment.get(trackingNumber)));
  } catch (err) {
    if (String(err).includes('UNIQUE')) return res.status(409).json({ error: 'That tracking number already exists. Choose a different one.' });
    res.status(500).json({ error: 'Could not save shipment.' });
  }
});

app.put('/api/admin/shipments/:trackingNumber', isAdmin, (req, res) => {
  const number = clean(req.params.trackingNumber, 80).toUpperCase();
  const row = getShipment.get(number);
  if (!row) return res.status(404).json({ error: 'Shipment not found.' });
  const contents = clean(req.body.contents ?? row.contents, 300);
  const origin = clean(req.body.origin ?? row.origin, 200);
  const destination = clean(req.body.destination ?? row.destination, 200);
  const status = clean(req.body.status ?? row.status, 100);
  const eta = clean(req.body.eta ?? row.eta, 100);
  const events = Array.isArray(req.body.events) ? req.body.events.slice(0, 100) : null;
  const tx = db.transaction(() => {
    db.prepare('UPDATE shipments SET contents=?, origin=?, destination=?, status=?, eta=?, updated_at=? WHERE id=?')
      .run(contents, origin, destination, status, eta, now(), row.id);
    if (events) {
      db.prepare('DELETE FROM events WHERE shipment_id=?').run(row.id);
      const insertEvent = db.prepare(`INSERT INTO events (shipment_id, event_date, location, title, details, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)`);
      events.forEach((e, i) => {
        const date = clean(e.date, 100), location = clean(e.location, 200), title = clean(e.title, 160), details = clean(e.details, 500);
        if (date && location && title) insertEvent.run(row.id, date, location, title, details, i);
      });
    }
  });
  tx();
  res.json(shipmentOutput(getShipment.get(number)));
});

app.delete('/api/admin/shipments/:trackingNumber', isAdmin, (req, res) => {
  const number = clean(req.params.trackingNumber, 80).toUpperCase();
  const result = db.prepare('DELETE FROM shipments WHERE tracking_number=?').run(number);
  if (!result.changes) return res.status(404).json({ error: 'Shipment not found.' });
  res.json({ ok: true });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`ParcelTrack listening on port ${PORT}`));
