// SB Truckin driver pay: API + web app server.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');

const { db, DATA_DIR, getSettings, setSetting } = require('./db');
const { calcShift, round2, weekRange, addDays, todayLocal } = require('./pay');
const rcti = require('./rcti');
const { sendMail, smtpConfigured } = require('./mail');
const { extractRunsheet, extractionEnabled } = require('./extract');

const PORT = Number(process.env.PORT || 3000);
const TZ = process.env.TZ || 'Australia/Melbourne';

// ---------- bootstrap ----------
let secret = process.env.JWT_SECRET || getSettings().jwt_secret;
if (!secret) { secret = crypto.randomBytes(32).toString('hex'); setSetting('jwt_secret', secret); }

if (!db.prepare("SELECT 1 FROM users WHERE role = 'office'").get()) {
  const email = process.env.ADMIN_EMAIL || 'office@sbttruckin.com.au';
  const pass = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  db.prepare("INSERT INTO users (role, name, email, password_hash) VALUES ('office', 'Office Admin', ?, ?)").run(email, bcrypt.hashSync(pass, 10));
  console.log(`Created first office login: ${email} / ${pass}  (change it under Settings)`);
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
let lastWeeklyCheck = 0;
app.use((req, res, next) => {
  if (Date.now() - lastWeeklyCheck > 10 * 60 * 1000) { lastWeeklyCheck = Date.now(); setImmediate(runWeekly); }
  next();
});
app.get('/api/health', (req, res) => res.json({ ok: true }));

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(DATA_DIR, 'uploads'),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname || '.jpg').toLowerCase() || '.jpg'}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

// ---------- helpers ----------
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (msg, code = 400) => Object.assign(new Error(msg), { status: code });

const PUBLIC_USER = 'id, role, name, email, phone, active, hourly_rate, business_name, abn, gst_registered, address, bank_account_name, bank_bsb, bank_account_number, created_at';

function auth(role) {
  return (req, res, next) => {
    try {
      const tok = req.cookies.sbt || (req.headers.authorization || '').replace(/^Bearer /, '');
      const { uid } = jwt.verify(tok, secret);
      const u = db.prepare(`SELECT ${PUBLIC_USER} FROM users WHERE id = ?`).get(uid);
      if (!u || !u.active) throw new Error();
      if (role && u.role !== role) return res.status(403).json({ error: 'Office access only' });
      req.user = u;
      next();
    } catch {
      res.status(401).json({ error: 'Please log in' });
    }
  };
}
const isOffice = (req) => req.user.role === 'office';

function rowRunsheet(r) {
  if (!r) return r;
  return { ...r, breaks: JSON.parse(r.breaks_json || '[]'), extracted: r.extracted_json ? JSON.parse(r.extracted_json) : null, breaks_json: undefined, extracted_json: undefined, has_photo: !!r.photo_path };
}

async function emailRunsheetToOffice(id) {
  const s = getSettings();
  const r = db.prepare('SELECT r.*, u.name AS driver_name FROM runsheets r JOIN users u ON u.id = r.driver_id WHERE r.id = ?').get(id);
  const br = JSON.parse(r.breaks_json || '[]');
  const html = `<div style="font-family:Arial,sans-serif">
    <div style="background:#15181C;color:#fff;padding:14px 18px;border-bottom:5px solid #E10600"><b>${esc(s.company_name)}</b> · Runsheet submitted</div>
    <table cellpadding="6" style="font-size:14px">
      <tr><td><b>Driver</b></td><td>${esc(r.driver_name)}</td></tr>
      <tr><td><b>Date</b></td><td>${rcti.auDate(r.work_date)}</td></tr>
      <tr><td><b>Start / Finish</b></td><td>${r.start_time} – ${r.finish_time}</td></tr>
      <tr><td><b>Paid hours</b></td><td>${r.hours.toFixed(2)} (start to finish)</td></tr>
      <tr><td><b>Breaks (not deducted)</b></td><td>${br.length ? br.map((b) => `${b.start}–${b.end}`).join(', ') + ` (${r.break_minutes} min)` : 'None'}</td></tr>
      <tr><td><b>Rate / Amount</b></td><td>${rcti.money(r.rate)}/hr · ${rcti.money(r.amount)} ex GST</td></tr>
      ${r.truck_rego ? `<tr><td><b>Truck</b></td><td>${esc(r.truck_rego)}</td></tr>` : ''}
      ${r.notes ? `<tr><td><b>Driver notes</b></td><td>${esc(r.notes)}</td></tr>` : ''}
    </table><p style="color:#666;font-size:12px">Runsheet photo attached. Review or edit it in the SB Truckin pay app.</p></div>`;
  const attachments = r.photo_path ? [{ filename: `runsheet-${r.driver_name.replace(/\W+/g, '_')}-${r.work_date}${path.extname(r.photo_path)}`, path: path.join(DATA_DIR, r.photo_path) }] : [];
  const out = await sendMail({ to: s.office_email, subject: `Runsheet: ${r.driver_name} – ${rcti.auDate(r.work_date)}`, html, attachments });
  if (out.ok) db.prepare("UPDATE runsheets SET office_emailed_at = datetime('now') WHERE id = ?").run(id);
  return out;
}

