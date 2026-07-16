// Função para consultar a IA Gemini (texto + multimodal + histórico)
const GEMINI_MODEL = 'gemini-3.5-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 90000;
const GEMINI_MAX_ATTEMPTS = 3;
const GEMINI_MAX_INLINE_BYTES = 14 * 1024 * 1024;

function isSupportedGeminiMime(mimeType) {
  return /^(image|audio|video)\//i.test(String(mimeType || '')) || mimeType === 'application/pdf';
}

function prepareGeminiAttachments(attachments) {
  const accepted = [];
  let totalBytes = 0;

  for (const attachment of Array.isArray(attachments) ? attachments : []) {
    if (!attachment?.data || !isSupportedGeminiMime(attachment.mime_type)) continue;
    const estimatedBytes = Math.floor(String(attachment.data).length * 0.75);
    if (estimatedBytes <= 0 || totalBytes + estimatedBytes > GEMINI_MAX_INLINE_BYTES) {
      console.warn('Mídia ignorada: o limite de anexos em uma solicitação ao Gemini foi excedido.');
      continue;
    }
    totalBytes += estimatedBytes;
    accepted.push(attachment);
  }

  return accepted;
}

async function callGemini(apiKey, body) {
  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    try {
      const response = await globalThis.fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': apiKey
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      let data = null;
      try {
        data = await response.json();
      } catch (_error) {
        // Some network/proxy failures return a response without JSON.
      }

      if (!response.ok) {
        const apiMessage = data?.error?.message;
        const friendlyMessages = {
          400: 'A solicitação foi recusada. Confira se a chave pertence a um projeto com acesso à API Gemini.',
          401: 'A chave da API não foi aceita.',
          403: 'A chave está sem permissão, bloqueada ou com restrições incompatíveis.',
          404: `O modelo ${GEMINI_MODEL} não está disponível para este projeto.`,
          429: 'O limite gratuito ou a cota da API foi atingido. Aguarde e tente novamente.',
          503: 'O Gemini está temporariamente sobrecarregado. Tente novamente em alguns instantes.'
        };
        const error = new Error(apiMessage || friendlyMessages[response.status] || `Gemini respondeu com HTTP ${response.status}.`);
        error.status = response.status;
        throw error;
      }

      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('O Gemini demorou mais de 90 segundos para responder. Verifique sua internet e tente novamente.');
      }

      const retryable = error instanceof TypeError || error.status === 429 || error.status >= 500;
      if (!retryable || attempt === GEMINI_MAX_ATTEMPTS) throw error;

      const retryDelay = attempt * 1000;
      console.warn(`Gemini indisponível; nova tentativa ${attempt + 1}/${GEMINI_MAX_ATTEMPTS} em ${retryDelay}ms.`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('Não foi possível consultar o Gemini.');
}

async function askGeminiIA(userId, userMessage, attachments) {
  const config = loadConfig();
  if (config.aiEnabled === false) return null;
  const apiKey = String(config.aiApiKey || '').trim();
  const contexts = Array.isArray(config.aiContexts)
    ? config.aiContexts.map(context => String(context).trim()).filter(Boolean)
    : [];
  const useConversation = config.aiUseConversation !== false;
  if (!apiKey) return null;

  const currentParts = [];
  const normalizedMessage = String(userMessage || '').trim();
  if (normalizedMessage) currentParts.push({ text: normalizedMessage });
  for (const attachment of prepareGeminiAttachments(attachments)) {
    currentParts.push({
      inline_data: {
        mime_type: attachment.mime_type,
        data: attachment.data
      }
    });
  }
  if (currentParts.length === 0) {
    currentParts.push({ text: 'O usuário enviou uma mensagem sem texto legível.' });
  }

  const contents = [];
  if (useConversation) {
    for (const turn of conversationByUser.get(userId) || []) {
      if ((turn.role === 'user' || turn.role === 'model') && turn.text) {
        contents.push({ role: turn.role, parts: [{ text: String(turn.text) }] });
      }
    }
  }
  contents.push({ role: 'user', parts: currentParts });

  const body = {
    contents,
    generationConfig: { maxOutputTokens: 1024 }
  };
  if (contexts.length) {
    body.system_instruction = {
      parts: [{ text: contexts.join('\n\n') }]
    };
  }

  try {
    const data = await callGemini(apiKey, body);
    recordGeminiUsage(data?.usageMetadata);
    const text = data?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('')
      .trim();
    if (!text) {
      console.warn('Gemini não retornou texto.', data?.candidates?.[0]?.finishReason || 'sem motivo informado');
    }
    return text || null;
  } catch (err) {
    console.error('Erro ao consultar o Gemini:', err.message);
    return null;
  }
}

const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const path = require('path');
const crypto = require('crypto');
const isSmokeTest = process.argv.includes('--smoke-test') || process.env.CCHATBOT_SMOKE_TEST === '1';

// A versão empacotada usa dados próprios e nunca importa contatos, chaves ou
// sessões da cópia executada pelo código-fonte no mesmo computador.
if (app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'TurboWhats-Portable'));
}

app.disableHardwareAcceleration();

