// Email: real SMTP when SMTP_HOST is set, otherwise every message is saved to data/outbox as an .eml file
// so nothing leaves the server until the business has configured its own mail account.
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { db, DATA_DIR, getSettings } = require('./db');

const smtpConfigured = !!process.env.SMTP_HOST;

const transport = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || '') === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });

function fromAddress() {
  const s = getSettings();
  return process.env.MAIL_FROM || (s.company_email ? `"${s.company_name}" <${s.company_email}>` : 'SB Truckin <no-reply@localhost>');
}

async function sendMail({ to, subject, html, text, attachments = [] }) {
  const mode = smtpConfigured ? 'smtp' : 'outbox';
  if (!to) {
    db.prepare('INSERT INTO email_log (to_addr, subject, mode, status, detail) VALUES (?,?,?,?,?)').run('-', subject, mode, 'skipped', 'No recipient address set');
    return { ok: false, skipped: true, reason: 'No recipient address set' };
  }
  try {
    const info = await transport.sendMail({ from: fromAddress(), to, subject, html, text, attachments });
    let detail = info.messageId || '';
    if (!smtpConfigured) {
      const file = `${Date.now()}-${subject.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.eml`;
      fs.writeFileSync(path.join(DATA_DIR, 'outbox', file), info.message);
      detail = `saved to outbox/${file}`;
    }
    db.prepare('INSERT INTO email_log (to_addr, subject, mode, status, detail) VALUES (?,?,?,?,?)').run(to, subject, mode, 'sent', detail);
    return { ok: true, mode, detail };
  } catch (e) {
    db.prepare('INSERT INTO email_log (to_addr, subject, mode, status, detail) VALUES (?,?,?,?,?)').run(to, subject, mode, 'failed', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendMail, smtpConfigured };
