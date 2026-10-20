const assert = require('node:assert/strict');
const { recent, filter, scanTarget } = require('../../web/talkgroup-activity.js');
const now = 1000000;
const groups = [{ id: 91, name: 'Mundial', category: 'Mundo' },
  { id: 72422, name: 'Bahia', category: 'Estados', region: 'Nordeste' },
  { id: 72425, name: 'Paraíba', category: 'Estados' }, { id: 4000, name: 'Desconectar', category: 'Especiais' }];
const activity = { 91: { lastActivityAt: now - 5000, active: true },
  72422: { lastActivityAt: now - 59000, active: false },
  72425: { lastActivityAt: now - 60000 }, 4000: { lastActivityAt: now - 1000 } };
assert.equal(recent(activity[72422], now), true);
assert.equal(recent(activity[72425], now), false);
assert.equal(recent({ lastActivityAt: now - 180000, active: true }, now), false);
assert.equal(recent({ lastActivityAt: now + 1 }, now), false);
assert.deepEqual(filter(groups, { activity, now, status: 'active', category: 'Estados' }).map(g => g.id), [72422]);
assert.deepEqual(filter(groups, { activity, now, status: 'offline' }).map(g => g.id), [72425]);
assert.deepEqual(filter(groups, { activity, now, query: 'Nordeste' }).map(g => g.id), [72422]);
assert.equal(scanTarget(groups, activity, 72425, 0, now).id, 91);
assert.equal(scanTarget(groups, activity, 91, 0, now).id, 91, 'hold a live conversation');
assert.equal(scanTarget(groups, { 4000: activity[4000] }, 91, 0, now), undefined, 'never scan a disconnect command');
assert.equal(scanTarget(groups, {}, 91, 0, now), undefined, 'no activity means no channel change');
const recentOnly = { 91: { lastActivityAt: now-1000 }, 72422: { lastActivityAt: now-2000 } };
assert.equal(scanTarget(groups, recentOnly, 91, now-7000, now).id, 91, '8-second dwell');
assert.equal(scanTarget(groups, recentOnly, 91, now-8000, now).id, 72422, 'rotate after dwell');
console.log('PASS: activity expiry, combined filters, live hold and passive scan rotation');