// --- INÍCIO: Código do chatbot integrado ---
const { Client, LocalAuth, Message, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');

const legacyProjectRoot = path.join(__dirname, '..');
const persistentDataRoot = path.join(app.getPath('userData'), 'app-data');
const configPath = path.join(persistentDataRoot, 'config.json');
const runtimeLogPath = path.join(persistentDataRoot, 'runtime-errors.log');
const messageTrackerLogPath = path.join(persistentDataRoot, 'message-tracker.log');
const geminiUsagePath = path.join(persistentDataRoot, 'gemini-usage.json');
const firstMessageStatePath = path.join(persistentDataRoot, 'first-message-state.json');
const delay = ms => new Promise(res => setTimeout(res, ms));

function migratePersistentData() {
  fs.mkdirSync(persistentDataRoot, { recursive: true });

  if (!fs.existsSync(configPath)) {
    const configCandidates = [
      path.join(legacyProjectRoot, 'config.json'),
      path.join(app.getPath('userData'), 'config.json'),
      path.join(app.getPath('userData'), 'ChatBot WhatsApp', 'config.json')
    ].filter(candidate => fs.existsSync(candidate));

    configCandidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (configCandidates[0]) {
      fs.copyFileSync(configCandidates[0], configPath);
      console.log(`Configurações migradas para ${configPath}.`);
    }
  }
}

migratePersistentData();

function createEmptyGeminiUsage() {
  return {
    requests: 0,
    promptTokens: 0,
    responseTokens: 0,
    thoughtTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
    trackingStartedAt: new Date().toISOString(),
    lastRequestAt: null
  };
}

function normalizeGeminiUsage(value = {}) {
  const empty = createEmptyGeminiUsage();
  const number = key => Math.max(0, Number.isFinite(Number(value[key])) ? Number(value[key]) : 0);
  return {
    requests: number('requests'),
    promptTokens: number('promptTokens'),
    responseTokens: number('responseTokens'),
    thoughtTokens: number('thoughtTokens'),
    cachedTokens: number('cachedTokens'),
    totalTokens: number('totalTokens'),
    trackingStartedAt: value.trackingStartedAt || empty.trackingStartedAt,
    lastRequestAt: value.lastRequestAt || null
  };
}

function loadGeminiUsage() {
  if (!fs.existsSync(geminiUsagePath)) {
    const usage = createEmptyGeminiUsage();
    try {
      saveGeminiUsage(usage);
    } catch (error) {
      logRuntimeError('gemini:inicialização-consumo', error);
    }
    return usage;
  }
  try {
    return normalizeGeminiUsage(JSON.parse(fs.readFileSync(geminiUsagePath, 'utf8')));
  } catch (error) {
    logRuntimeError('gemini:leitura-consumo', error);
    return createEmptyGeminiUsage();
  }
}

function saveGeminiUsage(usage) {
  fs.mkdirSync(path.dirname(geminiUsagePath), { recursive: true });
  fs.writeFileSync(geminiUsagePath, JSON.stringify(normalizeGeminiUsage(usage), null, 2));
}

function recordGeminiUsage(metadata = {}) {
  const usage = loadGeminiUsage();
  const tokenCount = key => Math.max(0, Number(metadata?.[key]) || 0);
  const promptTokens = tokenCount('promptTokenCount');
  const responseTokens = tokenCount('candidatesTokenCount');
  const thoughtTokens = tokenCount('thoughtsTokenCount');
  const reportedTotal = tokenCount('totalTokenCount');
  usage.requests += 1;
  usage.promptTokens += promptTokens;
  usage.responseTokens += responseTokens;
  usage.thoughtTokens += thoughtTokens;
  usage.cachedTokens += tokenCount('cachedContentTokenCount');
  usage.totalTokens += reportedTotal || (promptTokens + responseTokens + thoughtTokens);
  usage.lastRequestAt = new Date().toISOString();
  try {
    saveGeminiUsage(usage);
  } catch (error) {
    logRuntimeError('gemini:gravação-consumo', error);
  }
}

function logRuntimeError(scope, error) {
  const message = error?.stack || error?.message || String(error);
  console.error(`[${scope}]`, message);
  try {
    fs.appendFileSync(runtimeLogPath, `${new Date().toISOString()} [${scope}] ${message}\n`);
  } catch (_logError) {
    // Logging must never interrupt customer service.
  }
}

function logMessageTracker(event, details = '') {
  const line = `${new Date().toISOString()} [${event}]${details ? ` ${details}` : ''}`;
  console.log(line);
  try {
    fs.appendFileSync(messageTrackerLogPath, `${line}\n`);
  } catch (_logError) {
    // Tracking must never interrupt customer service.
  }
}

if (!isSmokeTest) {
  const hasSingleInstanceLock = app.requestSingleInstanceLock();
  logMessageTracker('instancia-unica', hasSingleInstanceLock ? 'bloqueio adquirido' : 'outra instância detectada');
  if (!hasSingleInstanceLock) app.quit();
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function hashContactId(contactId) {
  return crypto.createHash('sha256').update(String(contactId || '')).digest('hex');
}

function loadFirstMessageState() {
  if (!fs.existsSync(firstMessageStatePath)) return new Set();
  try {
    const state = JSON.parse(fs.readFileSync(firstMessageStatePath, 'utf8'));
    const hashes = Array.isArray(state?.greetedContactHashes) ? state.greetedContactHashes : [];
    return new Set(hashes.filter(value => /^[a-f0-9]{64}$/i.test(String(value))));
  } catch (error) {
    logRuntimeError('primeira-mensagem:leitura', error);
    return new Set();
  }
}

function saveFirstMessageState() {
  try {
    fs.writeFileSync(firstMessageStatePath, JSON.stringify({
      version: 1,
      greetedContactHashes: [...greetedContactHashes]
    }, null, 2));
  } catch (error) {
    logRuntimeError('primeira-mensagem:gravação', error);
  }
}

function hasBotRespondedToContact(contactId) {
  return greetedContactHashes.has(hashContactId(contactId));
}

function rememberBotResponse(contactId) {
  const contactHash = hashContactId(contactId);
  if (greetedContactHashes.has(contactHash)) return;
  greetedContactHashes.add(contactHash);
  saveFirstMessageState();
}

function clearFirstMessageState() {
  greetedContactHashes.clear();
  firstMessagePromises.clear();
  try {
    if (fs.existsSync(firstMessageStatePath)) fs.rmSync(firstMessageStatePath, { force: true });
  } catch (error) {
    logRuntimeError('primeira-mensagem:limpeza', error);
  }
}

async function sendWhatsAppText(to, text, typingDelay = 1500) {
  await delay(typingDelay);
  try {
    const chat = await client.getChatById(to);
    await chat.sendStateTyping();
    await delay(typingDelay);
  } catch (error) {
    // Some modern @lid contacts cannot be resolved by getChatById. Sending
    // directly still works, so typing status must never block the reply.
    console.warn(`Não foi possível exibir "digitando" para ${to}: ${error.message}`);
  }
  await client.sendMessage(to, text);
}

const DEFAULT_CONFIG = {
  rules: [],
  defaultMessage: '',
  defaultNoReply: '',
  defaultMessagesEnabled: true,
  aiApiKey: '',
  aiContexts: [],
  aiEnabled: true,
  aiUseConversation: true,
  aiVoiceEnabled: false,
  elevenLabsApiKey: '',
  elevenLabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
  bulkContacts: []
};

function decryptStoredConfig(storedConfig) {
  const config = { ...DEFAULT_CONFIG, ...storedConfig };
  if (config.aiApiKeyEncrypted) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        config.aiApiKey = safeStorage.decryptString(Buffer.from(config.aiApiKeyEncrypted, 'base64'));
      }
    } catch (error) {
      logRuntimeError('configuração:descriptografia', error);
      config.aiApiKey = '';
    }
  }
  if (config.elevenLabsApiKeyEncrypted) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        config.elevenLabsApiKey = safeStorage.decryptString(Buffer.from(config.elevenLabsApiKeyEncrypted, 'base64'));
      }
    } catch (error) {
      logRuntimeError('configuração:descriptografia-elevenlabs', error);
      config.elevenLabsApiKey = '';
    }
  }
  delete config.aiApiKeyEncrypted;
  delete config.elevenLabsApiKeyEncrypted;
  return config;
}

