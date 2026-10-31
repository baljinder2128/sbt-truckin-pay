// SQLite storage (built into Node 22+, no native build needed)
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// On Railway, always keep data on the attached volume so a new deploy can't wipe it.
const VOLUME_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '';
const DATA_DIR = VOLUME_DIR || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ON_RAILWAY = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
// Render's free disk is wiped on restart; there the online copy (DATABASE_URL) keeps the data instead.
const STORAGE_SAFE = (!ON_RAILWAY || !!VOLUME_DIR) && !process.env.RENDER;
for (const d of ['', 'uploads', 'rcti', 'outbox', 'branding']) fs.mkdirSync(path.join(DATA_DIR, d), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'sbt-pay.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('office','driver')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  -- driver pay + RCTI details (office editable)
  hourly_rate REAL NOT NULL DEFAULT 0,
  business_name TEXT,
  abn TEXT,
  gst_registered INTEGER NOT NULL DEFAULT 1,
  address TEXT,
  bank_account_name TEXT,
  bank_bsb TEXT,
  bank_account_number TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  file_path TEXT NOT NULL,
  mime TEXT,
  extracted_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rctis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  driver_id INTEGER NOT NULL REFERENCES users(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  total_hours REAL NOT NULL,
  subtotal REAL NOT NULL,
  gst REAL NOT NULL,
  total REAL NOT NULL,
  pdf_path TEXT,
  office_emailed_at TEXT,
  pushed_at TEXT,
  paid_at TEXT,
  payment_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runsheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id INTEGER NOT NULL REFERENCES users(id),
  work_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  finish_time TEXT NOT NULL,
  breaks_json TEXT NOT NULL DEFAULT '[]',
  break_minutes INTEGER NOT NULL DEFAULT 0,
  hours REAL NOT NULL,
  rate REAL NOT NULL,
  amount REAL NOT NULL,
  truck_rego TEXT,
  notes TEXT,
  office_notes TEXT,
  photo_path TEXT,
  extracted_json TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected')),
  rcti_id INTEGER REFERENCES rctis(id) ON DELETE SET NULL,
  office_emailed_at TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_runsheets_driver_date ON runsheets(driver_id, work_date);

-- Days the office marked as a day off, so the week and the RCTI show them.
CREATE TABLE IF NOT EXISTS days_off (
  driver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  PRIMARY KEY (driver_id, work_date)
);

CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Columns added after the first release.
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
for (const [col, type] of [['licence_number', 'TEXT'], ['licence_expiry', 'TEXT'], ['licence_front', 'TEXT'], ['licence_back', 'TEXT'], ['licence_reminded_for', 'TEXT']]) {
  if (!userCols.includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
}
fs.mkdirSync(path.join(DATA_DIR, 'licences'), { recursive: true });

const DEFAULT_SETTINGS = {
  company_name: 'SB Truckin Pty Ltd',
  company_abn: '62 604 022 255',
  company_address: '',
  company_phone: '',
  company_email: 'baljinder2128@gmail.com',
  office_email: 'baljinder2128@gmail.com',
  rcti_prefix: 'RCTI-',
  rcti_next_number: '1001',
  payment_terms: 'Payment by EFT to the nominated account within 7 days of the RCTI issue date.',
  rcti_agreement:
    'The recipient and the supplier declare that this agreement relates to the above supplies. The recipient can issue tax invoices in respect of these supplies. The supplier will not issue tax invoices in respect of these supplies. The supplier acknowledges that it is registered for GST and that it will notify the recipient if it ceases to be registered. The recipient acknowledges that it is registered for GST and that it will notify the supplier if it ceases to be registered.',
  auto_weekly_rcti: '1',
  auto_email_runsheets: '1',
  logo_path: '',
  last_auto_rcti_week: '',
  smtp_host: 'smtp.gmail.com',
  smtp_port: '465',
  smtp_user: 'baljinder2128@gmail.com',
  smtp_pass: '',
  brevo_api_key: '',
  licence_reminder_email: 'sbtruckin@outlook.com',
};
const insertDefault = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertDefault.run(k, v);

// Move installs still on the first Gmail address (it couldn't be recovered) to the new one, unless changed by hand.
for (const k of ['smtp_user', 'company_email', 'office_email']) {
  db.prepare("UPDATE settings SET value = 'baljinder2128@gmail.com' WHERE key = ? AND value = 'sbtpayadvice@gmail.com'").run(k);
}

function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value ?? ''));
}

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, DATA_DIR, STORAGE_SAFE, getSettings, setSetting, tx };
