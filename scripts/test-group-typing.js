const assert = require('assert/strict');
const { createGroupMonitor } = require('../Electron/group-monitor');
(async () => {
 let state = {}, releaseTyping, order = [];
 const groupId = '1@g.us';
 const monitor = createGroupMonitor({ read: () => structuredClone(state), write: next => { state = next; }, account: () => 'test@c.us',
  typing: async (id, text) => { assert.equal(id,groupId);assert.equal(text,'Resposta');order.push('typing'); if (releaseTyping === 'wait') await new Promise(resolve => { releaseTyping=resolve; }); },
  send: async () => {order.push('send');} });
 const update = payload => monitor.update({groupId,...payload});
 update({action:'save-command',trigger:'!teste',response:'Resposta',enabled:true});update({action:'toggle-group',enabled:true});
 const msg=id=>({from:groupId,body:'!teste',id:{_serialized:id}});
 await monitor.handle(msg('default'));assert.deepEqual(order,['typing','send']);
 update({action:'toggle-typing',enabled:false});order=[];await monitor.handle(msg('off'));assert.deepEqual(order,['send']);
 assert.equal(monitor.settings()[groupId].simulatedTypingEnabled,false);
 update({action:'toggle-typing',enabled:true});order=[];releaseTyping='wait';
 const pending=monitor.handle(msg('pending'));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(await monitor.handle(msg('pending')),false);
 update({action:'toggle-group',enabled:false});releaseTyping();
 assert.equal(await pending,false);assert.deepEqual(order,['typing']);
 console.log('Digitação nos grupos: padrão ativo, ordem antes do envio, preferência persistente, deduplicação durante a espera e cancelamento ao desativar OK.');
})().catch(error=>{console.error(error);process.exitCode=1;});
