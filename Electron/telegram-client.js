const isTelegramGroupId = id => /^telegram:-\d+$/.test(id);
function validateCredentials(value = {}) {
  const apiId = Number(value.apiId), apiHash = String(value.apiHash || '').trim();
  if (!Number.isSafeInteger(apiId) || apiId <= 0 || !/^[a-f\d]{32}$/i.test(apiHash)) throw new Error('Informe o API ID e o API Hash obtidos em my.telegram.org.');
  return { apiId, apiHash };
}
function createTelegramTransport({ apiId, apiHash, session }) {
  // The optional cifrante native addon crashes on Electron/Windows. Its portable
  // backend implements the same MTProto encryption without loading that addon.
  if (process.versions.electron) process.env.CIFRANTE_NATIVE = '0';
  const { TelegramClient, Api, utils } = require('teleproto');
  const { StringSession } = require('teleproto/sessions');
  const { NewMessage } = require('teleproto/events');
  const client = new TelegramClient(new StringSession(session || ''), apiId, apiHash, {
    connectionRetries: 3, requestRetries: 2, autoReconnect: true, floodSleepThreshold: 0,
    deviceModel: 'TurboWhats', appVersion: '1.7.0'
  });
  client.setLogLevel('none');
  return { client, Api, NewMessage, peerId: peer => utils.getPeerId(peer).toString() };
}
function createTelegramConnection({ readAuth, writeAuth, clearAuth, onStatus = () => {}, onMessage = async () => {}, onReady = () => {}, onStop = () => {}, createClient = createTelegramTransport, now = Date.now }) {
  let client = null, generation = 0, task = null, pendingPassword = null, heartbeat = null, abortLogin = null;
  let state = { connected: false, phase: 'idle', account: '', label: '', error: '', qr: null };
  const entities = new Map();
  const seen = new Set();
  function status() { return { ...state, connected: state.connected && Boolean(client?.connected) }; }
  function emit(patch = {}) { state = { ...state, ...patch }; onStatus(status()); }
  function account() { return status().connected ? state.account : ''; }
  async function connect(credentials, { restoreOnly = false } = {}) {
    if (task || account()) return { ok: true };
    if (client && state.phase === 'ready') throw new Error('O Telegram está reconectando. Aguarde ou desconecte a sessão antes de gerar outro QR Code.');
    const saved = readAuth();
    const auth = validateCredentials(credentials || saved || {});
    if (saved?.session && credentials && (auth.apiId !== saved.apiId || auth.apiHash !== saved.apiHash)) throw new Error('Desconecte a sessão salva antes de trocar as credenciais.');
    const version = ++generation;
    abortLogin = new AbortController();
    const abortSignal = abortLogin.signal;
    const current = createClient({ ...auth, session: saved?.session || '' });
    client = current.client;
    entities.clear(); seen.clear();
    const live = () => version === generation;
    const ensureLive = () => { if (!live()) throw new Error('Conexão cancelada.'); };
    emit({ phase: 'connecting', connected: false, error: '', qr: null, account: '', passwordRequired: false });
    task = (async () => {
      try {
        await client.connect(); ensureLive();
        if (!await client.checkAuthorization()) {
          if (restoreOnly) throw new Error('A sessão do Telegram expirou. Gere um novo QR Code.');
          await client.signInUserWithQrCode(auth, {
            abortSignal,
            qrCode: async code => {
              ensureLive();
              const qr = await require('qrcode').toDataURL(`tg://login?token=${Buffer.from(code.token).toString('base64url')}`);
              ensureLive(); emit({ phase: 'qr', qr, expires: code.expires, passwordRequired: false });
            },
            password: async hint => {
              ensureLive(); emit({ phase: 'password', qr: null, passwordRequired: true, hint: String(hint || '') });
              return new Promise((resolve, reject) => { pendingPassword = { resolve, reject }; });
            },
            onError: async error => {
              if (live() && /PASSWORD_HASH_INVALID|password.*invalid/i.test(error.errorMessage || error.message)) {
                emit({ error: 'Senha incorreta. Tente novamente.' }); return false;
              }
              return true;
            }
          });
        }
        ensureLive();
        const me = await client.getMe(); ensureLive();
        writeAuth({ ...auth, session: client.session.save() });
        const startedAt = Math.floor(now() / 1000);
        const owner = `telegram:${me.id.toString()}`;
        client.addEventHandler(async event => {
          if (!live() || !account() || event.message?.out || event.message?.date < startedAt) return;
          const message = event.message;
          if (!message?.id || (!String(message.message || '').trim() && !message.media)) return;
          const peer = current.peerId(message.peerId);
          const group = event.isGroup === true;
          if (!group && event.isPrivate !== true) return; // Broadcast channels are excluded.
          const id = group ? `telegram:${peer}` : `${owner}:${peer}`;
          const key = `${id}:${message.id}`;
          if (seen.has(key)) return;
          seen.add(key); while (seen.size > 10000) seen.delete(seen.values().next().value);
          try {
            entities.set(id, await event.getInputChat());
            ensureLive();
            const mime = message.media?.document?.mimeType || (message.media?.photo ? 'image/jpeg' : '');
            await onMessage({ from: id, body: message.message || '', fromMe: false, id: { _serialized: key }, timestamp: message.date, isGroup: group, messageId: message.id,
              hasMedia: Boolean(mime), type: mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : mime ? 'document' : 'chat',
              downloadMedia: async () => {
                ensureLive();
                const size = Number(message.media?.document?.size || 0);
                if (size > 14 * 1024 * 1024) return null;
                const data = await current.client.downloadMedia(message);
                ensureLive();
                return Buffer.isBuffer(data) && data.length <= 14 * 1024 * 1024 ? { mimetype: mime, data: data.toString('base64') } : null;
              }
            });
          } catch (error) { if (live()) emit({ error: error.message }); }
        }, new current.NewMessage({ incoming: true }));
        emit({ connected: true, phase: 'ready', account: owner, label: me.username ? `@${me.username}` : [me.firstName, me.lastName].filter(Boolean).join(' '), qr: null, passwordRequired: false, error: '' });
        onReady();
        heartbeat = setInterval(() => { if (live()) onStatus(status()); }, 2000);
      } catch (error) {
        if (live()) {
          emit({ connected: false, phase: 'error', error: error.message, qr: null, passwordRequired: false });
          onStop(); await current.client.destroy().catch(() => {});
        }
      } finally { if (live()) task = null; }
    })();
    return { ok: true };
  }
  function password(value) {
    if (!pendingPassword || !String(value)) throw new Error('Não há solicitação de senha pendente.');
    const pending = pendingPassword; pendingPassword = null;
    emit({ passwordRequired: false, error: '', phase: 'connecting' }); pending.resolve(String(value));
    return { ok: true };
  }
  async function disconnect({ logout = false } = {}) {
    generation++; abortLogin?.abort(); abortLogin = null; clearInterval(heartbeat); heartbeat = null; onStop();
    pendingPassword?.reject(new Error('Conexão cancelada.')); pendingPassword = null;
    const oldClient = client; client = null; task = null; entities.clear(); seen.clear();
    emit({ connected: false, phase: 'idle', account: '', label: '', qr: null, error: '', passwordRequired: false });
    if (logout) {
      clearAuth();
      if (oldClient?.connected) {
        const { Api } = require('teleproto');
        await oldClient.invoke(new Api.auth.LogOut()).catch(() => {});
      }
    }
    if (oldClient) await oldClient.destroy().catch(() => {});
    return { ok: true };
  }
  async function listGroups() {
    const owner = account(), current = client;
    if (!owner) throw new Error('Conecte o Telegram para carregar os grupos.');
    const dialogs = await current.getDialogs({ limit: 500 });
    if (owner !== account() || current !== client) throw new Error('A conta do Telegram mudou.');
    return dialogs.filter(dialog => dialog.isGroup).map(dialog => {
      const id = `telegram:${dialog.id.toString()}`;
      entities.set(id, dialog.inputEntity);
      return { id, name: dialog.title || 'Grupo', photo: '' };
    });
  }
  function target(id) {
    if (!account()) throw new Error('Telegram desconectado.');
    if (!isTelegramGroupId(id) && !id.startsWith(`${account()}:`)) throw new Error('Destino de outra conta ou plataforma.');
    const entity = entities.get(id);
    if (!entity) throw new Error('Atualize os grupos ou aguarde uma nova mensagem deste contato.');
    return entity;
  }
  async function send(id, text) {
    const entity = target(id);
    const parts = Array.from(String(text)).reduce((parts, char) => {
      if (!parts.length || parts[parts.length - 1].length + char.length > 4096) parts.push('');
      parts[parts.length - 1] += char; return parts;
    }, []);
    for (const part of parts) {
      if (entity !== target(id)) throw new Error('A sessão do Telegram mudou.');
      await client.sendMessage(entity, { message: part, parseMode: false });
    }
  }
  async function markRead(id, messageId) {
    if (!isTelegramGroupId(id)) return;
    await client.markAsRead(target(id), messageId);
  }
  async function typing(id) {
    const { Api } = require('teleproto');
    await client.invoke(new Api.messages.SetTyping({ peer: target(id), action: new Api.SendMessageTypingAction() }));
  }
  async function sendFile(id, buffer, name) {
    await client.sendFile(target(id), { file: Object.assign(Buffer.from(buffer), { name }), voiceNote: false });
  }
  return { connect, disconnect, password, status, account, listGroups, send, markRead, typing, sendFile };
}
module.exports = { createTelegramConnection, createTelegramTransport, validateCredentials, isTelegramGroupId };
