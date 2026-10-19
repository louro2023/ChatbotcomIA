const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('Electron/main.js', 'utf8');
(async () => {
  let enabled = true, scans = 0, processed = 0;
  const seen = [], handled = [];
  const context = vm.createContext({
    connectionState: { connected: true }, unreadScanRunning: false,
    groupMonitor: { settings: () => ({ 'selected@g.us': { enabled } }), handle: async msg => { handled.push(msg.from); return true; } },
    client: { sendSeen: async id => { seen.push(id); } },
    getUnreadChatSummaries: async () => { scans++; return [{ id: 'private@c.us', unreadCount: 1 }]; },
    fetchUnreadMessagesForChat: async () => [{ from: 'private@c.us' }],
    handleIncomingMessage: async () => { processed++; return true; },
    lastTrackerHeartbeatAt: 0, logMessageTracker() {}, logRuntimeError(error) { throw error; }, console
  });
  vm.runInContext(source.slice(source.indexOf('function hasSelectedGroup()'), source.indexOf('function startUnreadScanner()')), context);
  await context.scanUnreadMessages();
  assert.equal(scans, 0); assert.equal(processed, 0); assert.deepEqual(seen, []);
  enabled = false;
  await context.scanUnreadMessages();
  assert.equal(scans, 1); assert.equal(processed, 1); assert.deepEqual(seen, []);
  enabled = true;
  const handler = source.slice(source.indexOf('handle: async (message, source) =>'), source.indexOf('  onStatus: status =>'));
  const reader = vm.runInContext(`({ ${handler} })`, context);
  await reader.handle({ from: 'private@c.us' });
  await reader.handle({ from: 'other@g.us' });
  await reader.handle({ from: 'selected@g.us', fromMe: true });
  await reader.handle({ from: 'selected@g.us' });
  assert.deepEqual(seen, ['selected@g.us']);
  assert.deepEqual(handled, ['selected@g.us', 'selected@g.us']);
  console.log('Isolamento: grupo ativo bloqueia varredura privada; conversas privadas não recebem confirmação de leitura; somente o grupo selecionado é marcado como lido.');
})().catch(error => { console.error(error); process.exitCode = 1; });
