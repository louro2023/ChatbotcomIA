const assert = require('node:assert/strict');
const {
  classifyBulkSendError,
  evaluateBulkCircuitBreaker
} = require('../Electron/bulk-safety');

const restriction = classifyBulkSendError(Object.assign(new Error('Too many requests'), { status: 429 }));
assert.equal(restriction.kind, 'restriction');
assert.equal(restriction.immediate, true);
assert.equal(evaluateBulkCircuitBreaker({
  classification: restriction,
  consecutiveFailures: 1,
  recentOutcomes: [false]
}).type, 'restriction');

const disconnected = classifyBulkSendError(new Error('Protocol error: Target closed'));
assert.equal(disconnected.kind, 'connection');
assert.equal(disconnected.immediate, true);

const invalidRecipient = classifyBulkSendError(new Error('Número não registrado no WhatsApp'));
assert.equal(invalidRecipient.kind, 'recipient');
assert.equal(invalidRecipient.immediate, false);
assert.equal(evaluateBulkCircuitBreaker({
  classification: invalidRecipient,
  consecutiveFailures: 5,
  recentOutcomes: [false, false, false, false, false]
}).type, 'consecutive-failures');

assert.equal(evaluateBulkCircuitBreaker({
  classification: invalidRecipient,
  consecutiveFailures: 1,
  recentOutcomes: [true, true, true, true, true, false, false, false, false, false]
}).type, 'failure-rate');

assert.equal(evaluateBulkCircuitBreaker({
  classification: invalidRecipient,
  consecutiveFailures: 1,
  recentOutcomes: [true, true, true, true, true, true, false, false, false, false]
}), null);

console.log('Proteções de disparo: testes concluídos com sucesso.');