function prepareConfigForStorage(config) {
  const storedConfig = { ...config };
  const apiKey = String(storedConfig.aiApiKey || '').trim();
  const elevenLabsApiKey = String(storedConfig.elevenLabsApiKey || '').trim();
  delete storedConfig.aiApiKeyEncrypted;
  delete storedConfig.elevenLabsApiKeyEncrypted;

  if (apiKey && safeStorage.isEncryptionAvailable()) {
    storedConfig.aiApiKeyEncrypted = safeStorage.encryptString(apiKey).toString('base64');
    delete storedConfig.aiApiKey;
  } else {
    storedConfig.aiApiKey = apiKey;
  }
  if (elevenLabsApiKey && safeStorage.isEncryptionAvailable()) {
    storedConfig.elevenLabsApiKeyEncrypted = safeStorage.encryptString(elevenLabsApiKey).toString('base64');
    delete storedConfig.elevenLabsApiKey;
  } else {
    storedConfig.elevenLabsApiKey = elevenLabsApiKey;
  }
  return storedConfig;
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(prepareConfigForStorage(config), null, 2));
}

function loadConfig() {
  if (!fs.existsSync(configPath)) return { ...DEFAULT_CONFIG };
  try {
    return decryptStoredConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')));
  } catch (error) {
    logRuntimeError('configuração:leitura', error);
    return { ...DEFAULT_CONFIG };
  }
}

function securePersistedConfig() {
  const config = loadConfig();
  if (config.aiApiKey && safeStorage.isEncryptionAvailable()) saveConfig(config);
}

function loadRules() {
  return loadConfig().rules || [];
}

function loadDefaultMessage() {
  return loadConfig().defaultMessage || '';
}

function loadDefaultNoReply() {
  return loadConfig().defaultNoReply || '';
}

const conversationByUser = new Map();
const greetedContactHashes = loadFirstMessageState();
const firstMessagePromises = new Map();
const processedMessageIds = new Map();
const processingMessageIds = new Set();
const MAX_TRACKED_MESSAGE_IDS = 5000;
const UNREAD_SCAN_INTERVAL_MS = 8000;
let unreadScanTimer = null;
let unreadScanRunning = false;
let lastTrackerHeartbeatAt = 0;

// Sistema de fila para evitar respostas múltiplas
const messageQueue = new Map(); // userId -> { messages: [], processing: boolean, timer: null }
const QUEUE_DELAY = 2000; // 2 segundos para agrupar mensagens

async function sendConfiguredFirstMessage(contactId, message) {
  if (hasBotRespondedToContact(contactId)) return false;
  if (firstMessagePromises.has(contactId)) {
    await firstMessagePromises.get(contactId);
    return false;
  }

  const sendPromise = (async () => {
    await sendWhatsAppText(contactId, message);
    rememberBotResponse(contactId);
    return true;
  })();
  firstMessagePromises.set(contactId, sendPromise);
  try {
    return await sendPromise;
  } finally {
    firstMessagePromises.delete(contactId);
  }
}

let mainWindow = null;
let bulkJob = null;

// Sessão persistente fora da pasta do projeto para sobreviver a atualizações.
const sessionPath = path.join(persistentDataRoot, 'whatsapp-session');
const legacySessionCandidates = [
  path.join(legacyProjectRoot, 'whatsapp-session'),
  path.join(app.getPath('userData'), 'whatsapp-session')
];

function directoryHasEntries(directory) {
  try {
    return fs.existsSync(directory) && fs.readdirSync(directory).length > 0;
  } catch (_error) {
    return false;
  }
}

if (!directoryHasEntries(sessionPath)) {
  const legacySession = legacySessionCandidates.find(directoryHasEntries);
  if (legacySession) {
    fs.cpSync(legacySession, sessionPath, { recursive: true, force: false });
    console.log(`Sessão do WhatsApp migrada para ${sessionPath}.`);
  }
}
fs.mkdirSync(sessionPath, { recursive: true });

function resolveWhatsAppBrowserExecutable() {
  if (app.isPackaged) {
    const bundledExecutable = path.join(process.resourcesPath, 'browser', 'chrome.exe');
    if (!fs.existsSync(bundledExecutable)) {
      throw new Error(`Navegador interno não encontrado em ${bundledExecutable}. Reinstale o aplicativo.`);
    }
    return bundledExecutable;
  }

  try {
    const developmentExecutable = require('puppeteer').executablePath();
    if (developmentExecutable && fs.existsSync(developmentExecutable)) return developmentExecutable;
  } catch (error) {
    logRuntimeError('whatsapp:navegador-desenvolvimento', error);
  }
  throw new Error('O navegador necessário para o WhatsApp não foi encontrado. Execute npm install novamente.');
}

const whatsappBrowserExecutable = resolveWhatsAppBrowserExecutable();

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'cchatbot',
    dataPath: sessionPath
  }),
  puppeteer: {
    headless: true,
    executablePath: whatsappBrowserExecutable,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--disable-translate'
    ],
    timeout: 60000
  },
  authTimeout: 120000,
  takeoverOnConflict: true,
  takeoverTimeoutMs: 5000
});

