// Pay maths. Paid hours run from runsheet start to finish; breaks are recorded but NOT deducted.
process.env.TZ = process.env.TZ || 'Australia/Melbourne'; // business days follow Melbourne time unless set otherwise

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function toMinutes(t) {
  const m = TIME_RE.exec(String(t || '').trim());
  if (!m) throw new Error(`Invalid time "${t}" (use HH:MM, 24 hour)`);
  return Number(m[1]) * 60 + Number(m[2]);
}

function normTime(t) {
  const mins = toMinutes(t);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

// Minutes between two clock times; a finish earlier than start means the shift ran past midnight.
function spanMinutes(start, finish) {
  let d = toMinutes(finish) - toMinutes(start);
  if (d < 0) d += 24 * 60;
  return d;
}

function cleanBreaks(breaks) {
  if (!Array.isArray(breaks)) return [];
  return breaks
    .filter((b) => b && b.start && b.end)
    .map((b) => ({ start: normTime(b.start), end: normTime(b.end), minutes: spanMinutes(b.start, b.end) }));
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function calcShift({ start_time, finish_time, breaks, rate }) {
  const start = normTime(start_time);
  const finish = normTime(finish_time);
  const mins = spanMinutes(start, finish);
  if (mins === 0) throw new Error('Start and finish times are the same');
  const b = cleanBreaks(breaks);
  const hours = round2(mins / 60);
  return {
    start_time: start,
    finish_time: finish,
    breaks: b,
    break_minutes: b.reduce((s, x) => s + x.minutes, 0),
    hours,
    rate: round2(rate || 0),
    amount: round2(hours * (rate || 0)),
  };
}

// ISO date helpers working on plain YYYY-MM-DD strings (no timezone drift).
function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fmtDate(dt) {
  return dt.toISOString().slice(0, 10);
}
function addDays(s, n) {
  const dt = parseDate(s);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmtDate(dt);
}
// Pay week is Monday to Saturday, so RCTIs can be made at 1am Sunday for the week just worked.
// A Sunday counts towards the week that starts the next day (it isn't a pay day).
function weekStart(s) {
  const dt = parseDate(s);
  const dow = dt.getUTCDay(); // Sun=0
  dt.setUTCDate(dt.getUTCDate() + 1 - dow);
  return fmtDate(dt);
}
function weekRange(s) {
  const start = weekStart(s);
  return { start, end: addDays(start, 5) };
}
function todayLocal() {
  // Server TZ decides "today" (set TZ=Australia/Melbourne etc).
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = { calcShift, cleanBreaks, normTime, spanMinutes, round2, weekStart, weekRange, addDays, todayLocal };
