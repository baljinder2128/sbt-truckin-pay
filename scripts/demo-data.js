// Loads demo drivers, runsheets and RCTIs so the app can be tried out. Run once on an empty database: npm run demo
const bcrypt = require('bcryptjs');
const { db } = require('../server/db');
const { calcShift, weekRange, addDays, todayLocal } = require('../server/pay');
const rcti = require('../server/rcti');

if (db.prepare("SELECT 1 FROM users WHERE role = 'driver'").get()) {
  console.log('Drivers already exist, demo data not loaded.');
  process.exit(0);
}
if (!db.prepare("SELECT 1 FROM users WHERE role = 'office'").get()) {
  db.prepare("INSERT INTO users (role, name, email, password_hash) VALUES ('office', 'Office Admin', 'office@sbttruckin.com.au', ?)").run(bcrypt.hashSync('ChangeMe123!', 10));
}


const pw = bcrypt.hashSync('Driver123!', 10);
const drivers = [
  ['Jas Singh', 'jas@example.com', 42.5, 'JS Haulage Pty Ltd', '51 824 753 556', 1, 'JS Haulage Pty Ltd', '062-000', '12345678'],
  ['Mick Thompson', 'mick@example.com', 40, '', '33 051 775 556', 1, 'M Thompson', '033-111', '87654321'],
  ['Raj Patel', 'raj@example.com', 38, 'RP Transport', '', 0, 'RP Transport', '', ''],
].map(([name, email, rate, biz, abn, gst, acct, bsb, num]) =>
  Number(db.prepare(`INSERT INTO users (role, name, email, phone, password_hash, hourly_rate, business_name, abn, gst_registered, address, bank_account_name, bank_bsb, bank_account_number)
    VALUES ('driver', ?, ?, '0400 000 000', ?, ?, ?, ?, ?, 'Western Sydney NSW', ?, ?, ?)`).run(name, email, pw, rate, biz, abn, gst, acct, bsb, num).lastInsertRowid));

const shifts = [['05:00', '15:30', [['09:30', '10:00']]], ['06:00', '17:15', [['10:00', '10:30'], ['13:30', '13:45']]], ['04:30', '14:00', [['09:00', '09:30']]], ['22:00', '06:30', [['02:00', '02:30']]]];
const thisWeek = weekRange(todayLocal()).start;
const ins = db.prepare(`INSERT INTO runsheets (driver_id, work_date, start_time, finish_time, breaks_json, break_minutes, hours, rate, amount, status, submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
drivers.forEach((id, di) => {
  const rate = db.prepare('SELECT hourly_rate FROM users WHERE id = ?').get(id).hourly_rate;
  for (let d = -14; d <= 0; d++) {
    const date = addDays(todayLocal(), d);
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    if (dow === 0 || (dow === 6 && di !== 1)) continue;
    const [s, f, b] = shifts[(d + 14 + di) % shifts.length];
    const c = calcShift({ start_time: s, finish_time: f, breaks: b.map(([a, z]) => ({ start: a, end: z })), rate });
    ins.run(id, date, c.start_time, c.finish_time, JSON.stringify(c.breaks), c.break_minutes, c.hours, c.rate, c.amount, date < thisWeek ? 'approved' : 'submitted', date + ' 18:00:00');
  }
});

// Two weeks ago: invoiced, pushed and paid. Last week: invoiced, held for the office to push.
const w2 = addDays(thisWeek, -14);
for (const id of rcti.generateForPeriod(w2, addDays(w2, 6))) db.prepare("UPDATE rctis SET pushed_at = datetime('now'), paid_at = ?, payment_ref = 'EFT demo' WHERE id = ?").run(addDays(thisWeek, -5), id);
const w1 = addDays(thisWeek, -7);
rcti.generateForPeriod(w1, addDays(w1, 6));
console.log('Demo data loaded. Office: office@sbttruckin.com.au / ChangeMe123!  Drivers: jas@example.com, mick@example.com, raj@example.com / Driver123!');
setTimeout(() => process.exit(0), 1500); // let PDFs finish writing