const QRCode = require('qrcode');

// ===== STATE TRACKING =====
let connectionState = {
  connected: false,
  attempting: false,
  lastError: null,
  retryCount: 0,
  maxRetries: 5
};

// ===== EVENT HANDLERS COM LOGGING DETALHADO =====
client.on('qr', qr => {
  connectionState.attempting = true;
  connectionState.retryCount = 0;
  console.log('📱 QR Code recebido, escaneie com seu WhatsApp');
  console.log('⏱️  Timeout: 5 minutos para escanear');

  // Gera imagem base64 do QR code e envia para renderer
  QRCode.toDataURL(qr, (err, url) => {
    if (!err && mainWindow) {
      mainWindow.webContents.send('wa-qr', url);
      mainWindow.webContents.send('wa-status', {
        connected: false,
        message: '📱 Escaneie o QR Code com seu WhatsApp para conectar',
        loading: true,
        phase: 'qr',
        progress: 10
      });
    } else if (err) {
      console.error('Erro ao gerar QR Code:', err);
    }
  });
});

client.on('loading_screen', (percent, message) => {
  console.log(`⏳ Carregando... ${percent}% - ${message}`);

  const loadingMessage = String(message || '');
  let friendlyMessage = 'Organizando os dados do WhatsApp...';
  if (loadingMessage.includes('LOADING_INITIAL_STATE')) {
    friendlyMessage = 'Validando os dados da sua conta...';
  } else if (loadingMessage.includes('LOADING_CHATS')) {
    friendlyMessage = 'Carregando conversas e mensagens não lidas...';
  } else if (loadingMessage.includes('SYNC')) {
    friendlyMessage = 'Sincronizando suas conversas...';
  }

  if (mainWindow) {
    mainWindow.webContents.send('wa-status', {
      connected: false,
      message: friendlyMessage,
      loading: true,
      phase: 'sync',
      progress: Math.min(95, 55 + Math.round(Number(percent || 0) * 0.4))
    });
  }
});

client.on('authenticated', () => {
  console.log('✅ Autenticação bem-sucedida!');
  connectionState.attempting = false;
  connectionState.retryCount = 0;
  if (mainWindow) {
    mainWindow.webContents.send('wa-qr', null);
    mainWindow.webContents.send('wa-status', {
      connected: false,
      message: 'QR Code confirmado. Autenticando sua conta...',
      loading: true,
      phase: 'authenticated',
      progress: 45
    });
  }
});

client.on('auth_failure', msg => {
  stopUnreadScanner();
  connectionState.lastError = msg;
  connectionState.attempting = false;
  console.error('❌ Falha na autenticação:', msg);

  const errorMsg = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);

  if (mainWindow) {
    mainWindow.webContents.send('wa-status', {
      connected: false,
      error: 'Falha na autenticação - Gerando novo QR Code...',
      details: errorMsg
    });
  }

  // Tentar reconectar automaticamente
  setTimeout(() => {
    if (connectionState.retryCount < connectionState.maxRetries) {
      connectionState.retryCount++;
      console.log(`🔄 Tentativa de reconexão ${connectionState.retryCount}/${connectionState.maxRetries}`);
      attemptReconnect();
    } else {
      console.error('❌ Máximo de tentativas de reconexão atingido');
      if (mainWindow) {
        mainWindow.webContents.send('wa-status', {
          connected: false,
          error: 'Máximo de tentativas atingido. Clique em "Reconectar" para tentar novamente.'
        });
      }
    }
  }, 3000);
});

client.on('ready', () => {
  connectionState.connected = true;
  connectionState.attempting = false;
  connectionState.retryCount = 0;
  connectionState.lastError = null;
  console.log('✅ WhatsApp conectado e pronto para usar!');
  console.log(`🕐 Conectado em: ${new Date().toLocaleString('pt-BR')}`);
  startUnreadScanner();
  if (mainWindow) {
    mainWindow.webContents.send('wa-qr', null);
    mainWindow.webContents.send('wa-status', {
      connected: true,
      message: 'Conectado com sucesso! 🎉',
      phase: 'ready',
      progress: 100
    });
  }
});

client.on('disconnected', (reason) => {
  stopUnreadScanner();
  connectionState.connected = false;
  console.log('⚠️ WhatsApp desconectado. Motivo:', reason);

  let errorMessage = 'Desconectado';
  if (reason === 'LOGOUT') {
    errorMessage = 'Desconectado via logout';
  } else if (reason === 'CONFLICT') {
    errorMessage = 'Conflito de sessão detectado - reconectando...';
  } else if (reason === 'REPLACED') {
    errorMessage = 'Sessão substituída em outro dispositivo';
  } else {
    errorMessage = `Erro de conexão: ${reason}`;
  }

  if (mainWindow) {
    mainWindow.webContents.send('wa-status', {
      connected: false,
      error: errorMessage,
      attempting: connectionState.attempting,
      retryCount: connectionState.retryCount
    });
  }

  // LocalAuth gerencia a remoção dos arquivos quando o logout é solicitado.
});

// ===== FUNÇÃO DE RECONEXÃO COM RETRY =====
async function attemptReconnect() {
  try {
    stopUnreadScanner();
    console.log('🔄 Iniciando reconexão...');
    await client.destroy().catch(() => {});
    await delay(1000);
    await client.initialize();
  } catch (err) {
    console.error('❌ Erro na reconexão:', err.message);
    connectionState.lastError = err.message;
    if (connectionState.retryCount < connectionState.maxRetries) {
      connectionState.retryCount++;
      console.log(`⏳ Aguardando 5s antes da tentativa ${connectionState.retryCount}/${connectionState.maxRetries}`);
      setTimeout(attemptReconnect, 5000);
    }
  }
}

