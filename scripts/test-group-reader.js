const assert = require('assert/strict');
const { EventEmitter } = require('events');
const { createGroupReader, readGroupMessagesFromPage, registerGroupMessageEvents } = require('../Electron/group-reader');
const { createGroupMonitor } = require('../Electron/group-monitor');
(async () => {
  let state = {}, account = 'test@c.us', snapshotFails = false;
  const sent = [], decisions = [], statuses = [], errors = [];
  const groupId = '1@g.us';
  const monitor = createGroupMonitor({ read: () => structuredClone(state), write: next => { state = next; }, account: () => account,
    send: async (...args) => { sent.push(args); }, report: decision => decisions.push(decision) });
  monitor.update({ groupId, action: 'save-command', trigger: '!privacy', response: 'Resposta simulada', enabled: true });
  monitor.update({ groupId, action: 'toggle-group', enabled: true });
  const message = (id, body = '!privacy', extra = {}) => ({ from: groupId, id: { _serialized: id }, body, timestamp: 1000, ...extra });
  let messages = [message('historical', '!privacy', { timestamp: 999 })];
  const reader = createGroupReader({
    snapshot: async () => { if (snapshotFails) throw new Error('Leitura temporariamente indisponível'); return messages; },
    handle: (msg, source) => monitor.handle(msg, source), onStatus: status => statuses.push(status), onError: error => errors.push(error.message),
    now: () => 1000000, intervalMs: 100000
  });
  try {
    await reader.start(); assert.equal(sent.length, 0);
    // New messages arrive in cache with no library event, even in already-read chat.
    messages.push(message('missed-event')); await reader.scan();
    assert.equal(sent.length, 1); assert.equal(decisions.at(-1).source, 'scan');
    await reader.accept(message('missed-event'), 'event'); await reader.scan(); assert.equal(sent.length, 1);
    const emitter = new EventEmitter(); registerGroupMessageEvents(emitter, reader);
    emitter.emit('message_create', message('live-event'));
    await new Promise(resolve => setImmediate(resolve)); assert.equal(sent.length, 2);
    messages.push(message('live-event')); await reader.scan(); assert.equal(sent.length, 2);
    emitter.emit('message_create', message('self', '!privacy', { fromMe: true, from: 'test@c.us', to: groupId }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sent.length, 2); assert.equal(decisions.at(-1).decision, 'own-message');
    messages.push(message('normal', 'Bom dia'), message('partial', 'olá !privacy'), message('late-history', '!privacy', { timestamp: 900 }));
    await reader.scan(); assert.equal(sent.length, 2); assert.equal(decisions.at(-1).decision, 'no-match');
    snapshotFails = true; await reader.scan(); assert.equal(errors.length, 1);
    snapshotFails = false; messages.push(message('after-error')); await reader.scan(); assert.equal(sent.length, 3); assert.equal(statuses.at(-1).error, '');
    monitor.update({ groupId, action: 'toggle-group', enabled: false });
    messages.push(message('inactive')); await reader.scan(); assert.equal(sent.length, 3);
    monitor.update({ groupId, action: 'toggle-group', enabled: true });
    await reader.scan(); assert.equal(sent.length, 3);
    reader.stop(); await reader.accept(message('stopped')); assert.equal(sent.length, 3);
    messages.push(message('offline')); await reader.start(); assert.equal(sent.length, 3);
    messages.push(message('reconnected')); await reader.scan(); assert.equal(sent.length, 4);
    const encrypted = message('encrypted-then-readable', '', { type: 'ciphertext' });
    messages.push(encrypted); await reader.scan(); assert.equal(sent.length, 4);
    encrypted.body = '!privacy'; encrypted.type = 'chat'; await reader.scan(); assert.equal(sent.length, 5);
    account = ''; messages.push(message('no-account')); await reader.scan(); assert.equal(sent.length, 5);
    // Test the actual page-side reader on raw WhatsApp models.
    const raw = { id: { _serialized: 'raw', remote: { _serialized: groupId }, fromMe: false }, body: '!privacy', t: 1000 };
    global.window = { require: () => ({ Chat: { getModelsArray: () => [{ id: { _serialized: groupId }, unreadCount: 0, msgs: { getModelsArray: () => [raw] } }] }, Msg: { getModelsArray: () => [raw, { ...raw, id: { _serialized: 'own', remote: groupId, fromMe: true } }] } }) };
    const result = readGroupMessagesFromPage(); assert.equal(result.length, 2); assert.equal(result[0].from, groupId); assert.equal(result[1].fromMe, true);
    assert.equal(readGroupMessagesFromPage([]).length, 0);
    assert.equal(readGroupMessagesFromPage(['other@g.us']).length, 0);
    assert.equal(readGroupMessagesFromPage([groupId]).length, 2);
    delete global.window;
    console.log('Leitura contínua: evento real simulado, evento perdido recuperado por varredura, grupo lido, deduplicação, mensagens próprias, histórico, falha/recuperação, grupo inativo e reconexão OK.');
  } finally { reader.stop(); }
  // Verify scheduling itself, with no explicit scan() from the test.
  let autoMessages = [], reads = 0, resolveHandled;
  const handled = new Promise(resolve => { resolveHandled = resolve; });
  const automatic = createGroupReader({ snapshot: async () => { reads++; return autoMessages; }, handle: async () => resolveHandled(), intervalMs: 10 });
  let deadline;
  try {
    await automatic.start();
    autoMessages.push({ id: { _serialized: 'timer-message' }, from: groupId, timestamp: Math.floor(Date.now() / 1000), body: '!privacy' });
    await Promise.race([handled, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('O temporizador não verificou novas mensagens')), 1000); })]);
    assert.ok(reads >= 2);
    console.log('Temporizador contínuo: nova mensagem processada sem evento e sem chamada manual de varredura.');
  } finally { clearTimeout(deadline); automatic.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
