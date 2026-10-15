const assert = require('node:assert/strict');
const {
  MAX_BULK_MESSAGE_VARIATIONS,
  normalizeBulkMessageVariations,
  selectBulkMessageVariation
} = require('../Electron/bulk-messages');

assert.equal(MAX_BULK_MESSAGE_VARIATIONS, 5);
assert.deepEqual(
  normalizeBulkMessageVariations([' Primeira ', 'Segunda', '', 'Terceira', 'Quarta', 'Quinta', 'Sexta']),
  ['Primeira', 'Segunda', 'Terceira', 'Quarta']
);
assert.deepEqual(normalizeBulkMessageVariations([], ' Mensagem antiga '), ['Mensagem antiga']);

const variations = ['A', 'B', 'C'];
assert.deepEqual(
  Array.from({ length: 8 }, (_value, index) => selectBulkMessageVariation(variations, index)),
  ['A', 'B', 'C', 'A', 'B', 'C', 'A', 'B']
);
assert.equal(selectBulkMessageVariation([], 0), '');

console.log('Variações dos disparos: testes concluídos com sucesso.');
