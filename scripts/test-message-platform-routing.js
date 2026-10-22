const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('Electron/main.js', 'utf8');
(async () => {
  const sent = [], greetings = [], files = [];
  let selectedTelegram = false;
  const context = vm.createContext({
    Buffer, console,
    telegram: {
      hasSelectedGroup: () => selectedTelegram,
      send: async (...args) => sent.push(['telegram', ...args]),
      sendFile: async (...args) => files.push(args),
      typing: async () => {}
    },
    client: { sendMessage: async (...args) => sent.push(['whatsapp', ...args]) },
    loadConfig: () => ({ simulatedTypingEnabled: false, aiVoiceEnabled: true, elevenLabsApiKey: 'test-only' }),
    recordOutboundMetric() {}, simulateWhatsAppTyping: async () => {},
    fetch: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('test-audio') }),
    MessageMedia: class { constructor(type, data) { this.type = type; this.data = data; } }
  });
  vm.runInContext(source.slice(source.indexOf('async function sendWhatsAppText('), source.indexOf('const DEFAULT_CONFIG =')), context);
  vm.runInContext(source.slice(source.indexOf('async function maybeSendTTS(')), context);
  await context.sendWhatsAppText('telegram:77:88', 'Telegram');
  await context.sendWhatsAppText('88@c.us', 'WhatsApp');
  assert.equal(sent[0][0], 'telegram'); assert.equal(sent[0][1], 'telegram:77:88');
  assert.equal(sent[1][0], 'whatsapp'); assert.equal(sent[1][1], '88@c.us');
  assert.equal(sent[1][3].sendSeen, false);
  selectedTelegram = true;
  await assert.rejects(context.sendWhatsAppText('telegram:77:88', 'Não enviar'), /privado pausado/);
  await context.sendWhatsAppText('88@c.us', 'WhatsApp continua');
  assert.equal(sent.length, 3); assert.equal(sent[2][0], 'whatsapp');
  selectedTelegram = false;
  await context.maybeSendTTS('telegram:77:88', 'Voz Telegram');
  assert.equal(files[0][0], 'telegram:77:88'); assert.equal(files[0][1].toString(), 'test-audio'); assert.equal(sent.length, 3);
  // Greeting state and reset remain separate even with matching contact IDs.
  const state = vm.createContext({
    greetedContactHashes: new Set(), telegramGreetedContactHashes: new Set(), firstMessagePromises: new Map(),
    hashContactId: id => id, saveFirstMessageState: id => greetings.push(id),
    fs: { existsSync: () => false }, firstMessageStatePath: 'wa-state', logRuntimeError() {}
  });
  vm.runInContext(source.slice(source.indexOf('function hasBotRespondedToContact('), source.indexOf('function calculateSimulatedTypingDelay(')), state);
  state.rememberBotResponse('88@c.us'); state.rememberBotResponse('telegram:77:88');
  state.firstMessagePromises.set('telegram:77:88', true);
  state.clearFirstMessageState();
  assert.equal(state.hasBotRespondedToContact('88@c.us'), false);
  assert.equal(state.hasBotRespondedToContact('telegram:77:88'), true);
  assert.equal(state.firstMessagePromises.has('telegram:77:88'), true);
  console.log('Rotas reais do main: texto/áudio Telegram nunca usam cliente WhatsApp; pausa privada e primeira resposta isoladas por plataforma OK.');
})().catch(error => { console.error(error); process.exitCode = 1; });
