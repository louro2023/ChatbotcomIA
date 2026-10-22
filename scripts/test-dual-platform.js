const assert = require('assert/strict');
const { createGroupMonitor } = require('../Electron/group-monitor');
const { createGroupScheduler } = require('../Electron/group-scheduler');
const { isTelegramGroupId } = require('../Electron/telegram-client');
(async () => {
  let clock = 0;
  const sent = [], schedulers = [];
  const setup = (platform, groupId, isGroupId) => {
    let state = {};
    const send = async (id, text) => sent.push([platform, id, text]);
    const monitor = createGroupMonitor({ account: () => platform, read: () => structuredClone(state), write: value => { state = value; }, send, isGroupId });
    monitor.update({ groupId, action: 'toggle-group', enabled: true });
    monitor.update({ groupId, action: 'toggle-typing', enabled: false });
    monitor.update({ groupId, action: 'save-command', trigger: '!ajuda', response: platform, enabled: true });
    monitor.update({ groupId, action: 'save-schedule', intervalMinutes: 1, messages: [`${platform}-1`, `${platform}-2`], enabled: true });
    const scheduler = createGroupScheduler({ account: () => platform, settings: monitor.settings, send, isGroupId, now: () => clock });
    schedulers.push(scheduler); return { monitor, scheduler, groupId };
  };
  const wa = setup('whatsapp', '1@g.us');
  const tg = setup('telegram', 'telegram:-100123', isTelegramGroupId);
  try {
    for (const item of [wa, tg]) item.scheduler.start();
    await Promise.all([wa.scheduler.tick(), tg.scheduler.tick()]);
    clock = 60000; await Promise.all([wa.scheduler.tick(), tg.scheduler.tick()]);
    assert.deepEqual(sent, [['whatsapp', '1@g.us', 'whatsapp-1'], ['telegram', 'telegram:-100123', 'telegram-1']]);
    await Promise.all([wa.monitor.handle({ from: wa.groupId, body: '!ajuda', id: { _serialized: 'same' } }), tg.monitor.handle({ from: tg.groupId, body: '!ajuda', id: { _serialized: 'same' } })]);
    assert.deepEqual(sent.slice(2), [['whatsapp', '1@g.us', 'whatsapp'], ['telegram', 'telegram:-100123', 'telegram']]);
    assert.equal(await wa.monitor.handle({ from: tg.groupId, body: '!ajuda', id: { _serialized: 'cross' } }), false);
    assert.equal(await tg.monitor.handle({ from: wa.groupId, body: '!ajuda', id: { _serialized: 'cross' } }), false);
    tg.scheduler.stop(); clock += 60000; await Promise.all([wa.scheduler.tick(), tg.scheduler.tick()]);
    assert.deepEqual(sent.at(-1), ['whatsapp', '1@g.us', 'whatsapp-2']); assert.equal(sent.length, 5);
    console.log('Duas plataformas simultâneas: comandos e intervalos independentes, destinos separados e parada do Telegram preservando o WhatsApp OK.');
  } finally { schedulers.forEach(scheduler => scheduler.stop()); }
})().catch(error => { console.error(error); process.exitCode = 1; });
