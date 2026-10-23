const { telegramWebPage } = require('./telegram-web-page');
const isTelegramGroupId = id => /^telegram:-\d+$/.test(id);
function createTelegramConnection({ sessionPath, executablePath, clearSession = () => {}, saveSession = () => {}, onStatus = () => {}, onMessage = async () => {}, onReady = () => {}, onStop = () => {}, launch = options => require('puppeteer').launch(options) }) {
  let browser = null, page = null, generation = 0, task = null, timer = null, polling = null;
  let state = { connected: false, phase: 'idle', account: '', label: '', error: '', qr: null };
  const seen = new Set();
  function status() { return { ...state, connected: state.connected && Boolean(browser?.connected) }; }
  function account() { return status().connected ? state.account : ''; }
  function emit(patch) { state = { ...state, ...patch }; onStatus(status()); }
  async function evaluate(action, args = {}) {
    if (!page || page.isClosed()) throw new Error('Telegram Web desconectado.');
    return page.evaluate(telegramWebPage, action, args);
  }
  async function poll(version = generation) {
    if (!browser || polling === version || version !== generation) return;
    polling = version;
    try {
      const next = await evaluate('state');
      if (version !== generation) return;
      if (!next.connected) {
        if (state.connected) { onStop(); seen.clear(); }
        emit({ connected: false, account: '', label: '', qr: null, passwordRequired: false, error: '', ...next }); return;
      }
      if (!state.connected || next.account !== state.account) {
        if (state.connected) onStop();
        seen.clear(); await evaluate('install', { owner: next.account });
        if (version !== generation) return;
        saveSession({ account: next.account });
        emit({ ...next, qr: null, passwordRequired: false, error: '' }); onReady();
      }
      const owner = account(), result = await evaluate('poll', { owner });
      for (const message of result.messages || []) {
        if (version !== generation || account() !== owner) return;
        const key = message.id?._serialized;
        if (!key || seen.has(key)) continue;
        seen.add(key); while (seen.size > 10000) seen.delete(seen.values().next().value);
        // Don't hold polling while AI or typing is in progress.
        void Promise.resolve().then(() => {
          if (version !== generation || account() !== owner) return;
          return onMessage({ ...message, downloadMedia: () => evaluate('media', { owner, key }) });
        }).catch(error => { if (version === generation) emit({ error: error.message }); });
      }
      onStatus(status());
    } catch (error) { if (version === generation) emit({ error: error.message }); }
    finally { if (polling === version) polling = null; }
  }
  async function connect() {
    if (task || browser) return { ok: true };
    const version = ++generation;
    emit({ connected: false, phase: 'connecting', account: '', qr: null, error: '', passwordRequired: false });
    const pending = task = { version };
    pending.promise = (async () => {
      let launched;
      try {
        launched = await launch({ headless: true, executablePath: typeof executablePath === 'function' ? executablePath() : executablePath,
          userDataDir: sessionPath, defaultViewport: { width: 1100, height: 850 },
          args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
          timeout: 60000, protocolTimeout: 60000 });
        if (version !== generation) { await launched.close(); return; }
        browser = launched;
        launched.once('disconnected', () => {
          if (version !== generation) return;
          clearInterval(timer); timer = null; browser = null; page = null; onStop();
          emit({ connected: false, phase: 'error', account: '', qr: null, error: 'O navegador do Telegram foi encerrado. Conecte novamente.' });
        });
        page = (await launched.pages())[0] || await launched.newPage();
        await page.goto('https://web.telegram.org/k/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        if (version !== generation) return;
        await poll(version);
        timer = setInterval(() => { void poll(version); }, 1500);
      } catch (error) {
        if (version === generation) {
          generation++; browser = null; page = null; onStop();
          emit({ connected: false, phase: 'error', account: '', qr: null, error: error.message });
        }
        if (launched) await launched.close().catch(() => {});
      } finally { if (task === pending) task = null; }
    })();
    return { ok: true };
  }
  async function password(value) {
    if (!String(value || '').trim()) throw new Error('Informe a senha de duas etapas.');
    await evaluate('password', { password: String(value) });
    emit({ passwordRequired: false, phase: 'connecting', error: '' }); return { ok: true };
  }
  async function disconnect({ logout = false } = {}) {
    generation++; clearInterval(timer); timer = null; onStop();
    const oldBrowser = browser, oldPage = page, pending = task; browser = null; page = null; task = null; seen.clear();
    try { if (logout && oldPage && !oldPage.isClosed()) await oldPage.evaluate(telegramWebPage, 'logout', {}).catch(() => {}); }
    finally {
      if (oldBrowser) await oldBrowser.close().catch(() => {});
      if (pending) await pending.promise;
      if (logout) clearSession();
      emit({ connected: false, phase: 'idle', account: '', label: '', qr: null, error: '', passwordRequired: false });
    }
    return { ok: true };
  }
  function target(id) {
    const owner = account();
    if (!owner) throw new Error('Telegram desconectado.');
    if (!isTelegramGroupId(id) && !String(id).startsWith(`${owner}:`)) throw new Error('Destino de outra conta ou plataforma.');
    return { owner, id };
  }
  async function listGroups() { const owner = account(); if (!owner) throw new Error('Conecte o Telegram para carregar os grupos.'); return evaluate('groups', { owner }); }
  async function send(id, text) {
    const args = target(id), version = generation, parts = [];
    for (const char of String(text)) { if (!parts.length || parts.at(-1).length + char.length > 4096) parts.push(''); parts[parts.length - 1] += char; }
    for (const part of parts) {
      if (generation !== version || account() !== args.owner) throw new Error('A sessão do Telegram mudou.');
      await evaluate('send', { ...args, text: part });
    }
  }
  async function markRead(id, messageId) { if (isTelegramGroupId(id)) await evaluate('read', { ...target(id), messageId }); }
  async function typing(id) { await evaluate('typing', target(id)); }
  async function sendFile(id, buffer, name) { await evaluate('file', { ...target(id), data: Buffer.from(buffer).toString('base64'), name }); }
  return { connect, disconnect, password, status, account, listGroups, send, markRead, typing, sendFile, poll };
}
module.exports = { createTelegramConnection, isTelegramGroupId };
