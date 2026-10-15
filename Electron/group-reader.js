// This function runs in WhatsApp Web and returns plain data, not WWebJS models.
function readGroupMessagesFromPage() {
  const collections = window.require('WAWebCollections');
  const messages = new Map();
  const idOf = value => typeof value === 'string' ? value : value?._serialized || '';
  const collect = (message, chatId = '') => {
    const remote = idOf(message.id?.remote) || chatId || idOf(message.from);
    if (!remote.endsWith('@g.us') || message.isNotification) return;
    const id = message.id?._serialized || message.id?.$1;
    if (!id) return;
    messages.set(id, {
      id: { _serialized: id }, from: remote,
      fromMe: message.id?.fromMe === true || message.fromMe === true,
      body: String(message.body || message.caption || ''), type: message.type, timestamp: Number(message.t || 0)
    });
  };
  for (const chat of collections.Chat.getModelsArray()) {
    const id = idOf(chat.id);
    if (!id.endsWith('@g.us')) continue;
    for (const message of chat.msgs?.getModelsArray?.() || []) collect(message, id);
  }
  for (const message of collections.Msg?.getModelsArray?.() || []) collect(message);
  return [...messages.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function createGroupReader({ snapshot, handle, onStatus = () => {}, onError = () => {}, now = Date.now, intervalMs = 2000, maxSeen = 20000 }) {
  let running = false, generation = 0, timer = null, startedAt = 0, seeded = false;
  const seen = new Set();
  const pending = new Set();
  function remember(id) {
    seen.add(id);
    while (seen.size > maxSeen) seen.delete(seen.values().next().value);
  }
  async function accept(message, source = 'event') {
    if (!running || !String(message?.from || '').endsWith('@g.us')) return;
    // A message can arrive encrypted and gain its body later under the same ID.
    // Do not mark that incomplete version as consumed.
    if (message.type === 'ciphertext' || !String(message.body || '').trim()) return;
    const id = require('./whatsapp-compat').serializedMessageId(message.id);
    if (!id || seen.has(id) || pending.has(id)) return;
    // Historical messages loaded later must never trigger automatic replies.
    if (source === 'scan' && (!message.timestamp || message.timestamp < startedAt)) { remember(id); return; }
    remember(id); pending.add(id);
    try { await handle(message, source); }
    catch (error) { onError(error, message.from); }
    finally { pending.delete(id); }
  }
  async function scan(version = generation) {
    if (!running) return;
    try {
      const messages = await snapshot();
      if (!running || version !== generation) return;
      if (!seeded) {
        // Existing messages are a baseline. Live events are processed separately.
        messages.forEach(message => { const id = require('./whatsapp-compat').serializedMessageId(message.id); if (id) remember(id); });
        seeded = true;
      } else {
        for (const message of messages) {
          if (!running || version !== generation) return;
          await accept(message, 'scan');
        }
      }
      if (running && version === generation) onStatus({ running: true, lastScanAt: new Date(now()).toISOString(), error: '' });
    } catch (error) {
      if (running && version === generation) { onError(error); onStatus({ running: true, error: error.message }); }
    }
  }
  function stop() { running = false; generation++; clearTimeout(timer); timer = null; onStatus({ running: false }); }
  async function start() {
    stop(); running = true; seeded = false; seen.clear(); startedAt = Math.floor(now() / 1000);
    const version = generation;
    await scan(version);
    const tick = async () => {
      if (!running || version !== generation) return;
      await scan(version);
      if (running && version === generation) timer = setTimeout(tick, intervalMs);
    };
    if (running && version === generation) timer = setTimeout(tick, intervalMs);
  }
  return { start, stop, accept, scan };
}
function registerGroupMessageEvents(client, reader) {
  client.on('message_create', message => {
    const groupId = String(message.fromMe ? message.to : message.from);
    if (!groupId.endsWith('@g.us')) return;
    void reader.accept({ from: groupId, body: message.body, type: message.type, fromMe: message.fromMe, id: message.id, timestamp: message.timestamp }, 'event');
  });
}
module.exports = { readGroupMessagesFromPage, createGroupReader, registerGroupMessageEvents };
