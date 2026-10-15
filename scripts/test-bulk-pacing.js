const assert = require('node:assert/strict');
const {
  normalizeBulkLongPauseSettings,
  shouldTakeBulkLongPause
} = require('../Electron/bulk-pacing');

assert.deepEqual(normalizeBulkLongPauseSettings({}), {
  pauseEveryMessages: 50,
  longPauseMinutes: 15
});
assert.deepEqual(normalizeBulkLongPauseSettings({ pauseEveryMessages: 100, longPauseMinutes: 10 }), {
  pauseEveryMessages: 100,
  longPauseMinutes: 10
});
assert.deepEqual(normalizeBulkLongPauseSettings({ pauseEveryMessages: 2, longPauseMinutes: 999 }), {
  pauseEveryMessages: 10,
  longPauseMinutes: 120
});
assert.equal(shouldTakeBulkLongPause(49, true, { pauseEveryMessages: 50 }), false);
assert.equal(shouldTakeBulkLongPause(50, true, { pauseEveryMessages: 50 }), true);
assert.equal(shouldTakeBulkLongPause(50, false, { pauseEveryMessages: 50 }), false);

console.log('Pausas longas dos disparos: testes concluídos com sucesso.');
