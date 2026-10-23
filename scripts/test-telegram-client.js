const assert = require('assert/strict');
const { EventEmitter } = require('events');
const { createTelegramConnection } = require('../Electron/telegram-client');
const wait = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  const calls = [], received = [], saved = [];
  let webState = { connected: false, phase: 'qr', qr: 'data:image/png;base64,first' }, queue = [], launched = 0;
  const page = { isClosed: () => false, goto: async url => assert.equal(url, 'https://web.telegram.org/k/'),
    evaluate: async (_fn, action, args) => {
      calls.push([action, args]);
      if (action === 'state') return webState;
      if (args?.owner && args.owner !== webState.account) throw new Error('A conta do Telegram mudou.');
      if (action === 'poll') { const messages = queue; queue = []; return { messages }; }
      if (action === 'groups') return [{ id: 'telegram:-123', name: 'Grupo' }];
      return { ok: true };
    } };
  const browser = new EventEmitter(); browser.connected = true;
  browser.pages = async () => [page]; browser.close = async () => { browser.connected = false; browser.emit('disconnected'); };
  let cleared = 0;
  const tg = createTelegramConnection({ sessionPath: 'telegram-only-profile', launch: async options => {
    launched++; assert.equal(options.headless, true); assert.equal(options.userDataDir, 'telegram-only-profile'); return browser;
  }, saveSession: value => saved.push(value), clearSession: () => { cleared++; }, onMessage: async msg => received.push(msg) });
  try {
    await tg.connect(); await wait(); await tg.connect(); assert.equal(launched, 1);
    assert.equal(tg.status().phase, 'qr'); assert.equal(tg.account(), '');
    webState = { connected: false, phase: 'qr', qr: 'data:image/png;base64,second' }; await tg.poll();
    assert.equal(tg.status().qr, webState.qr);
    webState = { connected: false, phase: 'password', passwordRequired: true }; await tg.poll();
    await tg.password('senha-teste'); assert.equal(calls.at(-1)[0], 'password');
    webState = { connected: true, phase: 'ready', account: 'telegram:77' }; await tg.poll();
    assert.equal(tg.account(), 'telegram:77'); assert.deepEqual(saved, [{ account: 'telegram:77' }]);
    assert.ok(!JSON.stringify(saved).includes('senha-teste'));
    assert.equal((await tg.listGroups())[0].id, 'telegram:-123');
    queue = [{ from: 'telegram:-123', id: { _serialized: 'same' }, body: '!ajuda' }, { from: 'telegram:-123', id: { _serialized: 'same' }, body: '!ajuda' }];
    await tg.poll(); await wait(); assert.equal(received.length, 1);
    await tg.send('telegram:-123', 'a'.repeat(4095) + '👋' + 'b'.repeat(4));
    const sent = calls.filter(([action]) => action === 'send'); assert.equal(sent.length, 2);
    assert.ok(sent.every(([, args]) => args.text.length <= 4096));
    await assert.rejects(tg.send('other@c.us', 'x'), /outra conta/);
    await assert.rejects(tg.send('telegram:99:88', 'x'), /outra conta/);
    await tg.markRead('telegram:77:88', 1); assert.equal(calls.filter(([action]) => action === 'read').length, 0);
    await tg.markRead('telegram:-123', 1); assert.equal(calls.at(-1)[0], 'read');
    await tg.disconnect(); assert.equal(cleared, 0); assert.equal(tg.account(), '');
  } finally { await tg.disconnect(); }
  let resolveLaunch, closed = false;
  const late = new EventEmitter(); late.connected = true; late.close = async () => { closed = true; };
  const stale = createTelegramConnection({ launch: () => new Promise(resolve => { resolveLaunch = resolve; }), clearSession: () => assert.equal(closed, true) });
  await stale.connect(); const stopping = stale.disconnect({ logout: true }); resolveLaunch(late); await stopping;
  assert.equal(closed, true); assert.equal(stale.account(), '');
  console.log('Cliente Web: QR renovado sem credenciais, senha 2FA transitória, perfil próprio, deduplicação, isolamento e cancelamento durante a abertura OK.');
})().catch(error => { console.error(error); process.exitCode = 1; });
