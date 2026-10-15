const test = require('node:test');
const assert = require('node:assert');
const { calcShift, weekRange } = require('../server/pay');

test('paid hours run start to finish, breaks recorded but not deducted', () => {
  const c = calcShift({ start_time: '06:00', finish_time: '16:30', breaks: [{ start: '10:00', end: '10:30' }, { start: '13:00', end: '13:15' }], rate: 40 });
  assert.equal(c.hours, 10.5);
  assert.equal(c.break_minutes, 45);
  assert.equal(c.amount, 420);
});

test('overnight shift crosses midnight', () => {
  const c = calcShift({ start_time: '22:00', finish_time: '06:30', breaks: [], rate: 38 });
  assert.equal(c.hours, 8.5);
  assert.equal(c.amount, 323);
});

test('odd minutes round to cents', () => {
  const c = calcShift({ start_time: '05:07', finish_time: '15:00', breaks: [], rate: 42.5 });
  assert.equal(c.hours, 9.88);
  assert.equal(c.amount, 419.9);
});

test('bad times are rejected', () => {
  assert.throws(() => calcShift({ start_time: '25:00', finish_time: '10:00', rate: 1 }));
  assert.throws(() => calcShift({ start_time: '10:00', finish_time: '10:00', rate: 1 }));
});

test('pay week is Sunday to Saturday', () => {
  assert.deepEqual(weekRange('2026-10-15'), { start: '2026-10-11', end: '2026-10-17' });
  assert.deepEqual(weekRange('2026-10-11'), { start: '2026-10-11', end: '2026-10-17' });
  assert.deepEqual(weekRange('2026-10-17'), { start: '2026-10-11', end: '2026-10-17' });
  assert.deepEqual(weekRange('2026-10-18'), { start: '2026-10-18', end: '2026-10-24' });
});
