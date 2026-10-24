// End-to-end API flow: office sets up a driver, enters their week, RCTI is generated, sent and paid. Drivers only ever read.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sbt-test-'));
process.env.ADMIN_EMAIL = 'boss@test.local';
process.env.ADMIN_PASSWORD = 'OfficePass1';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.SMTP_HOST;
const { app, weeklyRun } = require('../server/index.js');
const { db, setSetting, getSettings } = require('../server/db');
const { weekRange, addDays, todayLocal } = require('../server/pay');

let base;
let server;
test.before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
test.after(() => { server.close(); setTimeout(() => process.exit(0), 100); });

function client() {
  let cookie = '';
  return async (method, p, body, isForm) => {
    const res = await fetch(base + p, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : await res.arrayBuffer() };
  };
}

test('full pay flow', async () => {
  const office = client();
  const driver = client();
  assert.equal((await office('POST', '/api/login', { email: 'boss@test.local', password: 'OfficePass1' })).status, 200);
  await office('PUT', '/api/settings', { office_email: 'office@test.local', company_abn: '11 111 111 111' });

  const bad = await office('POST', '/api/drivers', { name: 'X', email: 'x@test.local', password: 'Password1', abn: '123' });
  assert.equal(bad.status, 400);

  const d = await office('POST', '/api/drivers', { name: 'Test Driver', email: 'd@test.local', password: 'Password1', hourly_rate: 40, abn: '51824753556', gst_registered: true, bank_bsb: '062000', bank_account_number: '12345678', bank_account_name: 'T Driver' });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(d.body.abn, '51 824 753 556');
  assert.equal(d.body.bank_bsb, '062-000');

  assert.equal((await driver('POST', '/api/login', { email: 'd@test.local', password: 'Password1' })).status, 200);
  assert.equal((await driver('GET', '/api/drivers')).status, 403, 'drivers cannot see the driver list');

  // Drivers can't enter or change anything
  assert.equal((await driver('POST', '/api/runsheets', { work_date: '2026-10-06', start_time: '05:00', finish_time: '15:30' })).status, 403);
  assert.equal((await driver('POST', '/api/runsheets/week', { driver_id: d.body.id, days: [] })).status, 403);
  const fd = new FormData();
  fd.append('photo', new Blob([fs.readFileSync(path.join(__dirname, '..', 'public', 'icons', 'icon-192.png'))], { type: 'image/png' }), 'sheet.png');
  assert.equal((await driver('POST', '/api/uploads', fd, true)).status, 403);

  // Office enters the week from the runsheets
  const bad2 = await office('POST', '/api/runsheets/week', { driver_id: d.body.id, week: '2026-10-06', days: [{ work_date: '2026-10-20', start_time: '05:00', finish_time: '15:30' }] });
  assert.equal(bad2.status, 400, 'day outside the week');
  const wkSave = await office('POST', '/api/runsheets/week', { driver_id: d.body.id, week: '2026-10-06', days: [
    { work_date: '2026-10-06', start_time: '05:00', finish_time: '15:30', breaks: [{ start: '09:00', end: '09:30' }] },
    { work_date: '2026-10-07', start_time: '06:00', finish_time: '14:00', breaks: [] },
    { work_date: '2026-10-08', start_time: '', finish_time: '' },
  ] });
  assert.equal(wkSave.status, 200, JSON.stringify(wkSave.body));
  assert.equal(wkSave.body.added, 2);
  const sheets = (await office('GET', `/api/runsheets?driver_id=${d.body.id}`)).body.sort((x, y) => x.work_date.localeCompare(y.work_date));
  const rs = { body: sheets[0] };
  assert.equal(rs.body.hours, 10.5);
  assert.equal(rs.body.amount, 420);
  assert.equal(rs.body.break_minutes, 30);
  assert.equal(rs.body.status, 'approved');

  // Saving the same week again with a changed finish updates that day rather than adding one
  const again = await office('POST', '/api/runsheets/week', { driver_id: d.body.id, week: '2026-10-06', days: [{ id: rs.body.id, work_date: '2026-10-06', start_time: '05:00', finish_time: '16:00' }, { id: sheets[1].id, work_date: '2026-10-07', start_time: '06:00', finish_time: '14:00' }] });
  assert.deepEqual([again.body.added, again.body.changed], [0, 1]);
  assert.equal((await office('GET', `/api/runsheets/${rs.body.id}`)).body.hours, 11);

  // Nothing shows for the driver until an RCTI is sent to them
  assert.equal((await driver('GET', '/api/runsheets')).body.length, 0);
  assert.equal((await driver('GET', `/api/runsheets/${rs.body.id}`)).status, 404);
  let sum = (await driver('GET', '/api/pay/summary')).body;
  assert.equal(sum.pending, 0);
  assert.equal((await office('GET', `/api/pay/summary?driver_id=${d.body.id}`)).body.pending, 760);

  const gen = await office('POST', '/api/rctis/generate', { week: '2026-10-08' });
  assert.equal(gen.body.created, 1);
  const rid = gen.body.ids[0];
  const r = (await office('GET', `/api/rctis/${rid}`)).body;
  // $40/hr is GST inclusive: 19h = $760 total, of which GST is 1/11.
  assert.equal(r.total, 760);
  assert.equal(r.gst, 69.09);
  assert.equal(r.subtotal, 690.91);
  assert.equal(r.total_hours, 19);

  // Driver can't see it until pushed
  assert.equal((await driver('GET', '/api/rctis')).body.length, 0);
  assert.equal((await driver('GET', `/api/rctis/${rid}/pdf`)).status, 404);
  await office('POST', `/api/rctis/${rid}/push`, {});
  assert.equal((await driver('GET', '/api/rctis')).body.length, 1);
  assert.equal((await driver('GET', '/api/runsheets')).body.length, 2, 'days on a sent RCTI are visible');
  assert.equal((await driver('GET', '/api/pay/summary')).body.pending, 760);
  assert.equal((await driver('PUT', `/api/runsheets/${rs.body.id}`, { finish_time: '18:00' })).status, 403);
  const pdf = await driver('GET', `/api/rctis/${rid}/pdf`);
  assert.equal(pdf.status, 200);
  assert.ok(Buffer.from(pdf.body).slice(0, 5).toString() === '%PDF-');

  // Edit after RCTI re-totals it
  await office('PUT', `/api/runsheets/${rs.body.id}`, { rate: 50 });
  assert.equal((await office('GET', `/api/rctis/${rid}`)).body.total, 870);

  await office('POST', `/api/rctis/${rid}/paid`, { payment_ref: 'EFT1' });
  sum = (await driver('GET', '/api/pay/summary')).body;
  assert.equal(sum.cleared, 870);
  assert.equal(sum.pending, 0);
  assert.equal(sum.weeks[0].status, 'paid');

  const log = (await office('GET', '/api/email-log')).body;
  assert.ok(log.some((l) => l.subject.startsWith('RCTI')), 'RCTI office copy logged');
  assert.ok(fs.readdirSync(path.join(process.env.DATA_DIR, 'outbox')).length >= 1);
});

