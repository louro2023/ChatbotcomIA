const assert = require('assert/strict');
const vm = require('vm');
const { telegramWebPage } = require('../Electron/telegram-web-page');
(async () => {
  const calls = [], listeners = new Map();
  const root = { myId: 77, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const currentTime = Math.floor(Date.now() / 1000);
  root.managers = {
    apiFileManager: { upload: async ({ file }) => { assert.equal(file.name, 'resposta.mp3'); return { _: 'inputFile', id: '123', parts: 1, name: file.name, md5_checksum: '' }; } },
    appChatsManager: { saveApiChats: async () => {} }, appUsersManager: { saveApiUsers: async () => {} },
    appPeersManager: {
      getOutputPeer: async id => id === -456 || id === -999 ? { _: 'peerChannel', channel_id: -id } : id < 0 ? { _: 'peerChat', chat_id: -id } : { _: 'peerUser', user_id: id },
      getInputPeerById: async id => id === -456 ? { _: 'inputPeerChannel', channel_id: 456, access_hash: 'hash' } : id < 0 ? { _: 'inputPeerChat', chat_id: -id } : { _: 'inputPeerUser', user_id: id, access_hash: 'user-hash' },
      isBroadcast: async id => id === -999
    },
    apiUpdatesManager: { processUpdateMessage: async () => {} },
    apiManager: { invokeApi: async (method, params) => {
      calls.push([method, params]);
      if (method === 'messages.getDialogs') return params.folder_id === 1 ? { dialogs: [], chats: [] } : {
        dialogs: [{ peer: { _: 'peerChat', chat_id: 123 } }, { peer: { _: 'peerChannel', channel_id: 456 } }, { peer: { _: 'peerChannel', channel_id: 999 } }],
        chats: [{ _: 'chat', id: 123, title: 'Grupo comum', pFlags: {} }, { _: 'channel', id: 456, title: 'Supergrupo', access_hash: 'hash', pFlags: { megagroup: true } }, { _: 'channel', id: 999, title: 'Canal', pFlags: { broadcast: true } }]
      };
      return { _: 'updates', updates: [] };
    } }
  };
  const context = vm.createContext({ window: { rootScope: root }, document: { querySelectorAll: () => [] }, crypto: require('crypto').webcrypto, File, atob });
  const run = (action, args = {}) => { context.action = action; context.args = args; return vm.runInContext(`(${telegramWebPage.toString()})(action,args)`, context); };
  await run('install', { owner: 'telegram:77' });
  const groups = await run('groups', { owner: 'telegram:77' });
  assert.deepEqual(Array.from(groups, group => group.id), ['telegram:-123', 'telegram:-1000000000456']);
  const incoming = (peerId, id, extra = {}) => ({ _: 'message', peerId, id, mid: 0x100000000 + id, date: currentTime + 1, message: '!ajuda', pFlags: {}, ...extra });
  const receive = listeners.get('history_multiappend');
  await receive(incoming(-123, 1)); await receive(incoming(-456, 2)); await receive(incoming(88, 3));
  await receive(incoming(-123, 4, { pFlags: { out: true } }));
  await receive(incoming(-123, 5, { date: currentTime - 30 })); await receive(incoming(-999, 6));
  const result = await run('poll', { owner: 'telegram:77' });
  assert.deepEqual(Array.from(result.messages, msg => msg.from), ['telegram:-123', 'telegram:-1000000000456', 'telegram:77:88']);
  assert.equal(calls.some(([method]) => /readHistory/.test(method)), false);
  await run('file', { owner: 'telegram:77', id: 'telegram:77:88', name: 'resposta.mp3', data: Buffer.from('audio').toString('base64') });
  assert.equal(calls.at(-1)[0], 'messages.sendMedia'); assert.equal(calls.at(-1)[1].peer.user_id, 88);
  await run('send', { owner: 'telegram:77', id: 'telegram:-1000000000456', text: 'Mensagem 👋' });
  assert.equal(calls.at(-1)[0], 'messages.sendMessage'); assert.equal(calls.at(-1)[1].peer.channel_id, 456);
  assert.equal(calls.some(([method]) => /readHistory/.test(method)), false);
  await run('read', { owner: 'telegram:77', id: 'telegram:-1000000000456', messageId: 2 });
  assert.equal(calls.at(-1)[0], 'channels.readHistory'); assert.equal(calls.at(-1)[1].max_id, 2);
  const count = calls.length; await run('read', { owner: 'telegram:77', id: 'telegram:77:88', messageId: 3 }); assert.equal(calls.length, count);
  await assert.rejects(run('send', { owner: 'telegram:99', id: 'telegram:-123', text: 'Errada' }), /conta.*mudou/);
  root.myId = 99;
  await assert.rejects(run('groups', { owner: 'telegram:77' }), /conta.*mudou/);
  console.log('Página Web: IDs de grupos preservados, exclusão de canais/histórico/próprias, recebimento sem abrir chats, envio confirmado e leitura restrita OK.');
})().catch(error => { console.error(error); process.exitCode = 1; });