// Função para processar fila de mensagens
async function processMessageQueue(userId) {
  const queue = messageQueue.get(userId);
  if (!queue || queue.processing || queue.messages.length === 0) return;

  queue.processing = true;
  queue.timer = null;
  const pendingMessages = queue.messages.splice(0, queue.messages.length);
  let batchHandled = false;

  try {
    // Processa apenas o lote atual; mensagens novas permanecem na fila seguinte.
    const allMessages = pendingMessages.map(msg => msg.text).filter(Boolean).join('\n\n');
    const allAttachments = pendingMessages.flatMap(msg => msg.attachments || []);

    // Processa com IA considerando todo o contexto
    const iaReply = await askGeminiIA(userId, allMessages, allAttachments);

    if (iaReply && loadConfig().aiEnabled !== false) {
      await sendWhatsAppText(userId, iaReply);
      updateConversation(userId, allMessages, iaReply);
      await maybeSendTTS(userId, iaReply);
      batchHandled = true;
    } else if (loadConfig().aiEnabled === false) {
      batchHandled = true;
    }

  } catch (error) {
    console.error('Erro ao processar fila:', error);
  } finally {
    pendingMessages.forEach(message => message.resolve?.(batchHandled));
    queue.processing = false;
    if (queue.messages.length > 0) {
      if (queue.timer) clearTimeout(queue.timer);
      queue.timer = setTimeout(() => processMessageQueue(userId), QUEUE_DELAY);
    } else {
      messageQueue.delete(userId);
    }
  }
}

// Função para adicionar mensagem à fila
function addToMessageQueue(userId, message, attachments = []) {
  return new Promise(resolve => {
    if (!messageQueue.has(userId)) {
      messageQueue.set(userId, { messages: [], processing: false, timer: null });
    }

    const queue = messageQueue.get(userId);
    queue.messages.push({ text: message, attachments, timestamp: Date.now(), resolve });

    // Cancela timer anterior se existir
    if (queue.timer) {
      clearTimeout(queue.timer);
    }

    // Agenda processamento da fila
    queue.timer = setTimeout(() => {
      void processMessageQueue(userId);
    }, QUEUE_DELAY);
  });
}

async function processIncomingMessage(msg) {
  const config = loadConfig();
  const rules = loadRules();
  let defaultMessage = loadDefaultMessage();
  let defaultNoReply = loadDefaultNoReply();
  const aiEnabled = config.aiEnabled !== false;
  const defaultMessagesEnabled = config.defaultMessagesEnabled !== false;
  const originalText = String(msg.body || '');
  const received = originalText.trim().toLowerCase();

  // A primeira resposta automática para cada contato usa a mensagem inicial.
  if (defaultMessagesEnabled && defaultMessage && !hasBotRespondedToContact(msg.from)) {
    const sentFirstMessage = await sendConfiguredFirstMessage(msg.from, defaultMessage);
    if (sentFirstMessage) return true;
  }

  // Depois da primeira resposta, a IA assume sozinha enquanto estiver ativa.
  if (aiEnabled) {
    const attachments = [];
    try {
      if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        if (media?.data && isSupportedGeminiMime(media.mimetype)) {
          attachments.push({ data: media.data, mime_type: media.mimetype });
        } else if (media?.mimetype) {
          console.warn(`Mídia não suportada pelo Gemini ignorada: ${media.mimetype}`);
        }
      }
    } catch (error) {
      console.warn('Não foi possível baixar a mídia recebida:', error.message);
    }
    const handledByAi = await addToMessageQueue(msg.from, originalText, attachments);
    if (handledByAi) rememberBotResponse(msg.from);
    return handledByAi;
  }

  // Com a IA desativada, usa as regras e a mensagem padrão sem resposta.
  const rule = rules.find(r => received === String(r?.trigger || '').trim().toLowerCase());
  if (rule) {
    await sendWhatsAppText(msg.from, rule.response, 2000);
    rememberBotResponse(msg.from);
    return true;
  } else if (defaultMessagesEnabled && defaultNoReply) {
    // Se não houver regra, envia a mensagem padrão sem resposta.
    await sendWhatsAppText(msg.from, defaultNoReply, 2000);
    rememberBotResponse(msg.from);
    return true;
  }
  return true;
}

function rememberProcessedMessage(messageId) {
  processedMessageIds.set(messageId, Date.now());
  while (processedMessageIds.size > MAX_TRACKED_MESSAGE_IDS) {
    processedMessageIds.delete(processedMessageIds.keys().next().value);
  }
}

async function handleIncomingMessage(msg, source = 'event') {
  const from = String(msg?.from || '');
  if (msg?.fromMe || !/@(c\.us|lid)$/.test(from)) return true;

  const messageType = String(msg?.type || 'chat');
  const hasUserText = String(msg?.body || '').trim().length > 0;
  const hasSupportedMedia = msg?.hasMedia && ['image', 'audio', 'ptt', 'video', 'document'].includes(messageType);
  if (!hasUserText && !hasSupportedMedia) {
    logMessageTracker('ignorada', `${from} tipo ${messageType} sem conteúdo atendível`);
    return true;
  }

  const fallbackId = crypto.createHash('sha256')
    .update(`${from}|${msg?.timestamp || ''}|${messageType}|${msg?.body || ''}`)
    .digest('hex')
    .slice(0, 20);
  const messageId = String(msg?.id?._serialized || msg?.id?.id || `fallback:${fallbackId}`);
  if (processedMessageIds.has(messageId)) return true;
  if (processingMessageIds.has(messageId)) return false;

  processingMessageIds.add(messageId);
  try {
    console.log(`📨 Processando mensagem ${messageId} via ${source}.`);
    const handled = await processIncomingMessage(msg);
    if (handled !== false) {
      rememberProcessedMessage(messageId);
      logMessageTracker('respondida', `${messageId} via ${source}`);
    }
    return handled !== false;
  } catch (error) {
    logRuntimeError(`mensagem:${from || 'desconhecido'}:${source}`, error);
    return false;
  } finally {
    processingMessageIds.delete(messageId);
  }
}

client.on('message', msg => {
  if (msg?.fromMe || !/@(c\.us|lid)$/.test(String(msg?.from || ''))) return;
  // The event only wakes the scanner. It never sends directly: this gives the
  // user time to open the chat and guarantees that only still-unread chats reply.
  setTimeout(() => void scanUnreadMessages(), 1500);
});

