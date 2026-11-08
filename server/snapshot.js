// Free hosts like Render wipe the disk on every restart. When DATABASE_URL points at a Postgres database
// (Neon's free plan works), the whole app (database + PDFs + photos) is copied there a few seconds after
// every change, and copied back when the app starts on an empty disk.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');
const { makeBackup, restoreBackup } = require('./backup');

const URL = process.env.DATABASE_URL || '';
const enabled = !!URL;
const MARKER = path.join(DATA_DIR, '.snapshot-loaded');
let pool = null;
let timer = null;
let saving = null;
let dirty = false;
let lastSaved = null;
// Never save until the online copy has been loaded, or an empty disk would overwrite the real data.
let ready = false;

function client() {
  if (!pool) {
    const { Pool } = require('pg');
    // Encryption is set here, so drop sslmode from the link (pg prints a warning about how it reads that setting).
    const conn = URL.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '');
    pool = new Pool({ connectionString: conn, max: 2, connectionTimeoutMillis: 15000, query_timeout: 60000, ssl: /sslmode=disable/.test(URL) ? false : { rejectUnauthorized: false } });
  }
  return pool;
}
async function ensureTable() {
  await client().query('CREATE TABLE IF NOT EXISTS app_snapshot (id INTEGER PRIMARY KEY, data BYTEA NOT NULL, saved_at TIMESTAMPTZ NOT NULL DEFAULT now())');
}

// On start: if this disk hasn't loaded the online copy yet, load it (a fresh Render instance has an empty disk).
async function boot() {
  if (!enabled) return null;
  await ensureTable();
  if (fs.existsSync(MARKER)) { ready = true; return null; }
  const r = await client().query('SELECT data, saved_at FROM app_snapshot WHERE id = 1');
  let out = null;
  if (r.rows.length) {
    out = restoreBackup(r.rows[0].data);
    lastSaved = r.rows[0].saved_at;
    console.log(`Loaded saved data from ${r.rows[0].saved_at.toISOString()}: ${out.drivers} drivers, ${out.rctis} RCTIs`);
  } else {
    console.log('No saved data online yet; starting fresh and saving from now on.');
  }
  fs.writeFileSync(MARKER, new Date().toISOString());
  ready = true;
  if (!r.rows.length) schedule(0);
  return out;
}

// If the online database can't be reached at start, keep trying in the background; saving stays off until it loads.
function retryBoot(onLoaded, ms = 30000) {
  setTimeout(async () => {
    try { const out = await boot(); onLoaded(out); console.log('Online copy reached; saving is on again.'); }
    catch (e) { console.error('Still cannot reach DATABASE_URL:', e.message); retryBoot(onLoaded, ms); }
  }, ms).unref();
}

async function saveNow() {
  if (!enabled || !ready) return;
  if (saving) { dirty = true; return saving; }
  dirty = false;
  saving = (async () => {
    let failed = false;
    try {
      const buf = makeBackup();
      await client().query('INSERT INTO app_snapshot (id, data, saved_at) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, saved_at = now()', [buf]);
      lastSaved = new Date();
    } catch (e) {
      console.error('Saving online copy failed, will retry:', e.message);
      dirty = true; failed = true;
    } finally {
      saving = null;
    }
    if (dirty) schedule(failed ? 15000 : 3000);
  })();
  return saving;
}

// Coalesce bursts of changes into one save.
function schedule(ms = 3000) {
  if (!enabled) return;
  clearTimeout(timer);
  timer = setTimeout(saveNow, ms);
}

async function flush() {
  if (!enabled) return;
  clearTimeout(timer);
  await saveNow();
  if (saving) await saving;
}

module.exports = { enabled, boot, retryBoot, schedule, flush, saveNow, status: () => ({ enabled, ready, last_saved: lastSaved }) };
