const fs = require('fs');
const path = require('path');
const { createTelegramConnection, isTelegramGroupId } = require('./telegram-client');
const { createGroupMonitor } = require('./group-monitor');
const { createGroupScheduler } = require('./group-scheduler');
const { recordGroupActivity } = require('./group-runtime');
function installTelegram({ ipcMain, safeStorage, root, emit, processPrivate, onError = () => {}, connectionFactory = createTelegramConnection }) {
  const authPath = path.join(root, 'telegram-auth.bin');
  const groupsPath = path.join(root, 'telegram-groups.json');
  let activity = {};
  const readGroups = () => fs.existsSync(groupsPath) ? JSON.parse(fs.readFileSync(groupsPath, 'utf8')) : {};
  const write = (file, bytes) => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, bytes); fs.renameSync(`${file}.tmp`, file);
  };
  const report = event => { activity[event.groupId] = recordGroupActivity(activity[event.groupId], event); };
  const typing = async (id, text) => {
    await tg.typing(id);
    await new Promise(resolve => setTimeout(resolve, Math.min(6000, Math.max(900, String(text || '').length * 38))));
  };
  const tg = connectionFactory({
    readAuth: () => {
      if (!fs.existsSync(authPath)) return null;
      if (!safeStorage.isEncryptionAvailable()) throw new Error('A criptografia do Windows está indisponível para abrir a sessão Telegram.');
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(authPath)));
    },
    writeAuth: auth => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('A criptografia do Windows está indisponível para salvar a sessão Telegram.');
      write(authPath, safeStorage.encryptString(JSON.stringify(auth)));
    },
    clearAuth: () => { if (fs.existsSync(authPath)) fs.unlinkSync(authPath); },
    onStatus: status => emit('telegram:status', status),
    onReady: () => {
      activity = {};
      void tg.listGroups().then(() => { if (tg.account()) scheduler.start(); }).catch(onError);
    },
    onStop: () => scheduler.stop(),
    onMessage: async message => {
      if (message.isGroup) {
        if (!monitor.settings()[message.from]?.enabled) return;
        try { await tg.markRead(message.from, message.messageId); } catch (error) { onError(error); }
        await monitor.handle(message, 'telegram');
      } else if (!hasSelectedGroup()) await processPrivate(message);
    }
  });
  const monitor = createGroupMonitor({
    account: tg.account, read: readGroups, write: state => write(groupsPath, JSON.stringify(state, null, 2)),
    send: tg.send, typing, report, isGroupId: isTelegramGroupId
  });
  const scheduler = createGroupScheduler({
    account: tg.account, settings: monitor.settings, send: tg.send, typing, report,
    onError, isGroupId: isTelegramGroupId
  });
  function hasSelectedGroup() { return Boolean(tg.account()) && Object.values(monitor.settings()).some(group => group.enabled); }
  const handle = (name, callback) => ipcMain.handle(name, async (_event, payload) => {
    try { return await callback(payload); } catch (error) { return { ok: false, error: error.message }; }
  });
  handle('telegram:state', () => ({ ...tg.status(), savedSession: fs.existsSync(authPath) }));
  handle('telegram:connect', async credentials => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('A criptografia do Windows está indisponível.');
    return tg.connect(credentials?.apiId ? credentials : undefined);
  });
  handle('telegram:password', password => tg.password(password));
  handle('telegram:logout', () => tg.disconnect({ logout: true }));
  handle('telegram:groups:list', async () => ({ ok: true, account: tg.account(), groups: await tg.listGroups(), settings: monitor.settings() }));
  handle('telegram:groups:update', async payload => {
    if (!tg.account() || payload?.account !== tg.account()) throw new Error('A conta do Telegram mudou ou está desconectada.');
    const groups = await tg.listGroups();
    if (!tg.account() || payload.account !== tg.account() || !groups.some(group => group.id === payload.groupId)) throw new Error('Grupo indisponível nesta conta.');
    return { ok: true, settings: monitor.update(payload) };
  });
  handle('telegram:groups:runtime', () => ({
    account: tg.account(), connected: Boolean(tg.account()), running: Boolean(tg.account()),
    lastScanAt: new Date().toISOString(), groups: activity, schedules: scheduler.status(), error: ''
  }));
  return {
    ...tg, hasSelectedGroup,
    restore: async () => {
      if (!fs.existsSync(authPath)) return;
      try { await tg.connect(undefined, { restoreOnly: true }); }
      catch (error) { emit('telegram:status', { connected: false, phase: 'error', error: error.message }); }
    }
  };
}
module.exports = { installTelegram };