test('weekly RCTI catches up once after the server slept through Sunday 1am', async () => {
  const lastWeek = weekRange(addDays(weekRange(todayLocal()).start, -7));
  const d = db.prepare("SELECT id FROM users WHERE email = 'd@test.local'").get();
  db.prepare("INSERT INTO runsheets (driver_id, work_date, start_time, finish_time, hours, rate, amount) VALUES (?, ?, '06:00', '14:00', 8, 40, 320)").run(d.id, lastWeek.start);
  setSetting('last_auto_rcti_week', '');
  const before = db.prepare('SELECT COUNT(*) n FROM rctis').get().n;
  await weeklyRun();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rctis').get().n, before + 1);
  assert.equal(getSettings().last_auto_rcti_week, lastWeek.start);
  await weeklyRun();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rctis').get().n, before + 1, 'does not run twice');
});

test('office can save the Gmail account in Settings without the password ever coming back', async () => {
  const office = client();
  await office('POST', '/api/login', { email: 'boss@test.local', password: 'OfficePass1' });
  await office('PUT', '/api/settings/email', { smtp_user: 'x@gmail.com', smtp_pass: 'abcd efgh ijkl mnop' });
  const s = (await office('GET', '/api/settings')).body;
  assert.equal(s.smtp, true);
  assert.equal(s.smtp_pass_set, true);
  assert.ok(!JSON.stringify(s).includes('abcdefghijklmnop'));
  assert.equal(getSettings().smtp_pass, 'abcdefghijklmnop');
  await office('PUT', '/api/settings/email', { smtp_pass: '' });
  assert.equal((await office('GET', '/api/settings')).body.smtp, false);
});

