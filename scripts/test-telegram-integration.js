const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { installTelegram } = require('../Electron/telegram-integration');
const { createGroupMonitor } = require('../Electron/group-monitor');
(async () => {
  fs.mkdirSync('.build-cache/telegram-tests', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.build-cache/telegram-tests/run-'));
  const ipc = new Map(), sends = [], reads = [], privateMessages = [], statuses = [];
  let owner = '', callbacks, writes = {}, waState = {};
  const key = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => { const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, nonce); const data = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([nonce, cipher.getAuthTag(), data]); },
    decryptString: value => { const decipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString(); }
  };
  const wa = createGroupMonitor({ account: () => 'whatsapp@c.us', read: () => structuredClone(waState), write: state => { waState = state; }, send: async () => {} });
  wa.update({ groupId: '1@g.us', action: 'toggle-group', enabled: true });
  const tg = installTelegram({
    ipcMain: { handle: (name, callback) => ipc.set(name, callback) }, safeStorage, root,
    emit: (name, data) => statuses.push([name, data]), processPrivate: async msg => privateMessages.push(msg),
    onError: error => { throw error; },
    connectionFactory: options => {
      callbacks = options;
      return {
        connect: async credentials => {
          writes = credentials || options.readAuth();
          options.writeAuth({ ...writes, session: 'fake-session-secret' });
          owner = 'telegram:77'; options.onReady(); return { ok: true };
        },
        account: () => owner,
        status: () => ({ connected: Boolean(owner), account: owner }),
        listGroups: async () => [{ id: 'telegram:-123', name: 'Grupo TG' }, { id: 'telegram:-456', name: 'Outro TG' }],
        send: async (...args) => sends.push(args), typing: async () => {}, markRead: async (...args) => reads.push(args),
        disconnect: async ({ logout } = {}) => { owner = ''; options.onStop(); if (logout) options.clearAuth(); return { ok: true }; }
      };
    }
  });
  const invoke = (name, payload) => ipc.get(name)(null, payload);
  try {
    await invoke('telegram:connect', { apiId: 12345, apiHash: 'a'.repeat(32) });
    await new Promise(resolve => setImmediate(resolve));
    const encrypted = fs.readFileSync(path.join(root, 'telegram-auth.bin'));
    assert.equal(encrypted.includes(Buffer.from('fake-session-secret')), false);
    assert.equal(callbacks.readAuth().session, 'fake-session-secret');
    const update = payload => invoke('telegram:groups:update', { account: owner, groupId: 'telegram:-123', ...payload });
    assert.equal((await update({ action: 'save-command', trigger: '!ajuda', response: 'Resposta TG', enabled: true })).ok, true);
    await update({ action: 'toggle-typing', enabled: false });
    await update({ action: 'toggle-group', enabled: true });
    assert.equal(wa.settings()['1@g.us'].enabled, true); // Telegram activation never disables WhatsApp.
    const message = (from, isGroup, id) => ({ from, isGroup, messageId: id, id: { _serialized: String(id) }, body: '!ajuda' });
    await callbacks.onMessage(message('telegram:-456', true, 1));
    await callbacks.onMessage(message('telegram:77:88', false, 2));
    assert.equal(privateMessages.length, 0); assert.equal(reads.length, 0);
    await callbacks.onMessage(message('telegram:-123', true, 3));
    assert.deepEqual(sends, [['telegram:-123', 'Resposta TG']]); assert.deepEqual(reads, [['telegram:-123', 3]]);
    assert.equal((await update({ action: 'toggle-group', enabled: false })).ok, true);
    await callbacks.onMessage(message('telegram:77:88', false, 4)); assert.equal(privateMessages.length, 1);
    assert.equal((await update({ account: 'telegram:99', action: 'toggle-group', enabled: true })).ok, false);
    assert.equal((await update({ groupId: '1@g.us', action: 'toggle-group', enabled: true })).ok, false);
    const runtime = await invoke('telegram:groups:runtime'); assert.equal(runtime.groups['telegram:-123'].sent, 1);
    await tg.disconnect(); await tg.restore(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(writes.session, 'fake-session-secret');
    await invoke('telegram:logout'); assert.equal(fs.existsSync(path.join(root, 'telegram-auth.bin')), false);
    assert.equal(wa.settings()['1@g.us'].enabled, true);
    console.log('Integração: armazenamento cifrado, restauração, grupos/comandos isolados por plataforma, leitura somente no grupo ativo, privado pausado e logout independente OK.');
  } finally { await tg.disconnect(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
