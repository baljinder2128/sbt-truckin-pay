// Desktop use: when BACKUP_DIR is set, keep a dated backup file there (the same .sbtbackup the Settings
// button gives). Today's file is rewritten every few hours and when the app closes; the newest KEEP days stay.
const fs = require('fs');
const path = require('path');
const { makeBackup } = require('./backup');
const { todayLocal } = require('./pay');

const DIR = process.env.BACKUP_DIR || '';
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP_DAYS || 30));
const enabled = !!DIR;

function runNow() {
  if (!enabled) return null;
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `sbt-pay-backup-${todayLocal()}.sbtbackup`);
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, makeBackup());
  fs.renameSync(tmp, file);
  const old = fs.readdirSync(DIR).filter((f) => /^sbt-pay-backup-\d{4}-\d{2}-\d{2}\.sbtbackup$/.test(f)).sort().reverse().slice(KEEP);
  for (const f of old) fs.rmSync(path.join(DIR, f), { force: true });
  return file;
}

function safeRun() {
  try { const f = runNow(); if (f) console.log(`Backup saved: ${f}`); }
  catch (e) { console.error('Backup failed:', e.message); }
}

function start(hours = 3) {
  if (!enabled) return;
  setTimeout(safeRun, 5000).unref();
  setInterval(safeRun, hours * 3600 * 1000).unref();
}

module.exports = { enabled, DIR, runNow, safeRun, start };
