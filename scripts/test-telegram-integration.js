const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { installTelegram } = require('../Electron/telegram-integration');
const { createGroupMonitor } = require('../Electron/group-monitor');
(async () => {
  fs.mkdirSync('.build-cache/telegram-tests', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.build-cache/telegram-tests/web-'));
  const ipc = new Map(), sent = [], read = [], privateMessages = [];
  let owner = '', callbacks, restored = 0, waState = {};
  const wa = createGroupMonitor({ account: () => 'wa@c.us', read: () => structuredClone(waState), write: next => { waState = next; }, send: async () => {} });
  wa.update({ groupId: '1@g.us', action: 'toggle-group', enabled: true });
  const tg = installTelegram({ root, ipcMain: { handle: (name, fn) => ipc.set(name, fn) }, emit() {}, processPrivate: async msg => privateMessages.push(msg), onError: error => { throw error; },
    connectionFactory: options => {
      callbacks = options;
      assert.equal(options.readAuth, undefined); // The web flow has no API credentials.
      return {
        connect: async (...args) => { assert.equal(args.length, 0); restored++; fs.mkdirSync(options.sessionPath, { recursive: true }); options.saveSession({ account: 'telegram:77' }); owner = 'telegram:77'; options.onReady(); return { ok: true }; },
        account: () => owner, status: () => ({ connected: Boolean(owner), account: owner }),
        listGroups: async () => [{ id: 'telegram:-123', name: 'TG' }, { id: 'telegram:-456', name: 'Outro' }],
        send: async (...args) => sent.push(args), markRead: async (...args) => read.push(args), typing: async () => {},
        disconnect: async ({ logout } = {}) => { owner = ''; options.onStop(); if (logout) options.clearSession(); return { ok: true }; }
      };
    }
  });
  const invoke = (name, payload) => ipc.get(name)(null, payload);
  try {
    await invoke('telegram:connect'); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'telegram-web-state.json'))), { account: 'telegram:77' });
    const update = payload => invoke('telegram:groups:update', { account: owner, groupId: 'telegram:-123', ...payload });
    await update({ action: 'save-command', trigger: '!ajuda', response: 'Resposta', enabled: true });
    await update({ action: 'toggle-typing', enabled: false }); await update({ action: 'toggle-group', enabled: true });
    const msg = (from, isGroup, id) => ({ from, isGroup, body: '!ajuda', messageId: id, id: { _serialized: String(id) } });
    await callbacks.onMessage(msg('telegram:-456', true, 1)); await callbacks.onMessage(msg('telegram:77:88', false, 2));
    assert.equal(read.length, 0); assert.equal(privateMessages.length, 0);
    await callbacks.onMessage(msg('telegram:-123', true, 3));
    assert.deepEqual(sent, [['telegram:-123', 'Resposta']]); assert.deepEqual(read, [['telegram:-123', 3]]);
    await update({ action: 'toggle-group', enabled: false }); await callbacks.onMessage(msg('telegram:77:88', false, 4)); assert.equal(privateMessages.length, 1);
    assert.equal((await update({ account: 'telegram:99', action: 'toggle-group', enabled: true })).ok, false);
    assert.equal((await update({ groupId: '1@g.us', action: 'toggle-group', enabled: true })).ok, false);
    await tg.disconnect(); await tg.restore(); assert.equal(restored, 2);
    await invoke('telegram:logout'); assert.equal(fs.existsSync(callbacks.sessionPath), false);
    assert.equal(fs.existsSync(path.join(root, 'telegram-web-state.json')), false);
    assert.equal(wa.settings()['1@g.us'].enabled, true);
    console.log('Integração Web: sessão sem API ID/Hash, restauração e remoção do perfil próprio, grupos, leitura e logout isolados do WhatsApp OK.');
  } finally { await tg.disconnect(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