async function emailRctisToOffice(ids) {
  if (!ids.length) return { ok: true, skipped: true };
  const s = getSettings();
  const rows = ids.map((id) => db.prepare('SELECT r.*, u.name AS driver_name FROM rctis r JOIN users u ON u.id = r.driver_id WHERE r.id = ?').get(id));
  for (const r of rows) await rcti.pdfReady(r.id);
  const total = rows.reduce((a, r) => a + r.total, 0);
  const html = `<div style="font-family:Arial,sans-serif">
    <div style="background:#15181C;color:#fff;padding:14px 18px;border-bottom:5px solid #E10600"><b>${esc(s.company_name)}</b> · RCTIs (office copies)</div>
    <table cellpadding="6" style="font-size:14px;border-collapse:collapse">
      <tr style="background:#eee"><th align="left">RCTI</th><th align="left">Driver</th><th align="left">Week</th><th align="right">Hours</th><th align="right">Total</th></tr>
      ${rows.map((r) => `<tr><td>${r.number}</td><td>${esc(r.driver_name)}</td><td>${rcti.auDate(r.period_start)} – ${rcti.auDate(r.period_end)}</td><td align="right">${r.total_hours.toFixed(2)}</td><td align="right">${rcti.money(r.total)}</td></tr>`).join('')}
      <tr><td colspan="4" align="right"><b>Total</b></td><td align="right"><b>${rcti.money(total)}</b></td></tr>
    </table><p style="color:#666;font-size:12px">Driver copies are held in the app until the office pushes them.</p></div>`;
  const out = await sendMail({
    to: s.office_email,
    subject: rows.length === 1 ? `RCTI ${rows[0].number} – ${rows[0].driver_name}` : `RCTIs for week ${rcti.auDate(rows[0].period_start)} (${rows.length} drivers)`,
    html,
    attachments: rows.map((r) => ({ filename: `${r.number}.pdf`, path: path.join(DATA_DIR, r.pdf_path) })),
  });
  if (out.ok) for (const r of rows) db.prepare("UPDATE rctis SET office_emailed_at = datetime('now') WHERE id = ?").run(r.id);
  return out;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// If a runsheet change affects an unpaid RCTI, re-total it.
function refreshRctiFor(rctiId) {
  if (!rctiId) return;
  const r = db.prepare('SELECT * FROM rctis WHERE id = ?').get(rctiId);
  if (r && !r.paid_at) rcti.rebuild(rctiId);
}

// ---------- auth ----------
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim());
  if (!u || !u.active || !bcrypt.compareSync(String(password || ''), u.password_hash)) return res.status(401).json({ error: 'Wrong email or password' });
  const token = jwt.sign({ uid: u.id }, secret, { expiresIn: '30d' });
  res.cookie('sbt', token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 30 * 864e5 });
  res.json({ ok: true, role: u.role, token });
});
app.post('/api/logout', (req, res) => { res.clearCookie('sbt'); res.json({ ok: true }); });
app.get('/api/me', auth(), (req, res) => res.json(req.user));
app.post('/api/me/password', auth(), (req, res) => {
  const { current, next } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(current || ''), u.password_hash)) throw bad('Current password is wrong');
  if (String(next || '').length < 8) throw bad('New password needs at least 8 characters');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), u.id);
  res.json({ ok: true });
});
app.get('/api/config', (req, res) => {
  const s = getSettings();
  res.json({ company_name: s.company_name, has_logo: !!s.logo_path, extraction: extractionEnabled, smtp: smtpConfigured(), today: todayLocal() });
});
app.get('/api/logo', (req, res) => {
  const s = getSettings();
  if (!s.logo_path) return res.status(404).end();
  res.sendFile(path.join(DATA_DIR, s.logo_path));
});

