// Weekly Recipient Created Tax Invoices (RCTI): build, number, render to PDF.
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { db, DATA_DIR, getSettings, setSetting, tx } = require('./db');
const { round2, todayLocal } = require('./pay');

const BUILTIN_LOGO = path.join(__dirname, '..', 'public', 'brand', 'sbt-logo-light.png');

const money = (n) => '$' + Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayName = (s) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(s + 'T00:00:00Z').getUTCDay()];
const auDate = (s) => (s ? s.split('-').reverse().join('/') : '');

function nextNumber() {
  const s = getSettings();
  const n = Number(s.rcti_next_number || 1001);
  setSetting('rcti_next_number', n + 1);
  return `${s.rcti_prefix || 'RCTI-'}${n}`;
}

// Creates one RCTI per driver for the period from runsheets not yet invoiced (rejected ones excluded).
// Returns created RCTI ids.
function generateForPeriod(start, end, driverId = null) {
  const drivers = driverId
    ? db.prepare("SELECT * FROM users WHERE id = ? AND role = 'driver'").all(driverId)
    : db.prepare("SELECT * FROM users WHERE role = 'driver'").all();
  const created = [];
  for (const d of drivers) {
    const sheets = db
      .prepare("SELECT * FROM runsheets WHERE driver_id = ? AND work_date BETWEEN ? AND ? AND rcti_id IS NULL AND status != 'rejected' ORDER BY work_date, start_time")
      .all(d.id, start, end);
    if (!sheets.length) continue;
    const id = tx(() => {
      const totalHours = round2(sheets.reduce((s, r) => s + r.hours, 0));
      const subtotal = round2(sheets.reduce((s, r) => s + r.amount, 0));
      const gst = d.gst_registered ? round2(subtotal * 0.1) : 0;
      const total = round2(subtotal + gst);
      const r = db
        .prepare('INSERT INTO rctis (number, driver_id, period_start, period_end, issue_date, total_hours, subtotal, gst, total) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(nextNumber(), d.id, start, end, todayLocal(), totalHours, subtotal, gst, total);
      const rid = Number(r.lastInsertRowid);
      const upd = db.prepare('UPDATE runsheets SET rcti_id = ? WHERE id = ?');
      for (const s of sheets) upd.run(rid, s.id);
      return rid;
    });
    renderPdf(id);
    created.push(id);
  }
  return created;
}

// Recalculate an unpaid RCTI after office edits (keeps its number). Picks up late runsheets in the period too.
function rebuild(rctiId) {
  const r = db.prepare('SELECT * FROM rctis WHERE id = ?').get(rctiId);
  if (!r) throw new Error('RCTI not found');
  if (r.paid_at) throw new Error('This RCTI is marked paid. Mark it unpaid first to change it.');
  const d = db.prepare('SELECT * FROM users WHERE id = ?').get(r.driver_id);
  tx(() => {
    db.prepare("UPDATE runsheets SET rcti_id = ? WHERE driver_id = ? AND work_date BETWEEN ? AND ? AND rcti_id IS NULL AND status != 'rejected'").run(rctiId, r.driver_id, r.period_start, r.period_end);
    db.prepare("UPDATE runsheets SET rcti_id = NULL WHERE rcti_id = ? AND status = 'rejected'").run(rctiId);
    const sheets = db.prepare('SELECT * FROM runsheets WHERE rcti_id = ?').all(rctiId);
    const totalHours = round2(sheets.reduce((s, x) => s + x.hours, 0));
    const subtotal = round2(sheets.reduce((s, x) => s + x.amount, 0));
    const gst = d.gst_registered ? round2(subtotal * 0.1) : 0;
    db.prepare('UPDATE rctis SET total_hours=?, subtotal=?, gst=?, total=?, issue_date=? WHERE id=?').run(totalHours, subtotal, gst, round2(subtotal + gst), todayLocal(), rctiId);
  });
  renderPdf(rctiId);
}

function voidRcti(rctiId) {
  const r = db.prepare('SELECT * FROM rctis WHERE id = ?').get(rctiId);
  if (!r) throw new Error('RCTI not found');
  if (r.paid_at) throw new Error('This RCTI is marked paid. Mark it unpaid first.');
  tx(() => {
    db.prepare('UPDATE runsheets SET rcti_id = NULL WHERE rcti_id = ?').run(rctiId);
    db.prepare('DELETE FROM rctis WHERE id = ?').run(rctiId);
  });
  if (r.pdf_path) fs.rmSync(path.join(DATA_DIR, r.pdf_path), { force: true });
}

function renderPdf(rctiId) {
  const r = db.prepare('SELECT * FROM rctis WHERE id = ?').get(rctiId);
  const d = db.prepare('SELECT * FROM users WHERE id = ?').get(r.driver_id);
  const sheets = db.prepare('SELECT * FROM runsheets WHERE rcti_id = ? ORDER BY work_date, start_time').all(rctiId);
  const s = getSettings();
  const rel = path.join('rcti', `${r.number}.pdf`);
  const file = path.join(DATA_DIR, rel);

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(fs.createWriteStream(file));
  const W = doc.page.width;
  const L = 40;
  const R = W - 40;
  const AMBER = '#E10600'; // SB red
  const INK = '#15181C';

  // Header band
  doc.rect(0, 0, W, 92).fill(INK);
  doc.rect(0, 92, W, 6).fill(AMBER);
  const uploaded = s.logo_path ? path.join(DATA_DIR, s.logo_path) : '';
  const logo = uploaded && fs.existsSync(uploaded) ? uploaded : BUILTIN_LOGO;
  try { doc.image(logo, L, 14, { fit: [100, 62] }); } catch { /* unsupported image type */ }
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text('TRUCKIN', L + 108, 34, { characterSpacing: 1 });
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(13).text('RECIPIENT CREATED TAX INVOICE', L, 26, { width: R - L, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor('#D5DAE0')
    .text(`${r.number}`, L, 46, { width: R - L, align: 'right' })
    .text(`Issued ${auDate(r.issue_date)}   ·   Week ${auDate(r.period_start)} – ${auDate(r.period_end)}`, L, 62, { width: R - L, align: 'right' });

  // Parties
  let y = 116;
  const colW = (R - L - 20) / 2;
  const party = (x, title, lines) => {
    doc.fillColor('#6B7480').font('Helvetica-Bold').fontSize(8).text(title, x, y, { characterSpacing: 1 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(lines[0] || '', x, y + 13, { width: colW });
    doc.font('Helvetica').fontSize(9).fillColor('#333');
    for (const l of lines.slice(1)) if (l) doc.text(l, { width: colW });
    return doc.y;
  };
  const y1 = party(L, 'RECIPIENT (ISSUER)', [s.company_name, s.company_abn ? `ABN ${s.company_abn}` : 'ABN —', s.company_address, s.company_phone, s.company_email]);
  const y2 = party(L + colW + 20, 'SUPPLIER (DRIVER)', [
    d.business_name || d.name,
    d.abn ? `ABN ${d.abn}` : 'ABN —',
    d.business_name ? `Driver: ${d.name}` : '',
    d.address,
    d.gst_registered ? 'Registered for GST' : 'Not registered for GST',
  ]);
  y = Math.max(y1, y2) + 18;

  // Table
  const cols = [
    { k: 'date', t: 'Date', w: 62 }, { k: 'day', t: 'Day', w: 32 }, { k: 'start', t: 'Start', w: 42 }, { k: 'finish', t: 'Finish', w: 42 },
    { k: 'breaks', t: 'Breaks*', w: 92 }, { k: 'hours', t: 'Hours', w: 46, a: 'right' }, { k: 'rate', t: 'Rate', w: 56, a: 'right' }, { k: 'amount', t: 'Amount', w: 0, a: 'right' },
  ];
  const used = cols.reduce((a, c) => a + c.w, 0);
  cols[cols.length - 1].w = R - L - used;
  const row = (vals, opts = {}) => {
    let x = L;
    if (opts.fill) doc.rect(L, y - 4, R - L, 18).fill(opts.fill);
    doc.fillColor(opts.color || INK).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 9);
    for (const c of cols) {
      doc.text(String(vals[c.k] ?? ''), x + 4, y, { width: c.w - 8, align: c.a || 'left', lineBreak: false });
      x += c.w;
    }
    y += 18;
  };
  row(Object.fromEntries(cols.map((c) => [c.k, c.t.toUpperCase()])), { fill: INK, color: '#FFFFFF', bold: true, size: 8 });
  sheets.forEach((sh, i) => {
    if (y > 700) { doc.addPage(); y = 50; }
    const br = JSON.parse(sh.breaks_json || '[]');
    row({
      date: auDate(sh.work_date), day: dayName(sh.work_date), start: sh.start_time, finish: sh.finish_time,
      breaks: br.length ? `${sh.break_minutes} min (${br.length})` : '—',
      hours: sh.hours.toFixed(2), rate: money(sh.rate), amount: money(sh.amount),
    }, { fill: i % 2 ? '#F4F5F7' : null });
  });
  doc.moveTo(L, y).lineTo(R, y).strokeColor('#D0D4D9').stroke();
  y += 8;

  // Totals
  const tot = (label, val, bold) => {
    doc.fillColor(bold ? '#FFFFFF' : INK).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10);
    doc.text(label, R - 250, y, { width: 140, align: 'right' });
    doc.text(val, R - 110, y, { width: 106, align: 'right' });
    y += bold ? 20 : 16;
  };
  tot('Total hours', r.total_hours.toFixed(2));
  tot('Subtotal (excl. GST)', money(r.subtotal));
  tot(d.gst_registered ? 'GST (10%)' : 'GST (supplier not registered)', money(r.gst));
  doc.rect(R - 250, y - 2, 250, 24).fill(AMBER);
  y += 4;
  tot('TOTAL PAYABLE', money(r.total), true);
  doc.fillColor('#6B7480').font('Helvetica').fontSize(7.5)
    .text('* Breaks are recorded from the runsheet for reference only. Paid hours run from start to finish as per runsheet.', L, y + 4, { width: R - L });
  y = doc.y + 14;

  // Payment details
  if (y > 640) { doc.addPage(); y = 50; }
  doc.rect(L, y, R - L, 62).fill('#F4F5F7');
  doc.fillColor('#6B7480').font('Helvetica-Bold').fontSize(8).text('PAYMENT TO NOMINATED ACCOUNT', L + 12, y + 10, { characterSpacing: 1 });
  doc.fillColor(INK).font('Helvetica').fontSize(10)
    .text(`Account name: ${d.bank_account_name || '—'}`, L + 12, y + 26)
    .text(`BSB: ${d.bank_bsb || '—'}     Account: ${d.bank_account_number || '—'}`, L + 12, y + 41);
  doc.fillColor(INK).font('Helvetica').fontSize(8).text(s.payment_terms || '', L + 260, y + 26, { width: R - L - 272 });
  y += 76;

  doc.fillColor('#6B7480').font('Helvetica-Bold').fontSize(8).text('RCTI AGREEMENT', L, y, { characterSpacing: 1 });
  doc.fillColor('#444').font('Helvetica').fontSize(7.5).text(s.rcti_agreement || '', L, y + 12, { width: R - L, align: 'justify' });

  doc.end();
  db.prepare('UPDATE rctis SET pdf_path = ? WHERE id = ?').run(rel, rctiId);
  return file;
}

// Wait for the PDF stream to flush before attaching/sending it.
function pdfReady(rctiId, timeoutMs = 5000) {
  const r = db.prepare('SELECT pdf_path FROM rctis WHERE id = ?').get(rctiId);
  const file = path.join(DATA_DIR, r.pdf_path);
  return new Promise((resolve) => {
    const t0 = Date.now();
    const check = () => {
      try {
        const buf = fs.readFileSync(file);
        if (buf.slice(-8).toString().includes('%%EOF')) return resolve(file);
      } catch {}
      if (Date.now() - t0 > timeoutMs) return resolve(file);
      setTimeout(check, 50);
    };
    check();
  });
}

module.exports = { generateForPeriod, rebuild, voidRcti, renderPdf, pdfReady, money, auDate };