async function getUnreadChatSummaries() {
  return await client.pupPage.evaluate(() => {
    const chats = window.require('WAWebCollections').Chat.getModelsArray();
    return chats.map(chat => {
      try {
        const id = chat.id?._serialized || chat.id?.toString?.() || '';
        return {
          id,
          unreadCount: Number(chat.unreadCount || 0),
          isGroup: id.endsWith('@g.us')
        };
      } catch (_error) {
        return null;
      }
    }).filter(Boolean);
  });
}

async function fetchUnreadMessagesForChat(chatId, requestedLimit) {
  const messageModels = await client.pupPage.evaluate(async (chatId, requestedLimit) => {
    const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
    if (!chat?.msgs) return [];

    const messages = chat.msgs.getModelsArray()
      .filter(message => !message.isNotification && !message.id?.fromMe)
      .sort((a, b) => Number(a.t || 0) - Number(b.t || 0))
      .slice(-requestedLimit);

    const serialized = [];
    for (const message of messages) {
      try {
        serialized.push(await window.WWebJS.getMessageModel(message));
      } catch (_error) {
        // One malformed message must not invalidate the entire chat scan.
      }
    }
    return serialized;
  }, chatId, requestedLimit);

  return messageModels.map(model => new Message(client, model));
}

async function scanUnreadMessages() {
  if (!connectionState.connected || unreadScanRunning) return;
  unreadScanRunning = true;

  try {
    const chats = await getUnreadChatSummaries();
    const now = Date.now();
    if (now - lastTrackerHeartbeatAt >= 5 * 60 * 1000) {
      logMessageTracker('rastreador-ativo', `${chats.length} conversa(s) verificadas`);
      lastTrackerHeartbeatAt = now;
    }
    const unreadChats = chats.filter(chat =>
      !chat.isGroup &&
      Number(chat.unreadCount || 0) !== 0 &&
      /@(c\.us|lid)$/.test(String(chat.id || ''))
    );

    if (unreadChats.length) {
      console.log(`🔎 Varredura encontrou ${unreadChats.length} conversa(s) não lida(s).`);
      const newUnread = unreadChats.filter(chat => Number(chat.unreadCount) > 0).length;
      const manuallyMarked = unreadChats.filter(chat => Number(chat.unreadCount) < 0).length;
      logMessageTracker('não-lidas', `${newUnread} com notificação; ${manuallyMarked} marcada(s) manualmente`);
    }

    for (const chat of unreadChats) {
      const rawUnreadCount = Number(chat.unreadCount || 0);
      const unreadCount = rawUnreadCount < 0
        ? 1
        : Math.min(Math.max(rawUnreadCount, 1), 50);
      let messages;
      try {
        messages = await fetchUnreadMessagesForChat(chat.id, unreadCount);
      } catch (error) {
        logRuntimeError(`varredura:${chat.id || 'chat'}`, error);
        continue;
      }

      let allHandled = true;
      for (const message of messages) {
        const source = rawUnreadCount < 0 ? 'marcada-não-lida' : 'não-lida';
        const handled = await handleIncomingMessage(message, source);
        if (!handled) allHandled = false;
      }

      if (allHandled && messages.length > 0) {
        try {
          await client.sendSeen(chat.id);
        } catch (error) {
          console.warn(`Não foi possível marcar ${chat.id || 'chat'} como lida: ${error.message}`);
        }
      }
    }
  } catch (error) {
    if (connectionState.connected) logRuntimeError('varredura-não-lidas', error);
  } finally {
    unreadScanRunning = false;
  }
}

function startUnreadScanner() {
  stopUnreadScanner();
  logMessageTracker('rastreador-iniciado', `intervalo ${UNREAD_SCAN_INTERVAL_MS}ms`);
  unreadScanTimer = setInterval(() => {
    void scanUnreadMessages();
  }, UNREAD_SCAN_INTERVAL_MS);
  setTimeout(() => void scanUnreadMessages(), 1500);
}

function stopUnreadScanner() {
  if (unreadScanTimer) clearInterval(unreadScanTimer);
  unreadScanTimer = null;
}
// --- FIM: Código do chatbot integrado ---

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 900,
    minHeight: 650,
    title: 'TurboWhats',
    icon: path.join(__dirname, 'assets', 'turbowhats-icon.png'),
    backgroundColor: '#08111f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const origin = new URL(url).origin;
      if (origin === 'https://aistudio.google.com' || origin === 'https://ai.google.dev') {
        shell.openExternal(url);
      }
    } catch (_error) {
      // Ignore malformed URLs.
    }
    return { action: 'deny' };
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.removeMenu();

  if (isSmokeTest) {
    mainWindow.webContents.once('did-finish-load', () => app.quit());
    return;
  }

  // Mostra a janela quando estiver pronta
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // ✅ Inicializa cliente WhatsApp APÓS janela estar pronta
  console.log('🚀 Iniciando cliente WhatsApp...');
  client.initialize().catch(err => {
    console.error('❌ Erro ao inicializar WhatsApp:', err);
    if (mainWindow) {
      mainWindow.webContents.send('wa-status', { connected: false, error: err.message });
    }
  });
}

// Garante uma única instância do app
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.turbowhats.app');
  }
  securePersistedConfig();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC para leitura/escrita de configuração com segurança
ipcMain.handle('config:read', async () => {
  try {
    return loadConfig();
  } catch (_err) {
    return { ...DEFAULT_CONFIG };
  }
});

