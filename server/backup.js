// One file holds the database and every PDF and photo. Used for the Settings backup/restore buttons
// and for keeping a copy in an online database on hosts whose disk is wiped on restart.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { db, DATA_DIR } = require('./db');

const BACKUP_DIRS = ['uploads', 'rcti', 'branding', 'licences'];

function walk(dir) {
  const out = [];
  if (!fs.existsSync(path.join(DATA_DIR, dir))) return out;
  for (const e of fs.readdirSync(path.join(DATA_DIR, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(rel)); else if (e.isFile()) out.push(rel);
  }
  return out;
}

// Gzipped JSON: the database (a consistent copy) plus every file, base64.
function makeBackup() {
  const tmp = path.join(DATA_DIR, `backup-${Date.now()}-${process.pid}.db`);
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  try {
    const files = {};
    for (const d of BACKUP_DIRS) for (const rel of walk(d)) files[rel.split(path.sep).join('/')] = fs.readFileSync(path.join(DATA_DIR, rel)).toString('base64');
    return zlib.gzipSync(JSON.stringify({ app: 'sbt-truckin-pay', version: 1, created_at: new Date().toISOString(), db: fs.readFileSync(tmp).toString('base64'), files }));
  } finally { fs.rmSync(tmp, { force: true }); }
}

// Replaces every table's rows and writes the files back. Columns are matched by name,
// so a backup from an older version of the app still restores.
function restoreBackup(buf) {
  let b;
  try { b = JSON.parse(zlib.gunzipSync(buf).toString()); } catch { b = null; }
  if (!b || b.app !== 'sbt-truckin-pay' || !b.db) throw Object.assign(new Error('That file is not an SB Truckin pay backup'), { status: 400 });
  const tmp = path.join(DATA_DIR, `restore-${Date.now()}.db`);
  fs.writeFileSync(tmp, Buffer.from(b.db, 'base64'));
  const counts = {};
  try {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`ATTACH DATABASE '${tmp.replace(/'/g, "''")}' AS r`);
    const theirs = db.prepare("SELECT name FROM r.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((x) => x.name);
    const ours = db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((x) => x.name);
    db.exec('BEGIN');
    try {
      for (const t of ours) {
        db.exec(`DELETE FROM main."${t}"`);
        if (!theirs.includes(t)) continue;
        const mine = db.prepare(`PRAGMA main.table_info("${t}")`).all().map((c) => c.name);
        const cols = db.prepare(`PRAGMA r.table_info("${t}")`).all().map((c) => c.name).filter((c) => mine.includes(c)).map((c) => `"${c}"`).join(', ');
        db.exec(`INSERT INTO main."${t}" (${cols}) SELECT ${cols} FROM r."${t}"`);
        counts[t] = db.prepare(`SELECT COUNT(*) n FROM main."${t}"`).get().n;
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  } finally {
    try { db.exec('DETACH DATABASE r'); } catch {}
    db.exec('PRAGMA foreign_keys = ON');
    fs.rmSync(tmp, { force: true });
  }
  for (const [rel, data] of Object.entries(b.files || {})) {
    const norm = path.normalize(rel);
    if (norm.startsWith('..') || path.isAbsolute(norm) || !BACKUP_DIRS.includes(norm.split(path.sep)[0])) continue;
    fs.mkdirSync(path.dirname(path.join(DATA_DIR, norm)), { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, norm), Buffer.from(data, 'base64'));
  }
  return {
    drivers: db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'driver'").get().n,
    rctis: counts.rctis || 0, runsheets: counts.runsheets || 0, files: Object.keys(b.files || {}).length, created_at: b.created_at,
  };
}

module.exports = { makeBackup, restoreBackup };
