const assert = require('assert/strict');
const { readWhatsAppGroupSummaries } = require('../Electron/group-discovery');
const collections = {
 Chat: { getModelsArray: () => [
  { id: { _serialized: 'person@c.us' }, get msgs() { throw new Error('Serialization failure'); } },
  { id: { _serialized: '1@g.us' }, name: 'Proteção Animal' },
  { id: { _serialized: '2@g.us' }, formattedTitle: 'Suporte' }
 ] },
 GroupMetadata: { getModelsArray: () => [
  { id: { _serialized: '1@g.us' }, subject: 'Duplicado' },
  { id: { _serialized: '3@g.us' }, subject: 'Grupo sem chat carregado' },
  { id: { _serialized: '4@g.us' }, subject: 'Saiu', isInGroup: false }
 ] }
};
global.window = { require: name => { assert.equal(name, 'WAWebCollections'); return collections; } };
const groups = readWhatsAppGroupSummaries();
assert.equal(groups.length, 3);
assert.equal(groups.find(g => g.id === '1@g.us').name, 'Proteção Animal');
assert.ok(groups.some(g => g.id === '3@g.us'));
assert.ok(!groups.some(g => g.id === 'person@c.us'));
delete collections.GroupMetadata;
assert.equal(readWhatsAppGroupSummaries().length, 2);
console.log('Listagem direta de grupos: conversas incompatíveis, metadados e duplicatas OK.');