ipcMain.handle('config:write', async (_event, newConfig) => {
  try {
    if (!newConfig || typeof newConfig !== 'object' || Array.isArray(newConfig)) {
      return { ok: false, error: 'Configuração inválida.' };
    }
    const previousConfig = loadConfig();
    const normalizedConfig = {
      ...newConfig,
      rules: Array.isArray(newConfig.rules) ? newConfig.rules : [],
      defaultMessagesEnabled: newConfig.defaultMessagesEnabled !== false,
      aiContexts: Array.isArray(newConfig.aiContexts)
        ? newConfig.aiContexts.map(context => String(context).trim()).filter(Boolean)
        : [],
      aiApiKey: String(newConfig.aiApiKey || '').trim(),
      aiEnabled: newConfig.aiEnabled !== false,
      aiUseConversation: newConfig.aiUseConversation !== false,
      aiVoiceEnabled: newConfig.aiVoiceEnabled === true,
      elevenLabsApiKey: String(newConfig.elevenLabsApiKey || '').trim(),
      elevenLabsVoiceId: String(newConfig.elevenLabsVoiceId || DEFAULT_CONFIG.elevenLabsVoiceId),
      bulkContacts: Array.isArray(newConfig.bulkContacts) ? newConfig.bulkContacts : []
    };
    saveConfig(normalizedConfig);
    if (previousConfig.aiUseConversation !== false && normalizedConfig.aiUseConversation === false) {
      conversationByUser.clear();
    }
    if (previousConfig.aiEnabled !== false && normalizedConfig.aiEnabled === false) {
      conversationByUser.clear();
      for (const queue of messageQueue.values()) {
        if (queue.timer) clearTimeout(queue.timer);
        queue.messages.forEach(message => message.resolve?.(true));
        queue.messages = [];
      }
      messageQueue.clear();
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('gemini:test-api-key', async (_event, apiKey) => {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) return { ok: false, error: 'Informe uma chave da API Gemini.' };
  if (key.length > 256) return { ok: false, error: 'A chave informada é inválida.' };

  try {
    const data = await callGemini(key, {
      contents: [{ role: 'user', parts: [{ text: 'Responda apenas com: OK' }] }],
      generationConfig: { maxOutputTokens: 256 }
    });
    // callGemini only returns for a successful HTTP response. A candidate can
    // legitimately contain no visible text (for example, thinking or a safety
    // finish), but the successful response already proves the key is accepted.
    return {
      ok: true,
      model: GEMINI_MODEL,
      receivedText: data?.candidates?.[0]?.content?.parts
        ?.some(part => typeof part.text === 'string') === true
    };
  } catch (error) {
    console.error('Falha ao testar a chave Gemini:', error.message);
    return { ok: false, error: error.message || String(error), status: error.status || null };
  }
});

ipcMain.handle('gemini:get-usage', async () => ({
  ok: true,
  model: GEMINI_MODEL,
  ...loadGeminiUsage()
}));

// Handler para reconectar WhatsApp
ipcMain.handle('whatsapp:reconnect', async () => {
  try {
    console.log('🔄 Tentando reconectar ao WhatsApp...');
    connectionState.retryCount = 0;

    await client.destroy().catch(() => {});

    // Aguardar um pouco antes de reinicializar
    await new Promise(r => setTimeout(r, 2000));

    // Reinicializar
    console.log('🚀 Reinicializando cliente...');
    await client.initialize();
    return { ok: true };
  } catch (err) {
    console.error('❌ Erro ao reconectar:', err.message);
    connectionState.lastError = err.message;
    return { ok: false, error: err.message };
  }
});

function localAuthSessionPath() {
  const sessionDirectory = path.resolve(sessionPath, 'session-cchatbot');
  const resolvedSessionRoot = path.resolve(sessionPath);
  if (!sessionDirectory.startsWith(`${resolvedSessionRoot}${path.sep}`)) {
    throw new Error('Caminho da sessão inválido.');
  }
  return sessionDirectory;
}

function removeLocalAuthSession() {
  const sessionDirectory = localAuthSessionPath();
  if (fs.existsSync(sessionDirectory)) {
    fs.rmSync(sessionDirectory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 500
    });
  }
}

async function logoutAndClearWhatsAppSession() {
  stopUnreadScanner();
  try {
    await client.logout();
  } catch (_logoutError) {
    await client.destroy().catch(() => {});
  }
  await client.destroy().catch(() => {});
  removeLocalAuthSession();
  connectionState.connected = false;
  connectionState.attempting = false;
  conversationByUser.clear();
  messageQueue.clear();
  clearFirstMessageState();
  processedMessageIds.clear();
  processingMessageIds.clear();
}

ipcMain.handle('app:logout-and-quit', async () => {
  if (bulkJob) {
    return { ok: false, error: 'Cancele o disparo em andamento antes de sair.' };
  }

  try {
    await logoutAndClearWhatsAppSession();
    setTimeout(() => app.quit(), 100);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

// Encerra a autenticação atual e força a geração de um novo QR Code.
ipcMain.handle('whatsapp:reset', async () => {
  if (bulkJob) {
    return { ok: false, error: 'Cancele o disparo em andamento antes de resetar a conexão.' };
  }

  try {
    connectionState.connected = false;
    connectionState.attempting = true;
    connectionState.retryCount = 0;
    connectionState.lastError = null;
    if (mainWindow) {
      mainWindow.webContents.send('wa-status', {
        connected: false,
        message: 'Resetando a sessão do WhatsApp e preparando um novo QR Code...',
        loading: true,
        phase: 'reset',
        progress: 5
      });
      mainWindow.webContents.send('wa-qr', null);
    }

    await logoutAndClearWhatsAppSession();
    connectionState.attempting = true;

    await delay(1500);
    await client.initialize();
    return { ok: true };
  } catch (err) {
    connectionState.attempting = false;
    connectionState.lastError = err.message;
    if (mainWindow) {
      mainWindow.webContents.send('wa-status', {
        connected: false,
        error: `Não foi possível resetar a conexão: ${err.message}`
      });
    }
    return { ok: false, error: err.message || String(err) };
  }
});

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

function formatContactPhone(contact) {
  const countryCode = String(contact?.countryCode || '').replace(/\D/g, '');
  const areaCode = String(contact?.areaCode || '').replace(/\D/g, '');
  const localNumber = String(contact?.localNumber || '').replace(/\D/g, '');
  if (countryCode && areaCode && localNumber) {
    const formattedNumber = localNumber.length > 4
      ? `${localNumber.slice(0, -4)}-${localNumber.slice(-4)}`
      : localNumber;
    return `+${countryCode} (${areaCode}) ${formattedNumber}`;
  }
  const phone = normalizePhone(contact?.phone);
  return phone ? `+${phone}` : '';
}

function applyMessageTags(template, contact) {
  const fullName = String(contact?.name || '').trim() || 'Cliente';
  const firstName = fullName.split(/\s+/)[0];
  const now = new Date();
  const values = {
    nome: fullName,
    primeironome: firstName,
    telefone: formatContactPhone(contact),
    data: now.toLocaleDateString('pt-BR'),
    hora: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  };
  return String(template || '').replace(
    /\{(Nome|PrimeiroNome|Telefone|Data|Hora)\}/gi,
    (_match, tag) => values[tag.toLowerCase()]
  );
}

function sendBulkProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bulk:progress', payload);
  }
}

async function waitForBulkDelay(milliseconds, job) {
  const end = Date.now() + milliseconds;
  while (!job.cancelled && Date.now() < end) {
    await delay(Math.min(250, end - Date.now()));
  }
}

ipcMain.handle('bulk:select-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar imagem',
    properties: ['openFile'],
    filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('bulk:import-contacts', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar contatos',
    properties: ['openFile'],
    filters: [
      { name: 'Planilhas', extensions: ['xlsx', 'csv'] },
      { name: 'Todos os arquivos', extensions: ['*'] }
    ]
  });
  if (result.canceled) return { ok: true, contacts: [] };

  try {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const filePath = result.filePaths[0];
    if (path.extname(filePath).toLowerCase() === '.csv') {
      await workbook.csv.readFile(filePath);
    } else {
      await workbook.xlsx.readFile(filePath);
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) return { ok: false, error: 'A planilha não possui páginas.' };

    const normalizeHeader = value => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
    const headers = sheet.getRow(1).values.map(normalizeHeader);
    const nameColumn = headers.findIndex(value => ['nome', 'name', 'contato'].includes(value));
    const phoneColumn = headers.findIndex(value => ['whatsapp', 'telefone', 'celular', 'numero', 'phone'].includes(value));
    if (phoneColumn < 1) {
      return { ok: false, error: 'Crie uma coluna chamada WhatsApp, Telefone, Celular ou Número.' };
    }

    const contacts = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const phone = normalizePhone(row.getCell(phoneColumn).text);
      if (!phone) return;
      contacts.push({
        name: nameColumn > 0 ? row.getCell(nameColumn).text.trim() : '',
        phone
      });
    });
    return { ok: true, contacts };
  } catch (err) {
    return { ok: false, error: `Não foi possível importar a planilha: ${err.message}` };
  }
});

