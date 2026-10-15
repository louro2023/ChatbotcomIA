const assert = require('assert/strict');
const { installWhatsAppMessageKeyCompatibility, serializedMessageId, withWhatsAppCompatibility } = require('../Electron/whatsapp-compat');
const { readGroupMessagesFromPage } = require('../Electron/group-reader');
const { createGroupMonitor } = require('../Electron/group-monitor');
class ModernKey {
  constructor(value) { this.$1 = value; this.fromMe = false; this.remote = { _serialized: '1@g.us' }; this.id = 'local'; }
  toString() { return this.$1; }
}
const modern = new ModernKey('false_1@g.us_local');
const legacy = { _serialized: 'legacy', fromMe: false, remote: { _serialized: '1@g.us' } };
const message = { id: modern, body: '!privacy', t: 1000 };
const chat = { id: { _serialized: '1@g.us' }, lastReceivedKey: modern, msgs: { getModelsArray: () => [message] } };
const utils = { getMessageModel: raw => ({ id: { ...raw.id }, body: raw.body }) };
global.window = { require: () => ({ Chat: { getModelsArray: () => [chat] }, Msg: { getModelsArray: () => [message] } }), WWebJS: utils };
// Reproduce the real failure before installing the bridge.
assert.equal(modern._serialized, undefined);
assert.equal(readGroupMessagesFromPage().length, 1);
assert.equal(readGroupMessagesFromPage()[0].id._serialized, modern.$1);
assert.equal(serializedMessageId(modern), modern.$1);
assert.equal(serializedMessageId(legacy), 'legacy');
// A plain key, as returned by serialize(), must also work without a prototype bridge.
chat.msgs.getModelsArray = () => [{ ...message, id: { ...modern } }];
assert.equal(readGroupMessagesFromPage()[0].id._serialized, modern.$1);
const result = installWhatsAppMessageKeyCompatibility();
assert.equal(result.patchedPrototypes, 1);
assert.equal(modern._serialized, modern.$1);
assert.equal(new ModernKey('future-message')._serialized, 'future-message');
assert.equal(utils.getMessageModel(message).id._serialized, modern.$1);
const wrapped = utils.getMessageModel;
assert.equal(installWhatsAppMessageKeyCompatibility().patchedPrototypes, 0);
assert.equal(utils.getMessageModel, wrapped);
(async () => {
 const order = [];
 class MockClient { constructor() { this.pupPage = { evaluate: async fn => { assert.equal(fn, installWhatsAppMessageKeyCompatibility); order.push('compatibility'); } }; } async attachEventListeners() { order.push('listeners'); } }
 await new (withWhatsAppCompatibility(MockClient))().attachEventListeners();
 assert.deepEqual(order, ['compatibility', 'listeners']);
 let state = {}, sends = 0;
 const monitor = createGroupMonitor({read:()=>structuredClone(state),write:next=>{state=next;},account:()=> 'test@c.us',send:async()=>{sends++;}});
 monitor.update({groupId:'1@g.us',action:'save-command',trigger:'!privacy',response:'Teste',enabled:true});
 monitor.update({groupId:'1@g.us',action:'toggle-group',enabled:true});
 await monitor.handle({from:'1@g.us',body:'!privacy',id:{$1:'new-format-only'}});
 assert.equal(sends,1);
 await monitor.handle({from:'1@g.us',body:'!privacy',id:{_serialized:'new-format-only'}});
 assert.equal(sends,1);
 delete global.window;
 console.log('Compatibilidade WhatsApp $1/_serialized: reprodução do formato real, leitura, eventos, modelos públicos, novas chaves, idempotência e deduplicação entre formatos OK.');
})().catch(e=>{console.error(e);process.exitCode=1;});
