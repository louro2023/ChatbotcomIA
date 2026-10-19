const assert = require('assert/strict');
const { createGroupScheduler } = require('../Electron/group-scheduler');
const { createGroupMonitor } = require('../Electron/group-monitor');
(async () => {
  let state = {}, owner = 'one@c.us', clock = 0, fail = false, release;
  const sent = [], reports = [];
  const monitor = createGroupMonitor({ read: () => structuredClone(state), write: next => { state = next; }, account: () => owner, send: async () => {} });
  const groupId = '1@g.us';
  const update = payload => monitor.update({ groupId, ...payload });
  const save = (extra = {}) => update({ action: 'save-schedule', intervalMinutes: 2, messages: ['Olá 👋\nhttps://example.com', 'Segunda mensagem'], enabled: true, ...extra });
  for (const intervalMinutes of [0, -1, 1.5, 10081, NaN]) assert.throws(() => save({ intervalMinutes }), /intervalo/);
  assert.throws(() => save({ messages: [' '] }), /mensagens/);
  assert.throws(() => save({ messages: Array(21).fill('x') }), /mensagens/);
  save(); update({ action: 'toggle-group', enabled: true });
  const scheduler = createGroupScheduler({ account: () => owner, settings: monitor.settings, now: () => clock,
    typing: async () => { if (release === 'wait') await new Promise(resolve => { release = resolve; }); },
    send: async (id, text) => { if (fail) throw new Error('Sem conexão'); sent.push([id, text]); }, report: event => reports.push(event),
    onError: error => { throw error; } });
  try {
    scheduler.start(); await scheduler.tick();
    assert.equal(sent.length, 0); assert.equal(scheduler.status()[groupId].nextAt, 120000);
    clock = 119999; await scheduler.tick(); assert.equal(sent.length, 0);
    clock = 120000; await Promise.all([scheduler.tick(), scheduler.tick()]);
    assert.deepEqual(sent, [[groupId, 'Olá 👋\nhttps://example.com']]);
    clock += 120000; await scheduler.tick(); assert.equal(sent.at(-1)[1], 'Segunda mensagem');
    clock += 1200000; await scheduler.tick(); assert.equal(sent.length, 3); // No backlog burst.
    await scheduler.tick(); assert.equal(sent.length, 3);
    fail = true; clock += 120000; await scheduler.tick();
    assert.equal(reports.at(-1).decision, 'send-error'); assert.equal(sent.length, 3);
    await scheduler.tick(); assert.equal(sent.length, 3);
    fail = false; clock += 120000; await scheduler.tick(); assert.equal(sent.at(-1)[1], 'Segunda mensagem');
    // Cancel a pending send if the group is changed while typing.
    clock += 120000; release = 'wait'; const pending = scheduler.tick();
    await new Promise(resolve => setImmediate(resolve));
    update({ action: 'toggle-group', enabled: false }); release(); await pending;
    assert.equal(sent.length, 4);
    await scheduler.tick(); assert.deepEqual(scheduler.status(), {});
    update({ action: 'toggle-group', enabled: true }); await scheduler.tick();
    assert.equal(scheduler.status()[groupId].nextAt, clock + 120000);
    save({ intervalMinutes: 1, messages: ['Editada'] }); await scheduler.tick();
    assert.equal(scheduler.status()[groupId].nextAt, clock + 60000);
    clock += 60000; await scheduler.tick(); assert.equal(sent.at(-1)[1], 'Editada');
    owner = 'two@c.us'; await scheduler.tick(); assert.deepEqual(scheduler.status(), {});
    clock += 600000; await scheduler.tick(); assert.equal(sent.length, 5);
    owner = ''; await scheduler.tick();
    owner = 'one@c.us'; await scheduler.tick(); assert.equal(sent.length, 5);
    assert.equal(scheduler.status()[groupId].nextAt, clock + 60000);
    scheduler.stop(); clock += 600000; await scheduler.tick(); assert.equal(sent.length, 5);
    scheduler.start(); await scheduler.tick(); assert.equal(sent.length, 5);
    assert.equal(scheduler.status()[groupId].nextAt, clock + 60000);
    console.log('Envio programado: validação, persistência, intervalo, variações, concorrência, falhas, edição, cancelamento, isolamento de conta e reinício sem acúmulo OK.');
  } finally { scheduler.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
