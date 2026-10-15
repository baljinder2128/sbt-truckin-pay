// Email: real SMTP once a mail account is set (env or office Settings), otherwise every message is saved to data/outbox as an .eml file
// so nothing leaves the server until the business has configured its own mail account.
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { db, DATA_DIR, getSettings } = require('./db');

// Mail account comes from SMTP_* environment variables, or from Settings in the office app (Gmail by default).
function smtpConfig() {
  if (process.env.SMTP_HOST) {
    return {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || '') === 'true',
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    };
  }
  const s = getSettings();
  if (!s.smtp_pass) return null;
  return { host: s.smtp_host || 'smtp.gmail.com', port: Number(s.smtp_port || 465), secure: String(s.smtp_port || 465) === '465', user: s.smtp_user, pass: s.smtp_pass };
}
const smtpConfigured = () => !!smtpConfig();

let cached = { key: null, transport: null };
function getTransport() {
  const c = smtpConfig();
  const key = JSON.stringify(c);
  if (cached.key !== key) {
    cached = {
      key,
      transport: c
        ? nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: c.user ? { user: c.user, pass: c.pass } : undefined })
        : nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' }),
    };
  }
  return { smtp: !!c, transport: cached.transport };
}

function fromAddress() {
  const s = getSettings();
  if (process.env.MAIL_FROM) return process.env.MAIL_FROM;
  // Gmail only sends as the account that logs in, so use that address when it's set in Settings.
  const addr = (!process.env.SMTP_HOST && s.smtp_pass && s.smtp_user) || s.company_email;
  return addr ? `"${s.company_name}" <${addr}>` : 'SB Truckin <no-reply@localhost>';
}

async function sendMail({ to, subject, html, text, attachments = [] }) {
  const { smtp, transport } = getTransport();
  const mode = smtp ? 'smtp' : 'outbox';
  if (!to) {
    db.prepare('INSERT INTO email_log (to_addr, subject, mode, status, detail) VALUES (?,?,?,?,?)').run('-', subject, mode, 'skipped', 'No recipient address set');
    return { ok: false, skipped: true, reason: 'No recipient address set' };
  }
  try {
    const info = await transport.sendMail({ from: fromAddress(), to, subject, html, text, attachments });
    let detail = info.messageId || '';
    if (!smtp) {
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
