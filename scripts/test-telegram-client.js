const assert = require('assert/strict');
const { createTelegramConnection, isTelegramGroupId, validateCredentials } = require('../Electron/telegram-client');
const waitFor = async predicate => {
  for (let index = 0; index < 200; index++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('O estado esperado do Telegram não chegou.');
};
(async () => {
  const credentials = { apiId: 12345, apiHash: 'a'.repeat(32) };
  assert.throws(() => validateCredentials({ apiId: 0, apiHash: 'x' }), /API ID/);
  assert.equal(isTelegramGroupId('1@g.us'), false);
  const clients = [], statuses = [], received = [], sent = [], reads = [];
  let saved = null, stopped = 0, request2fa = true;
  function createClient(auth) {
    const client = {
      connected: false, session: { save: () => 'saved-session' },
      connect: async () => { client.connected = true; }, checkAuthorization: async () => Boolean(auth.session),
      getMe: async () => ({ id: 77n, username: 'test' }),
      signInUserWithQrCode: async (_auth, params) => {
        client.auth = params;
        await params.qrCode({ token: Buffer.from('first-token'), expires: 100 });
        await params.qrCode({ token: Buffer.from('second-token'), expires: 130 });
        if (request2fa) assert.equal(await params.password('dica'), 'senha-teste');
      },
      addEventHandler: callback => { client.event = callback; },
      getDialogs: async () => [
        { id: -100123n, isGroup: true, title: 'Grupo Telegram', inputEntity: 'group-entity' },
        { id: -100999n, isGroup: false, title: 'Canal', inputEntity: 'channel-entity' }
      ],
      sendMessage: async (entity, options) => { sent.push([entity, options]); },
      markAsRead: async (...args) => { reads.push(args); },
      destroy: async () => { client.connected = false; }, invoke: async () => {}
    };
    clients.push(client);
    return { client, peerId: value => String(value), NewMessage: class {} };
  }
  const tg = createTelegramConnection({ readAuth: () => saved, writeAuth: value => { saved = value; }, clearAuth: () => { saved = null; },
    createClient, now: () => 1000000, onStatus: state => statuses.push(state), onMessage: async msg => received.push(msg), onStop: () => { stopped++; } });
  try {
    await tg.connect(credentials); await tg.connect(credentials);
    assert.equal(clients.length, 1);
    await waitFor(() => tg.status().passwordRequired);
    const qrStates = statuses.filter(state => state.qr);
    assert.equal(qrStates.length, 2); assert.notEqual(qrStates[0].qr, qrStates[1].qr);
    tg.password('senha-teste'); await waitFor(() => tg.status().connected);
    assert.equal(tg.account(), 'telegram:77'); assert.equal(saved.session, 'saved-session');
    assert.ok(!JSON.stringify(saved).includes('senha-teste'));
    const groups = await tg.listGroups(); assert.deepEqual(groups.map(group => group.id), ['telegram:-100123']);
    await tg.send(groups[0].id, 'Olá 👋\nhttps://example.com');
    assert.equal(sent[0][0], 'group-entity'); assert.equal(sent[0][1].parseMode, false);
    await tg.send(groups[0].id, 'a'.repeat(4095) + '👋' + 'b'.repeat(5));
    assert.ok(sent.slice(1).every(([, options]) => options.message.length <= 4096));
    assert.equal(sent.slice(1).map(([, options]) => options.message).join(''), 'a'.repeat(4095) + '👋' + 'b'.repeat(5));
    const event = (peerId, id, extra = {}) => ({ isGroup: peerId < 0, isPrivate: peerId > 0,
      message: { id, peerId, date: 1000, message: '!ajuda', ...extra }, getInputChat: async () => `entity:${peerId}` });
    const client = clients[0];
    await client.event(event(-100123, 1)); await client.event(event(-100123, 1));
    await client.event(event(-100123, 2, { out: true }));
    await client.event(event(-100123, 3, { date: 999 }));
    assert.equal(received.length, 1); assert.equal(received[0].from, 'telegram:-100123');
    await client.event(event(88, 4)); assert.equal(received[1].from, 'telegram:77:88');
    await tg.send('telegram:77:88', 'Privada'); assert.equal(sent.at(-1)[0], 'entity:88');
    await assert.rejects(tg.send('telegram:99:88', 'Conta errada'), /outra conta/);
    await assert.rejects(tg.send('88@c.us', 'Plataforma errada'), /outra conta/);
    await tg.markRead('telegram:77:88', 4); assert.equal(reads.length, 0);
    await tg.markRead('telegram:-100123', 1); assert.deepEqual(reads, [['entity:-100123', 1]]);
    client.connected = false; assert.equal(tg.account(), '');
    client.connected = true; assert.equal(tg.account(), 'telegram:77');
    await tg.disconnect(); assert.equal(tg.account(), ''); assert.ok(saved);
    await client.event(event(88, 5)); assert.equal(received.length, 2);
    request2fa = false;
    await tg.connect(undefined, { restoreOnly: true }); await waitFor(() => tg.account());
    assert.equal(clients[1].auth, undefined); // Saved session bypasses QR and password.
    await tg.disconnect({ logout: true }); assert.equal(saved, null); assert.ok(stopped >= 2);
    console.log('Telegram: credenciais, QR renovado, 2FA, sessão, reconexão, deduplicação, histórico, isolamento de conta/plataforma, grupos e leitura restrita OK.');
  } finally { await tg.disconnect(); }
  // A cancelled network connection must not revive an obsolete session.
  let finish, writes = 0;
  const staleClient = { connected: false, connect: () => new Promise(resolve => { finish = resolve; }), destroy: async () => {}, checkAuthorization: async () => true, getMe: async () => ({ id: 1n }) };
  const stale = createTelegramConnection({ readAuth: () => null, writeAuth: () => { writes++; }, clearAuth: () => {}, createClient: () => ({ client: staleClient }) });
  await stale.connect(credentials); await stale.disconnect(); finish();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(writes, 0); assert.equal(stale.account(), '');
  console.log('Telegram: conexão cancelada não revive sessão nem grava credenciais antigas.');
})().catch(error => { console.error(error); process.exitCode = 1; });
