// Desktop install: dated backup files are written to BACKUP_DIR and old ones are cleared.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sbt-ab-data-'));
process.env.BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sbt-ab-bak-'));
process.env.BACKUP_KEEP_DAYS = '3';
const autobackup = require('../server/autobackup');

test('writes today\'s backup and keeps only the newest days', () => {
  for (const d of ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04']) fs.writeFileSync(path.join(process.env.BACKUP_DIR, `sbt-pay-backup-${d}.sbtbackup`), 'x');
  fs.writeFileSync(path.join(process.env.BACKUP_DIR, 'my-notes.txt'), 'keep me');
  const file = autobackup.runNow();
  const b = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
  assert.strictEqual(b.app, 'sbt-truckin-pay');
  assert.ok(b.db.length > 100);
  const left = fs.readdirSync(process.env.BACKUP_DIR).sort();
  assert.deepStrictEqual(left, ['my-notes.txt', 'sbt-pay-backup-2020-01-03.sbtbackup', 'sbt-pay-backup-2020-01-04.sbtbackup', path.basename(file)].sort());
  autobackup.runNow(); // same day again overwrites, no duplicate
  assert.strictEqual(fs.readdirSync(process.env.BACKUP_DIR).length, 4);
});