ipcMain.handle('bulk:start', async (_event, payload) => {
  if (bulkJob) return { ok: false, error: 'Já existe um envio em andamento.' };
  if (!connectionState.connected) return { ok: false, error: 'Conecte o WhatsApp antes de iniciar o envio.' };

  const contacts = Array.isArray(payload?.contacts) ? payload.contacts.slice(0, 5000) : [];
  const message = String(payload?.message || '').trim();
  const imagePath = payload?.imagePath ? path.resolve(String(payload.imagePath)) : null;
  const delayMs = Math.max(3000, Math.min(600000, Number(payload?.delaySeconds || 10) * 1000));
  if (!contacts.length) return { ok: false, error: 'Selecione pelo menos um contato.' };
  if (!message && !imagePath) return { ok: false, error: 'Informe uma mensagem ou selecione uma imagem.' };
  if (imagePath && !fs.existsSync(imagePath)) return { ok: false, error: 'A imagem selecionada não existe mais.' };

  const job = { cancelled: false };
  bulkJob = job;
  let sent = 0;
  let failed = 0;

  try {
    const media = imagePath ? MessageMedia.fromFilePath(imagePath) : null;
    for (let index = 0; index < contacts.length && !job.cancelled; index++) {
      const contact = contacts[index] || {};
      const phone = normalizePhone(contact.phone);
      const personalizedMessage = applyMessageTags(message, contact);
      let error = null;
      try {
        if (!phone) throw new Error('Número inválido');
        const numberId = await client.getNumberId(phone);
        if (!numberId) throw new Error('Número não registrado no WhatsApp');
        if (media) {
          await client.sendMessage(numberId._serialized, media, personalizedMessage ? { caption: personalizedMessage } : undefined);
        } else {
          await client.sendMessage(numberId._serialized, personalizedMessage);
        }
        sent++;
      } catch (err) {
        failed++;
        error = err.message || String(err);
      }

      sendBulkProgress({
        current: index + 1,
        total: contacts.length,
        sent,
        failed,
        contact: { name: String(contact.name || ''), phone: String(contact.phone || '') },
        error
      });
      if (index < contacts.length - 1 && !job.cancelled) await waitForBulkDelay(delayMs, job);
    }

    return { ok: true, cancelled: job.cancelled, sent, failed, total: contacts.length };
  } finally {
    bulkJob = null;
  }
});

ipcMain.handle('bulk:cancel', async () => {
  if (!bulkJob) return { ok: false, error: 'Nenhum envio está em andamento.' };
  bulkJob.cancelled = true;
  return { ok: true };
});

// ---- Conversa e TTS helpers ----
function updateConversation(userId, userText, modelText) {
  if (loadConfig().aiUseConversation === false) return;
  const history = conversationByUser.get(userId) || [];
  if (userText) history.push({ role: 'user', text: userText });
  if (modelText) history.push({ role: 'model', text: modelText });
  // Limita histórico
  while (history.length > 16) history.shift();
  conversationByUser.set(userId, history);
}

async function maybeSendTTS(to, text) {
  const config = loadConfig();
  if (!config.aiVoiceEnabled) return;
  if (!config.elevenLabsApiKey) {
    console.warn('TTS ativado, mas a chave da ElevenLabs não foi configurada.');
    return;
  }

  try {
    const voiceId = encodeURIComponent(config.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM');
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': config.elevenLabsApiKey
      },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' })
    });
    if (!response.ok) throw new Error(`ElevenLabs respondeu com HTTP ${response.status}`);
    const base64 = Buffer.from(await response.arrayBuffer()).toString('base64');
    const media = new MessageMedia('audio/mpeg', base64, 'resposta.mp3');
    await client.sendMessage(to, media);
  } catch (err) {
    console.error('TTS falhou:', err.message);
  }
}