// ---------- runsheets ----------
app.post('/api/uploads', auth(), upload.single('photo'), wrap(async (req, res) => {
  if (!req.file) throw bad('Attach a photo of the runsheet');
  const id = crypto.randomUUID();
  const rel = path.join('uploads', req.file.filename);
  db.prepare('INSERT INTO uploads (id, user_id, file_path, mime) VALUES (?,?,?,?)').run(id, req.user.id, rel, req.file.mimetype);
  let extracted = null;
  let extraction_error = null;
  if (extractionEnabled) {
    try {
      extracted = await extractRunsheet(req.file.path, req.file.mimetype);
      db.prepare('UPDATE uploads SET extracted_json = ? WHERE id = ?').run(JSON.stringify(extracted), id);
    } catch (e) {
      console.error('extract failed', e.message);
      extraction_error = 'Could not read the photo automatically. Please enter the times.';
    }
  }
  res.json({ id, extracted, extraction_enabled: extractionEnabled, extraction_error });
}));

app.post('/api/runsheets', auth(), wrap(async (req, res) => {
  const b = req.body || {};
  const driverId = isOffice(req) && b.driver_id ? Number(b.driver_id) : req.user.id;
  const driver = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'driver'").get(driverId);
  if (!driver) throw bad('Runsheets are submitted by drivers');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.work_date || '')) throw bad('Pick the date of the shift');
  let up = null;
  if (b.upload_id) {
    up = db.prepare('SELECT * FROM uploads WHERE id = ?').get(b.upload_id);
    if (!up || (up.user_id !== req.user.id && !isOffice(req))) throw bad('Photo not found, please retake it');
  } else if (!isOffice(req)) throw bad('Add a photo of your runsheet');
  const calc = calcShift({ start_time: b.start_time, finish_time: b.finish_time, breaks: b.breaks, rate: driver.hourly_rate });
  const r = db.prepare(`INSERT INTO runsheets (driver_id, work_date, start_time, finish_time, breaks_json, break_minutes, hours, rate, amount, truck_rego, notes, photo_path, extracted_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(driverId, b.work_date, calc.start_time, calc.finish_time, JSON.stringify(calc.breaks), calc.break_minutes, calc.hours, calc.rate, calc.amount,
    b.truck_rego || null, b.notes || null, up ? up.file_path : null, up ? up.extracted_json : null);
  const id = Number(r.lastInsertRowid);
  const s = getSettings();
  let emailed = null;
  if (s.auto_email_runsheets === '1') emailed = await emailRunsheetToOffice(id);
  res.json({ ...rowRunsheet(db.prepare('SELECT * FROM runsheets WHERE id = ?').get(id)), emailed });
}));

app.get('/api/runsheets', auth(), (req, res) => {
  const q = req.query;
  const where = [];
  const args = [];
  if (!isOffice(req)) { where.push('r.driver_id = ?'); args.push(req.user.id); }
  else if (q.driver_id) { where.push('r.driver_id = ?'); args.push(Number(q.driver_id)); }
  if (q.from) { where.push('r.work_date >= ?'); args.push(q.from); }
  if (q.to) { where.push('r.work_date <= ?'); args.push(q.to); }
  if (q.status) { where.push('r.status = ?'); args.push(q.status); }
  const rows = db.prepare(`SELECT r.*, u.name AS driver_name, x.number AS rcti_number, x.paid_at AS rcti_paid_at, x.pushed_at AS rcti_pushed_at
    FROM runsheets r JOIN users u ON u.id = r.driver_id LEFT JOIN rctis x ON x.id = r.rcti_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.work_date DESC, r.start_time DESC LIMIT ${Math.min(Number(q.limit) || 200, 1000)}`).all(...args);
  res.json(rows.map(rowRunsheet));
});

function loadRunsheet(req) {
  const r = db.prepare('SELECT r.*, u.name AS driver_name FROM runsheets r JOIN users u ON u.id = r.driver_id WHERE r.id = ?').get(Number(req.params.id));
  if (!r || (!isOffice(req) && r.driver_id !== req.user.id)) throw bad('Runsheet not found', 404);
  return r;
}
app.get('/api/runsheets/:id', auth(), (req, res) => res.json(rowRunsheet(loadRunsheet(req))));
app.get('/api/runsheets/:id/photo', auth(), (req, res) => {
  const r = loadRunsheet(req);
  if (!r.photo_path) return res.status(404).end();
  res.sendFile(path.join(DATA_DIR, r.photo_path));
});

app.put('/api/runsheets/:id', auth('office'), (req, res) => {
  const r = loadRunsheet(req);
  const b = req.body || {};
  if (r.rcti_id) {
    const x = db.prepare('SELECT paid_at FROM rctis WHERE id = ?').get(r.rcti_id);
    if (x && x.paid_at) throw bad('This runsheet is on a paid RCTI. Mark the RCTI unpaid first.');
  }
  const calc = calcShift({
    start_time: b.start_time ?? r.start_time,
    finish_time: b.finish_time ?? r.finish_time,
    breaks: b.breaks ?? JSON.parse(r.breaks_json),
    rate: b.rate ?? r.rate,
  });
  const status = b.status ?? r.status;
  if (!['submitted', 'approved', 'rejected'].includes(status)) throw bad('Bad status');
  db.prepare(`UPDATE runsheets SET work_date=?, start_time=?, finish_time=?, breaks_json=?, break_minutes=?, hours=?, rate=?, amount=?, truck_rego=?, notes=?, office_notes=?, status=?, updated_at=datetime('now') WHERE id=?`)
    .run(b.work_date ?? r.work_date, calc.start_time, calc.finish_time, JSON.stringify(calc.breaks), calc.break_minutes, calc.hours, calc.rate, calc.amount,
      b.truck_rego ?? r.truck_rego, b.notes ?? r.notes, b.office_notes ?? r.office_notes, status, r.id);
  // A changed date can move it out of its RCTI week.
  const after = db.prepare('SELECT * FROM runsheets WHERE id = ?').get(r.id);
  if (after.rcti_id) {
    const x = db.prepare('SELECT * FROM rctis WHERE id = ?').get(after.rcti_id);
    if (after.work_date < x.period_start || after.work_date > x.period_end) db.prepare('UPDATE runsheets SET rcti_id = NULL WHERE id = ?').run(r.id);
    refreshRctiFor(after.rcti_id);
  }
  res.json(rowRunsheet(db.prepare('SELECT * FROM runsheets WHERE id = ?').get(r.id)));
});

app.delete('/api/runsheets/:id', auth('office'), (req, res) => {
  const r = loadRunsheet(req);
  if (r.rcti_id) {
    const x = db.prepare('SELECT paid_at FROM rctis WHERE id = ?').get(r.rcti_id);
    if (x && x.paid_at) throw bad('This runsheet is on a paid RCTI.');
  }
  db.prepare('DELETE FROM runsheets WHERE id = ?').run(r.id);
  if (r.rcti_id) {
    const left = db.prepare('SELECT COUNT(*) n FROM runsheets WHERE rcti_id = ?').get(r.rcti_id).n;
    if (left) refreshRctiFor(r.rcti_id); else rcti.voidRcti(r.rcti_id);
  }
  res.json({ ok: true });
});

app.post('/api/runsheets/:id/email-office', auth('office'), wrap(async (req, res) => {
  loadRunsheet(req);
  res.json(await emailRunsheetToOffice(Number(req.params.id)));
}));

// ---------- pay summary ----------
function driverWeeks(driverId, officeView) {
  const d = db.prepare('SELECT * FROM users WHERE id = ?').get(driverId);
  const sheets = db.prepare("SELECT r.*, x.paid_at, x.pushed_at, x.number, x.total AS rcti_total, x.gst AS rcti_gst FROM runsheets r LEFT JOIN rctis x ON x.id = r.rcti_id WHERE r.driver_id = ? AND r.status != 'rejected' ORDER BY r.work_date DESC").all(driverId);
  const weeks = new Map();
  const thisWeek = weekRange(todayLocal()).start;
  for (const s of sheets) {
    const wk = weekRange(s.work_date);
    if (!weeks.has(wk.start)) weeks.set(wk.start, { week_start: wk.start, week_end: wk.end, days: 0, hours: 0, subtotal: 0, rctis: new Map(), uninvoiced: 0 });
    const w = weeks.get(wk.start);
    w.days += 1; w.hours += s.hours; w.subtotal += s.amount;
    if (s.rcti_id) w.rctis.set(s.rcti_id, { id: s.rcti_id, number: s.number, total: s.rcti_total, paid_at: s.paid_at, pushed_at: s.pushed_at });
    else w.uninvoiced += s.amount;
  }
  const out = [];
  for (const w of weeks.values()) {
    const rs = [...w.rctis.values()];
    const invoicedTotal = rs.reduce((a, r) => a + r.total, 0);
    const paidTotal = rs.filter((r) => r.paid_at).reduce((a, r) => a + r.total, 0);
    const estGst = d.gst_registered ? w.uninvoiced * 0.1 : 0;
    const total = round2(invoicedTotal + w.uninvoiced + estGst);
    let status;
    if (rs.length && rs.every((r) => r.paid_at) && !w.uninvoiced) status = 'paid';
    else if (w.week_start >= thisWeek) status = 'in_progress';
    else if (rs.length && !w.uninvoiced) status = 'rcti_issued';
    else status = 'awaiting_rcti';
    out.push({
      week_start: w.week_start, week_end: w.week_end, days: w.days, hours: round2(w.hours), subtotal: round2(w.subtotal), total,
      paid: round2(paidTotal), pending: round2(total - paidTotal), status,
      rctis: rs.filter((r) => officeView || r.pushed_at).map((r) => ({ id: r.id, number: r.number, total: r.total, paid_at: r.paid_at })),
    });
  }
  return out;
}

app.get('/api/pay/summary', auth(), (req, res) => {
  const driverId = isOffice(req) && req.query.driver_id ? Number(req.query.driver_id) : req.user.id;
  const weeks = driverWeeks(driverId, isOffice(req));
  const wk = weekRange(todayLocal());
  const cur = weeks.find((w) => w.week_start === wk.start);
  res.json({
    pending: round2(weeks.reduce((a, w) => a + w.pending, 0)),
    cleared: round2(weeks.reduce((a, w) => a + w.paid, 0)),
    this_week: { start: wk.start, end: wk.end, hours: cur ? cur.hours : 0, days: cur ? cur.days : 0, subtotal: cur ? cur.subtotal : 0 },
    weeks,
  });
});

app.get('/api/office/dashboard', auth('office'), (req, res) => {
  const wk = weekRange(req.query.date || todayLocal());
  const last = weekRange(addDays(wk.start, -1));
  const sum = (from, to) => db.prepare("SELECT COUNT(*) n, COALESCE(SUM(hours),0) hours, COALESCE(SUM(amount),0) amount FROM runsheets WHERE work_date BETWEEN ? AND ? AND status != 'rejected'").get(from, to);
  res.json({
    week: wk,
    this_week: sum(wk.start, wk.end),
    last_week: { ...sum(last.start, last.end), ...last },
    to_review: db.prepare("SELECT COUNT(*) n FROM runsheets WHERE status = 'submitted'").get().n,
    unpaid_rctis: db.prepare('SELECT COUNT(*) n, COALESCE(SUM(total),0) total FROM rctis WHERE paid_at IS NULL').get(),
    not_pushed: db.prepare('SELECT COUNT(*) n FROM rctis WHERE pushed_at IS NULL').get().n,
    uninvoiced_past: db.prepare("SELECT COUNT(*) n FROM runsheets WHERE rcti_id IS NULL AND status != 'rejected' AND work_date < ?").get(wk.start).n,
    drivers: db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'driver' AND active = 1").get().n,
    missing_details: db.prepare("SELECT id, name FROM users WHERE role='driver' AND active=1 AND (hourly_rate <= 0 OR abn IS NULL OR abn = '' OR bank_bsb IS NULL OR bank_bsb = '' OR bank_account_number IS NULL OR bank_account_number = '')").all(),
  });
});

// ---------- drivers & staff (office) ----------
const DRIVER_FIELDS = ['name', 'email', 'phone', 'active', 'hourly_rate', 'business_name', 'abn', 'gst_registered', 'address', 'bank_account_name', 'bank_bsb', 'bank_account_number'];

function cleanDriver(b) {
  const o = {};
  for (const f of DRIVER_FIELDS) if (b[f] !== undefined) o[f] = b[f];
  if (o.email !== undefined) o.email = String(o.email).trim();
  if (o.hourly_rate !== undefined) { o.hourly_rate = Number(o.hourly_rate); if (!(o.hourly_rate >= 0)) throw bad('Hourly rate must be a number'); }
  if (o.active !== undefined) o.active = o.active ? 1 : 0;
  if (o.gst_registered !== undefined) o.gst_registered = o.gst_registered ? 1 : 0;
  if (o.abn) { o.abn = String(o.abn).replace(/\s+/g, ''); if (!/^\d{11}$/.test(o.abn)) throw bad('ABN must be 11 digits'); o.abn = o.abn.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4'); }
  if (o.bank_bsb) { const d = String(o.bank_bsb).replace(/\D/g, ''); if (d.length !== 6) throw bad('BSB must be 6 digits'); o.bank_bsb = `${d.slice(0, 3)}-${d.slice(3)}`; }
  if (o.bank_account_number) { o.bank_account_number = String(o.bank_account_number).replace(/\s+/g, ''); if (!/^\d{4,10}$/.test(o.bank_account_number)) throw bad('Account number should be 4 to 10 digits'); }
  return o;
}

app.get('/api/drivers', auth('office'), (req, res) => {
  res.json(db.prepare(`SELECT ${PUBLIC_USER} FROM users WHERE role = 'driver' ORDER BY active DESC, name`).all());
});
app.post('/api/drivers', auth('office'), (req, res) => {
  const o = cleanDriver(req.body || {});
  if (!o.name || !o.email) throw bad('Name and email are required');
  const pw = String(req.body.password || '');
  if (pw.length < 8) throw bad('Set a starting password of at least 8 characters');
  const cols = Object.keys(o);
  try {
    const r = db.prepare(`INSERT INTO users (role, password_hash, ${cols.join(',')}) VALUES ('driver', ?, ${cols.map(() => '?').join(',')})`).run(bcrypt.hashSync(pw, 10), ...cols.map((c) => o[c]));
    res.json(db.prepare(`SELECT ${PUBLIC_USER} FROM users WHERE id = ?`).get(Number(r.lastInsertRowid)));
  } catch (e) {
    if (/UNIQUE/.test(e.message)) throw bad('That email is already used');
    throw e;
  }
});
app.put('/api/drivers/:id', auth('office'), (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'driver'").get(id)) throw bad('Driver not found', 404);
  const o = cleanDriver(req.body || {});
  const cols = Object.keys(o);
  if (cols.length) {
    try { db.prepare(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => o[c]), id); }
    catch (e) { if (/UNIQUE/.test(e.message)) throw bad('That email is already used'); throw e; }
  }
  if (req.body.password) {
    if (String(req.body.password).length < 8) throw bad('Password needs at least 8 characters');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(req.body.password, 10), id);
  }
  // New rate applies to runsheets not yet on an RCTI when asked.
  if (req.body.apply_rate_to_open && o.hourly_rate !== undefined) {
    db.prepare('UPDATE runsheets SET rate = ?, amount = ROUND(hours * ?, 2) WHERE driver_id = ? AND rcti_id IS NULL').run(o.hourly_rate, o.hourly_rate, id);
  }
  res.json(db.prepare(`SELECT ${PUBLIC_USER} FROM users WHERE id = ?`).get(id));
});

app.get('/api/staff', auth('office'), (req, res) => res.json(db.prepare("SELECT id, name, email, phone, active FROM users WHERE role = 'office' ORDER BY name").all()));
app.post('/api/staff', auth('office'), (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || String(password || '').length < 8) throw bad('Name, email and a password of 8+ characters are required');
  try { db.prepare("INSERT INTO users (role, name, email, password_hash) VALUES ('office', ?, ?, ?)").run(name, String(email).trim(), bcrypt.hashSync(password, 10)); }
  catch (e) { if (/UNIQUE/.test(e.message)) throw bad('That email is already used'); throw e; }
  res.json({ ok: true });
});
app.put('/api/staff/:id', auth('office'), (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  if (b.active === false && id === req.user.id) throw bad("You can't switch off your own login");
  if (b.active !== undefined) db.prepare("UPDATE users SET active = ? WHERE id = ? AND role = 'office'").run(b.active ? 1 : 0, id);
  if (b.password) db.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND role = 'office'").run(bcrypt.hashSync(b.password, 10), id);
  res.json({ ok: true });
});

// ---------- settings ----------
const SETTING_KEYS = ['company_name', 'company_abn', 'company_address', 'company_phone', 'company_email', 'office_email', 'rcti_prefix', 'rcti_next_number', 'payment_terms', 'rcti_agreement', 'auto_weekly_rcti', 'auto_email_runsheets'];
app.get('/api/settings', auth('office'), (req, res) => {
  const s = getSettings();
  res.json({ ...Object.fromEntries(SETTING_KEYS.map((k) => [k, s[k]])), has_logo: !!s.logo_path, smtp: smtpConfigured(), smtp_from_env: !!process.env.SMTP_HOST, smtp_host: s.smtp_host, smtp_user: s.smtp_user, smtp_pass_set: !!s.smtp_pass, extraction: extractionEnabled, timezone: TZ });
});
app.put('/api/settings', auth('office'), (req, res) => {
  for (const k of SETTING_KEYS) if (req.body[k] !== undefined) setSetting(k, req.body[k]);
  res.json({ ok: true });
});
app.put('/api/settings/email', auth('office'), (req, res) => {
  const b = req.body || {};
  if (b.smtp_user !== undefined) setSetting('smtp_user', String(b.smtp_user).trim());
  if (b.smtp_host) setSetting('smtp_host', String(b.smtp_host).trim());
  if (b.smtp_port) setSetting('smtp_port', String(b.smtp_port).trim());
  // Google shows app passwords in groups of four letters; spaces aren't part of it.
  if (b.smtp_pass !== undefined) setSetting('smtp_pass', String(b.smtp_pass).replace(/\s+/g, ''));
  res.json({ ok: true, smtp: smtpConfigured() });
});
app.post('/api/settings/test-email', auth('office'), wrap(async (req, res) => {
  const s = getSettings();
  res.json(await sendMail({ to: s.office_email, subject: `Test email from ${s.company_name} pay app`, html: '<p>Email is working. Runsheets and RCTIs will be sent from this account.</p>' }));
}));
app.post('/api/settings/logo', auth('office'), upload.single('logo'), (req, res) => {
  if (!req.file) throw bad('Upload a PNG or JPG logo');
  if (!/png|jpe?g/.test(req.file.mimetype)) throw bad('Logo must be PNG or JPG');
  const rel = path.join('branding', 'logo' + path.extname(req.file.filename));
  fs.renameSync(req.file.path, path.join(DATA_DIR, rel));
  setSetting('logo_path', rel);
  res.json({ ok: true });
});

// ---------- RCTIs ----------
const RCTI_SELECT = `SELECT x.*, u.name AS driver_name, u.business_name, u.email AS driver_email,
  (SELECT COUNT(*) FROM runsheets r WHERE r.rcti_id = x.id) AS runsheet_count FROM rctis x JOIN users u ON u.id = x.driver_id`;

app.get('/api/rctis', auth(), (req, res) => {
  const where = [];
  const args = [];
  if (!isOffice(req)) { where.push('x.driver_id = ? AND x.pushed_at IS NOT NULL'); args.push(req.user.id); }
  else if (req.query.driver_id) { where.push('x.driver_id = ?'); args.push(Number(req.query.driver_id)); }
  if (req.query.week) { where.push('x.period_start = ?'); args.push(weekRange(req.query.week).start); }
  res.json(db.prepare(`${RCTI_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY x.period_start DESC, u.name`).all(...args));
});

function loadRcti(req) {
  const r = db.prepare(`${RCTI_SELECT} WHERE x.id = ?`).get(Number(req.params.id));
  if (!r || (!isOffice(req) && (r.driver_id !== req.user.id || !r.pushed_at))) throw bad('RCTI not found', 404);
  return r;
}
app.get('/api/rctis/:id', auth(), (req, res) => {
  const r = loadRcti(req);
  res.json({ ...r, runsheets: db.prepare('SELECT * FROM runsheets WHERE rcti_id = ? ORDER BY work_date').all(r.id).map(rowRunsheet) });
});
app.get('/api/rctis/:id/pdf', auth(), wrap(async (req, res) => {
  const r = loadRcti(req);
  const file = await rcti.pdfReady(r.id);
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${r.number}.pdf"`);
  res.sendFile(file);
}));