test('a Brevo key in Settings sends email over HTTPS and is never shown again', async () => {
  const office = client();
  await office('POST', '/api/login', { email: 'boss@test.local', password: 'OfficePass1' });
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.brevo.com/')) { calls.push({ url, opts }); return new Response(JSON.stringify({ messageId: '<m1@brevo>' }), { status: 201 }); }
    return realFetch(url, opts);
  };
  try {
    await office('PUT', '/api/settings/email', { smtp_user: 'sender@gmail.com', brevo_api_key: 'xkeysib-secret' });
    const s = (await office('GET', '/api/settings')).body;
    assert.equal(s.brevo_key_set, true);
    assert.ok(!JSON.stringify(s).includes('xkeysib-secret'));
    const out = (await office('POST', '/api/settings/test-email')).body;
    assert.equal(out.ok, true);
    assert.equal(out.mode, 'smtp');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts.headers['api-key'], 'xkeysib-secret');
    assert.equal(JSON.parse(calls[0].opts.body).sender.email, 'sender@gmail.com');
  } finally {
    global.fetch = realFetch;
    await office('PUT', '/api/settings/email', { brevo_api_key: '' });
  }
  assert.equal((await office('GET', '/api/settings')).body.smtp, false);
});

test('office can still edit and delete a runsheet on a paid RCTI, and the RCTI re-totals', async () => {
  const office = client();
  await office('POST', '/api/login', { email: 'boss@test.local', password: 'OfficePass1' });
  const paid = db.prepare('SELECT * FROM rctis WHERE paid_at IS NOT NULL ORDER BY id LIMIT 1').get();
  assert.ok(paid, 'test needs a paid RCTI from the earlier flow');
  const sheets = db.prepare('SELECT * FROM runsheets WHERE rcti_id = ? ORDER BY id').all(paid.id);
  const edit = await office('PUT', `/api/runsheets/${sheets[0].id}`, { start_time: '06:00', finish_time: '16:00' });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.hours, 10);
  const after = db.prepare('SELECT * FROM rctis WHERE id = ?').get(paid.id);
  assert.equal(after.total, Math.round(sheets.reduce((a, s, i) => a + (i === 0 ? 10 * s.rate : s.amount), 0) * 100) / 100);
  assert.ok(after.paid_at, 'stays marked paid');
  const del = await office('DELETE', `/api/runsheets/${sheets[0].id}`);
  assert.equal(del.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM runsheets WHERE id = ?').get(sheets[0].id).n, 0);
});

test('finish week, WhatsApp link and payments by month', async () => {
  const office = client();
  await office('POST', '/api/login', { email: 'boss@test.local', password: 'OfficePass1' });
  const d = (await office('POST', '/api/drivers', { name: 'Wa Driver', email: 'wa@test.local', password: 'Password1', hourly_rate: 55, phone: '0412 345 678', gst_registered: true })).body;
  await office('POST', '/api/runsheets/week', { driver_id: d.id, week: '2026-09-13', days: [{ work_date: '2026-09-14', start_time: '06:00', finish_time: '16:00' }] });
  const fin = await office('POST', '/api/rctis/finish-week', { driver_id: d.id, week: '2026-09-13' });
  assert.equal(fin.status, 200, JSON.stringify(fin.body));
  assert.equal(fin.body.created, 1);
  // A late day added to that week goes onto the same RCTI
  await office('POST', '/api/runsheets/week', { driver_id: d.id, week: '2026-09-13', days: [{ work_date: '2026-09-15', start_time: '06:00', finish_time: '10:00' }] });
  const fin2 = await office('POST', '/api/rctis/finish-week', { driver_id: d.id, week: '2026-09-13' });
  assert.equal(fin2.body.id, fin.body.id);
  assert.equal((await office('GET', `/api/rctis/${fin.body.id}`)).body.total, 770);

  const share = (await office('GET', `/api/rctis/${fin.body.id}/share`)).body;
  assert.equal(share.phone, '61412345678');
  const pathOnly = new URL(share.link).pathname;
  const pdf = await fetch(base + pathOnly);
  assert.equal(pdf.status, 200);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).slice(0, 5).toString(), '%PDF-');
  assert.equal((await fetch(base + pathOnly.slice(0, -2) + 'xx')).status, 404, 'tampered link refused');

  await office('POST', `/api/rctis/${fin.body.id}/paid`, { paid_on: '2026-10-02', payment_ref: 'EFT9' });
  const p = (await office('GET', '/api/payments?fy=2027')).body;
  const row = p.rows.find((r) => r.id === fin.body.id);
  assert.equal(row.total, 770);
  assert.equal(row.gst, 70);
  const csv = await office('GET', '/api/payments.csv?fy=2027');
  assert.ok(Buffer.from(csv.body).toString().includes('"EFT9"'));
  const driver = client();
  await driver('POST', '/api/login', { email: 'wa@test.local', password: 'Password1' });
  assert.equal((await driver('GET', '/api/payments')).status, 403);

  await office('POST', `/api/rctis/${fin.body.id}/paid`, { paid: false });
  assert.ok(!(await office('GET', '/api/payments?fy=2027')).body.rows.some((r) => r.id === fin.body.id), 'unpaid comes off the payments list');
});