app.post('/api/rctis/generate', auth('office'), wrap(async (req, res) => {
  const wk = weekRange(req.body.week || addDays(weekRange(todayLocal()).start, -7));
  const ids = rcti.generateForPeriod(wk.start, wk.end, req.body.driver_id ? Number(req.body.driver_id) : null);
  let emailed = null;
  if (ids.length && req.body.email_office !== false) emailed = await emailRctisToOffice(ids);
  res.json({ week: wk, created: ids.length, ids, emailed });
}));
app.post('/api/rctis/:id/rebuild', auth('office'), (req, res) => { loadRcti(req); rcti.rebuild(Number(req.params.id)); res.json({ ok: true }); });
app.delete('/api/rctis/:id', auth('office'), (req, res) => { loadRcti(req); rcti.voidRcti(Number(req.params.id)); res.json({ ok: true }); });
app.post('/api/rctis/:id/email-office', auth('office'), wrap(async (req, res) => { loadRcti(req); res.json(await emailRctisToOffice([Number(req.params.id)])); }));

app.post('/api/rctis/:id/push', auth('office'), wrap(async (req, res) => {
  const r = loadRcti(req);
  db.prepare("UPDATE rctis SET pushed_at = datetime('now') WHERE id = ?").run(r.id);
  let emailed = null;
  if (req.body.email_driver) {
    const file = await rcti.pdfReady(r.id);
    emailed = await sendMail({
      to: r.driver_email,
      subject: `Your RCTI ${r.number} – week ${rcti.auDate(r.period_start)}`,
      html: `<p>Hi ${esc(r.driver_name)},</p><p>Your RCTI <b>${r.number}</b> for ${rcti.auDate(r.period_start)} – ${rcti.auDate(r.period_end)} is attached: ${r.total_hours.toFixed(2)} hours, total ${rcti.money(r.total)}.</p><p>${esc(getSettings().company_name)}</p>`,
      attachments: [{ filename: `${r.number}.pdf`, path: file }],
    });
  }
  res.json({ ok: true, emailed });
}));
app.post('/api/rctis/:id/unpush', auth('office'), (req, res) => { loadRcti(req); db.prepare('UPDATE rctis SET pushed_at = NULL WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });
app.post('/api/rctis/:id/paid', auth('office'), (req, res) => {
  const r = loadRcti(req);
  if (req.body.paid === false) db.prepare('UPDATE rctis SET paid_at = NULL, payment_ref = NULL WHERE id = ?').run(r.id);
  else db.prepare('UPDATE rctis SET paid_at = ?, payment_ref = ? WHERE id = ?').run(req.body.paid_on || todayLocal(), req.body.payment_ref || null, r.id);
  res.json({ ok: true });
});

app.get('/api/email-log', auth('office'), (req, res) => res.json(db.prepare('SELECT * FROM email_log ORDER BY id DESC LIMIT 200').all()));

// ---------- static web app ----------
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', setHeaders: (res, p) => { if (p.endsWith('sw.js') || p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  if (/Invalid time|same/.test(err.message)) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// ---------- weekly RCTI run for the week just finished ----------
// Runs Monday 1am, and also catches up on the next request or restart if the server was asleep then
// (free hosts put idle apps to sleep). The last week done is remembered so it never runs twice.
let weeklyBusy = false;
async function weeklyRun() {
  if (weeklyBusy || getSettings().auto_weekly_rcti !== '1') return;
  const wk = weekRange(addDays(weekRange(todayLocal()).start, -7));
  if (getSettings().last_auto_rcti_week >= wk.start) return;
  weeklyBusy = true;
  try {
    setSetting('last_auto_rcti_week', wk.start);
    const ids = rcti.generateForPeriod(wk.start, wk.end);
    if (ids.length) await emailRctisToOffice(ids);
    console.log(`Weekly RCTI run for ${wk.start}: ${ids.length} created`);
  } finally {
    weeklyBusy = false;
  }
}
const runWeekly = () => weeklyRun().catch((e) => console.error('weekly run failed', e));
cron.schedule('0 1 * * 1', runWeekly, { timezone: TZ });

if (require.main === module) {
  // Hosts route traffic to the PORT they set, but a domain can be pointed at another port by hand,
  // so also answer on the common ones (3000 and 8080).
  for (const port of new Set([PORT, 3000, 8080])) {
    app.listen(port, '0.0.0.0', () => console.log(`SB Truckin pay app listening on port ${port}`)).on('error', (e) => console.error(`port ${port}: ${e.message}`));
  }
  console.log(`TZ ${TZ}, email ${smtpConfigured() ? 'SMTP' : 'outbox only'}, photo reading ${extractionEnabled ? 'on' : 'off'}, data in ${DATA_DIR}`);
}
module.exports = { app, weeklyRun };
