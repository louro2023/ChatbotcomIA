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
    recordAiResponseMetric(Boolean(text));
    return text || null;
  } catch (err) {
    console.error('Erro ao consultar o Gemini:', err.message);
    recordAiResponseMetric(false);
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
const nodemailer = require('nodemailer');
const {
  collectNewInstagramMatches,
  extractInstagramCommentsFromPage,
  findInstagramCommentSubmitPointOnPage,
  findInstagramDirectSubmitPointOnPage,
  findInstagramReplyPointOnPage,
  instagramPostStateKey,
  normalizeInstagramPostUrl,
  parseInstagramKeywords
} = require('./instagram-utils');
const { typeInstagramMessage } = require('./instagram-browser');

const legacyProjectRoot = path.join(__dirname, '..');
const persistentDataRoot = path.join(app.getPath('userData'), 'app-data');
const configPath = path.join(persistentDataRoot, 'config.json');
const runtimeLogPath = path.join(persistentDataRoot, 'runtime-errors.log');
const messageTrackerLogPath = path.join(persistentDataRoot, 'message-tracker.log');
const geminiUsagePath = path.join(persistentDataRoot, 'gemini-usage.json');
const metricsPath = path.join(persistentDataRoot, 'metrics.json');
const firstMessageStatePath = path.join(persistentDataRoot, 'first-message-state.json');
const instagramStatePath = path.join(persistentDataRoot, 'instagram-monitor-state.json');
const instagramSessionPath = path.join(persistentDataRoot, 'instagram-session');
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

function createEmptyMetrics() {
  return {
    trackingStartedAt: new Date().toISOString(),
    outboundEvents: [],
    pauseEvents: [],
    aiEvents: []
  };
}

function loadMetrics() {
  if (!fs.existsSync(metricsPath)) return createEmptyMetrics();
  try {
    const stored = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
    return {
      trackingStartedAt: stored.trackingStartedAt || new Date().toISOString(),
      outboundEvents: Array.isArray(stored.outboundEvents) ? stored.outboundEvents : [],
      pauseEvents: Array.isArray(stored.pauseEvents) ? stored.pauseEvents : [],
      aiEvents: Array.isArray(stored.aiEvents) ? stored.aiEvents : []
    };
  } catch (error) {
    logRuntimeError('métricas:leitura', error);
    return createEmptyMetrics();
  }
}

function saveMetrics(metrics) {
  const cutoff = Date.now() - (31 * 24 * 60 * 60 * 1000);
  const keepRecent = event => Number(new Date(event?.timestamp)) >= cutoff;
  metrics.outboundEvents = metrics.outboundEvents.filter(keepRecent).slice(-50000);
  metrics.pauseEvents = metrics.pauseEvents.filter(keepRecent).slice(-20000);
  metrics.aiEvents = metrics.aiEvents.filter(keepRecent).slice(-20000);
  fs.mkdirSync(path.dirname(metricsPath), { recursive: true });
  fs.writeFileSync(metricsPath, JSON.stringify(metrics));
}

function updateMetrics(update) {
  try {
    const metrics = loadMetrics();
    update(metrics);
    saveMetrics(metrics);
  } catch (error) {
    logRuntimeError('métricas:gravação', error);
  }
}

function recordOutboundMetric(success, source) {
  updateMetrics(metrics => metrics.outboundEvents.push({
    timestamp: new Date().toISOString(),
    success: success === true,
    source: String(source || 'automatic')
  }));
}

function recordPauseMetric(durationMs) {
  const normalizedDuration = Math.max(0, Math.round(Number(durationMs) || 0));
  if (!normalizedDuration) return;
  updateMetrics(metrics => metrics.pauseEvents.push({
    timestamp: new Date().toISOString(),
    durationMs: normalizedDuration
  }));
}

function recordAiResponseMetric(success) {
  updateMetrics(metrics => metrics.aiEvents.push({
    timestamp: new Date().toISOString(),
    success: success === true
  }));
}

function sameLocalDay(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function calculateMetricsSnapshot() {
  const metrics = loadMetrics();
  const now = new Date();
  const todayOutbound = metrics.outboundEvents.filter(event => sameLocalDay(new Date(event.timestamp), now));
  const successfulToday = todayOutbound.filter(event => event.success === true);
  const failedToday = todayOutbound.length - successfulToday.length;
  const todayAi = metrics.aiEvents.filter(event => sameLocalDay(new Date(event.timestamp), now));
  const successfulAi = todayAi.filter(event => event.success === true).length;
  const todayPauses = metrics.pauseEvents.filter(event => sameLocalDay(new Date(event.timestamp), now));
  const successfulTimes = successfulToday
    .map(event => new Date(event.timestamp).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const intervals = successfulTimes.slice(1).map((timestamp, index) => timestamp - successfulTimes[index]);
  const lastSuccessful = metrics.outboundEvents
    .filter(event => event.success === true)
    .map(event => event.timestamp)
    .sort()
    .at(-1) || null;
  const hourly = Array.from({ length: 24 }, (_value, hour) => ({ hour, count: 0 }));
  for (const event of successfulToday) hourly[new Date(event.timestamp).getHours()].count++;
  const byMinute = [];
  for (let offset = 14; offset >= 0; offset--) {
    const minute = new Date(now.getTime() - (offset * 60000));
    const count = successfulToday.filter(event => {
      const timestamp = new Date(event.timestamp);
      return timestamp.getFullYear() === minute.getFullYear()
        && timestamp.getMonth() === minute.getMonth()
        && timestamp.getDate() === minute.getDate()
        && timestamp.getHours() === minute.getHours()
        && timestamp.getMinutes() === minute.getMinutes();
    }).length;
    byMinute.push({
      label: minute.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      count
    });
  }

  return {
    trackingStartedAt: metrics.trackingStartedAt,
    sentToday: successfulToday.length,
    averageIntervalMs: intervals.length ? Math.round(intervals.reduce((sum, value) => sum + value, 0) / intervals.length) : 0,
    totalPauseMs: todayPauses.reduce((sum, event) => sum + Math.max(0, Number(event.durationMs) || 0), 0),
    aiResponseRate: todayAi.length ? (successfulAi / todayAi.length) * 100 : 0,
    aiResponses: successfulAi,
    aiAttempts: todayAi.length,
    failureRate: todayOutbound.length ? (failedToday / todayOutbound.length) * 100 : 0,
    failedToday,
    attemptsToday: todayOutbound.length,
    lastSentAt: lastSuccessful,
    sentThisHour: successfulToday.filter(event => new Date(event.timestamp).getHours() === now.getHours()).length,
    sentThisMinute: successfulToday.filter(event => {
      const timestamp = new Date(event.timestamp);
      return timestamp.getHours() === now.getHours() && timestamp.getMinutes() === now.getMinutes();
    }).length,
    hourly,
    byMinute
  };
}

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

function calculateSimulatedTypingDelay(text) {
  const characterCount = String(text || '').trim().length;
  return Math.min(6000, Math.max(900, characterCount * 38));
}

async function getChatForSimulatedTyping(contactId) {
  try {
    return await client.getChatById(contactId);
  } catch (originalError) {
    if (!String(contactId || '').endsWith('@lid')) throw originalError;
    const [mapping] = await client.getContactLidAndPhone([contactId]);
    if (!mapping?.pn) throw originalError;
    return await client.getChatById(mapping.pn);
  }
}

async function sendWhatsAppText(to, text, source = 'automatic') {
  try {
    const simulatedTypingEnabled = loadConfig().simulatedTypingEnabled !== false;
    if (simulatedTypingEnabled) {
      await delay(250);
      try {
        const chat = await getChatForSimulatedTyping(to);
        await chat.sendStateTyping();
        await delay(calculateSimulatedTypingDelay(text));
      } catch (error) {
        // Some modern @lid contacts cannot be resolved by getChatById. Sending
        // directly still works, so typing status must never block the reply.
        console.warn(`Não foi possível exibir "digitando" para ${to}: ${error.message}`);
      }
    }
    await client.sendMessage(to, text);
    recordOutboundMetric(true, source);
  } catch (error) {
    recordOutboundMetric(false, source);
    throw error;
  }
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
  simulatedTypingEnabled: true,
  elevenLabsApiKey: '',
  elevenLabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
  bulkDelayMinSeconds: 10,
  bulkDelayMaxSeconds: 20,
  bulkContacts: [],
  emailSenderAddress: '',
  emailSenderName: '',
  emailAppPassword: '',
  emailDelayMinSeconds: 10,
  emailDelayMaxSeconds: 20,
  emailContacts: [],
  instagramPostUrl: '',
  instagramKeywords: '',
  instagramReplyComment: true,
  instagramSendDirect: false,
  instagramMessage: '',
  instagramMonitorIntervalSeconds: 20
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
  if (config.emailAppPasswordEncrypted) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        config.emailAppPassword = safeStorage.decryptString(Buffer.from(config.emailAppPasswordEncrypted, 'base64'));
      }
    } catch (error) {
      logRuntimeError('configuração:descriptografia-email', error);
      config.emailAppPassword = '';
    }
  }
  delete config.aiApiKeyEncrypted;
  delete config.elevenLabsApiKeyEncrypted;
  delete config.emailAppPasswordEncrypted;
  return config;
}

function prepareConfigForStorage(config) {
  const storedConfig = { ...config };
  const apiKey = String(storedConfig.aiApiKey || '').trim();
  const elevenLabsApiKey = String(storedConfig.elevenLabsApiKey || '').trim();
  const emailAppPassword = String(storedConfig.emailAppPassword || '').replace(/\s+/g, '');
  delete storedConfig.aiApiKeyEncrypted;
  delete storedConfig.elevenLabsApiKeyEncrypted;
  delete storedConfig.emailAppPasswordEncrypted;

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
  if (emailAppPassword && safeStorage.isEncryptionAvailable()) {
    storedConfig.emailAppPasswordEncrypted = safeStorage.encryptString(emailAppPassword).toString('base64');
    delete storedConfig.emailAppPassword;
  } else {
    storedConfig.emailAppPassword = emailAppPassword;
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
  if ((config.aiApiKey || config.elevenLabsApiKey || config.emailAppPassword) && safeStorage.isEncryptionAvailable()) saveConfig(config);
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
    await sendWhatsAppText(contactId, message, 'first-message');
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
let emailJob = null;
let instagramBrowser = null;
let instagramPage = null;
let instagramJob = null;
let instagramBrowserHeadless = false;
let instagramBrowserSwitching = false;

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
      await sendWhatsAppText(userId, iaReply, 'ai');
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
    await sendWhatsAppText(msg.from, rule.response, 'rule');
    rememberBotResponse(msg.from);
    return true;
  } else if (defaultMessagesEnabled && defaultNoReply) {
    // Se não houver regra, envia a mensagem padrão sem resposta.
    await sendWhatsAppText(msg.from, defaultNoReply, 'fallback');
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
      if (origin === 'https://aistudio.google.com'
        || origin === 'https://ai.google.dev'
        || origin === 'https://myaccount.google.com'
        || origin === 'https://support.google.com'
        || origin === 'https://wa.me') {
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

app.on('before-quit', () => {
  if (instagramJob) instagramJob.cancelled = true;
  if (instagramBrowser) void instagramBrowser.close().catch(() => {});
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
      simulatedTypingEnabled: newConfig.simulatedTypingEnabled !== false,
      elevenLabsApiKey: String(newConfig.elevenLabsApiKey || '').trim(),
      elevenLabsVoiceId: String(newConfig.elevenLabsVoiceId || DEFAULT_CONFIG.elevenLabsVoiceId),
      bulkDelayMinSeconds: Math.max(3, Math.min(600, Number(newConfig.bulkDelayMinSeconds) || DEFAULT_CONFIG.bulkDelayMinSeconds)),
      bulkDelayMaxSeconds: Math.max(3, Math.min(600, Number(newConfig.bulkDelayMaxSeconds) || DEFAULT_CONFIG.bulkDelayMaxSeconds)),
      bulkContacts: Array.isArray(newConfig.bulkContacts) ? newConfig.bulkContacts : [],
      emailSenderAddress: String(newConfig.emailSenderAddress || '').trim().toLowerCase(),
      emailSenderName: String(newConfig.emailSenderName || '').trim().slice(0, 120),
      emailAppPassword: String(newConfig.emailAppPassword || '').replace(/\s+/g, ''),
      emailDelayMinSeconds: Math.max(3, Math.min(600, Number(newConfig.emailDelayMinSeconds) || DEFAULT_CONFIG.emailDelayMinSeconds)),
      emailDelayMaxSeconds: Math.max(3, Math.min(600, Number(newConfig.emailDelayMaxSeconds) || DEFAULT_CONFIG.emailDelayMaxSeconds)),
      emailContacts: Array.isArray(newConfig.emailContacts)
        ? newConfig.emailContacts.slice(0, 5000).map(contact => {
          const email = normalizeEmailAddress(contact?.email) || String(contact?.email || '').trim().toLowerCase();
          return {
            id: String(contact?.id || ''),
            name: String(contact?.name || '').trim().slice(0, 120) || email,
            email
          };
        })
        : [],
      instagramPostUrl: String(newConfig.instagramPostUrl || '').trim().slice(0, 500),
      instagramKeywords: String(newConfig.instagramKeywords || '').trim().slice(0, 5000),
      instagramReplyComment: newConfig.instagramReplyComment !== false,
      instagramSendDirect: newConfig.instagramSendDirect === true,
      instagramMessage: String(newConfig.instagramMessage || '').slice(0, 5000),
      instagramMonitorIntervalSeconds: Math.max(15, Math.min(300, Number(newConfig.instagramMonitorIntervalSeconds) || DEFAULT_CONFIG.instagramMonitorIntervalSeconds))
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

ipcMain.handle('metrics:get', async () => ({
  ok: true,
  ...calculateMetricsSnapshot()
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
  if (bulkJob || emailJob) {
    return { ok: false, error: 'Cancele os disparos em andamento antes de sair.' };
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
    link: String(contact?.link || '').trim(),
    data: now.toLocaleDateString('pt-BR'),
    hora: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  };
  return String(template || '').replace(
    /\{(Nome|PrimeiroNome|Telefone|Link|Data|Hora)\}/gi,
    (_match, tag) => values[tag.toLowerCase()]
  );
}

function loadInstagramState() {
  if (!fs.existsSync(instagramStatePath)) return { version: 1, posts: {} };
  try {
    const stored = JSON.parse(fs.readFileSync(instagramStatePath, 'utf8'));
    return { version: 1, posts: stored?.posts && typeof stored.posts === 'object' ? stored.posts : {} };
  } catch (error) {
    logRuntimeError('instagram:estado:leitura', error);
    return { version: 1, posts: {} };
  }
}

function trimInstagramRecord(record, limit) {
  return Object.fromEntries(Object.entries(record || {})
    .sort(([, left], [, right]) => String(right?.timestamp || right || '').localeCompare(String(left?.timestamp || left || '')))
    .slice(0, limit));
}

function saveInstagramState(state) {
  for (const post of Object.values(state.posts || {})) {
    post.processed = trimInstagramRecord(post.processed, 10000);
    post.matches = trimInstagramRecord(post.matches, 2000);
    post.commentedUsers = trimInstagramRecord(post.commentedUsers, 5000);
    post.directUsers = trimInstagramRecord(post.directUsers, 5000);
  }
  const recentPosts = Object.entries(state.posts || {})
    .sort(([, left], [, right]) => String(right?.lastScanAt || '').localeCompare(String(left?.lastScanAt || '')))
    .slice(0, 50);
  state.posts = Object.fromEntries(recentPosts);
  fs.mkdirSync(path.dirname(instagramStatePath), { recursive: true });
  fs.writeFileSync(instagramStatePath, JSON.stringify(state, null, 2));
}

function sendInstagramStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('instagram:status', payload);
}

function sendInstagramLog(type, message, details = {}) {
  const payload = { type, message, timestamp: new Date().toISOString(), ...details };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('instagram:log', payload);
  logMessageTracker(`instagram:${type}`, message);
}

async function ensureInstagramBrowser(options = {}) {
  const headless = options.headless === true;
  if (instagramBrowser?.connected && instagramPage && !instagramPage.isClosed() && instagramBrowserHeadless === headless) {
    return instagramPage;
  }
  if (instagramBrowser?.connected) {
    const previousBrowser = instagramBrowser;
    instagramBrowserSwitching = true;
    instagramBrowser = null;
    instagramPage = null;
    try {
      await previousBrowser.close();
    } finally {
      instagramBrowserSwitching = false;
    }
  }
  fs.mkdirSync(instagramSessionPath, { recursive: true });
  const puppeteer = require('puppeteer');
  const launchedBrowser = await puppeteer.launch({
    headless,
    executablePath: whatsappBrowserExecutable,
    userDataDir: instagramSessionPath,
    defaultViewport: headless ? { width: 1440, height: 1000 } : null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--disable-translate',
      '--window-size=1440,1000',
      '--start-maximized'
    ],
    timeout: 60000,
    protocolTimeout: 60000
  });
  instagramBrowser = launchedBrowser;
  instagramBrowserHeadless = headless;
  const pages = await launchedBrowser.pages();
  instagramPage = pages[0] || await launchedBrowser.newPage();
  instagramPage.setDefaultNavigationTimeout(60000);
  instagramPage.setDefaultTimeout(20000);
  launchedBrowser.once('disconnected', () => {
    if (instagramBrowserSwitching || instagramBrowser !== launchedBrowser) return;
    instagramBrowser = null;
    instagramPage = null;
    instagramBrowserHeadless = false;
    if (instagramJob) instagramJob.cancelled = true;
    sendInstagramStatus({ active: false, loggedIn: false, message: 'Navegador do Instagram fechado.' });
  });
  return instagramPage;
}

async function instagramSessionIsAuthenticated(page = instagramPage) {
  if (!page || page.isClosed()) return false;
  try {
    const cookies = await page.cookies('https://www.instagram.com');
    return cookies.some(cookie => cookie.name === 'sessionid' && cookie.value);
  } catch (_error) {
    return false;
  }
}

async function navigateInstagram(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await delay(2500);
  if (!(await instagramSessionIsAuthenticated(page)) || /\/accounts\/login/i.test(page.url())) {
    throw new Error('A sessão do Instagram não está autenticada. Clique em “Abrir Instagram para login”.');
  }
}

async function revealInstagramComments(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const clicked = await page.evaluate(() => {
      const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const patterns = ['ver todos os comentarios', 'carregar mais comentarios', 'view all comments', 'load more comments', 'mais comentarios', 'more comments'];
      const button = [...document.querySelectorAll('button, div[role="button"]')]
        .find(element => patterns.some(pattern => normalize(element.textContent).includes(pattern)));
      if (!button) return false;
      button.click();
      return true;
    });
    if (!clicked) break;
    await delay(900);
  }
}

async function extractInstagramComments(page) {
  return page.evaluate(extractInstagramCommentsFromPage);
}

async function clickInstagramPoint(page, point, description) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`${description} não foi encontrado na tela.`);
  }
  await page.mouse.click(point.x, point.y);
}

async function visibleInstagramEditor(page, mode) {
  const selectors = mode === 'comment'
    ? ['textarea[aria-label]', 'textarea[placeholder]', 'form textarea']
    : ['div[contenteditable="true"][role="textbox"]', 'textarea[placeholder]'];
  const timeoutAt = Date.now() + 30000;
  while (Date.now() < timeoutAt) {
    for (const selector of selectors) {
      for (const element of await page.$$(selector)) {
        const box = await element.boundingBox();
        if (box && box.width > 0 && box.height > 0) return element;
        await element.dispose().catch(() => {});
      }
    }
    await delay(250);
  }
  throw new Error('O campo de mensagem do Instagram não apareceu após 30 segundos.');
}

async function instagramEditorStillContains(page, mode, message) {
  const selectors = mode === 'comment'
    ? ['textarea[aria-label]', 'textarea[placeholder]', 'form textarea']
    : ['div[contenteditable="true"][role="textbox"]', 'textarea[placeholder]'];
  return page.evaluate((candidateSelectors, expected) => {
    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
    const text = normalize(expected);
    return candidateSelectors.some(selector => [...document.querySelectorAll(selector)].some(element => {
      const rect = element.getBoundingClientRect();
      const content = normalize('value' in element ? element.value : element.textContent);
      return rect.width > 0 && rect.height > 0 && content.includes(text);
    }));
  }, selectors, message);
}

async function replyToInstagramComment(page, match, message) {
  let stage = 'localizar o botão Responder';
  try {
    const replyPoint = await page.evaluate(findInstagramReplyPointOnPage, match);
    stage = 'clicar no botão Responder';
    await clickInstagramPoint(page, replyPoint, `O botão Responder do comentário de @${match.username}`);
    stage = 'abrir o editor da resposta pública';
    const editor = await visibleInstagramEditor(page, 'comment');
    stage = 'digitar a resposta pública';
    await typeInstagramMessage(page, editor, message, { separateFromExisting: true });
    stage = 'publicar a resposta';
    const submitPoint = await page.evaluate(findInstagramCommentSubmitPointOnPage);
    if (submitPoint) await clickInstagramPoint(page, submitPoint, 'O botão Postar');
    else await page.keyboard.press('Enter');
    await delay(1800);
    stage = 'confirmar a publicação';
    if (await instagramEditorStillContains(page, 'comment', message)) {
      throw new Error('o Instagram manteve o texto no editor');
    }
  } catch (error) {
    throw new Error(`Não foi possível ${stage}: ${error.message}`);
  }
}

async function sendInstagramDirect(page, username, message, postUrl) {
  if (!/^[A-Za-z0-9._]+$/.test(username)) throw new Error('Nome de usuário inválido para envio por Direct.');
  let actionError = null;
  let stage = `abrir o perfil @${username}`;
  try {
    await navigateInstagram(page, `https://www.instagram.com/${username}/`);
    stage = 'localizar o botão de mensagem';
    const messageButtonPoint = await page.evaluate(() => {
      const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const button = [...document.querySelectorAll('button, div[role="button"], a[role="link"]')]
        .find(element => ['mensagem', 'message', 'enviar mensagem'].includes(normalize(element.textContent)));
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0
        ? { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2) }
        : null;
    });
    stage = 'clicar no botão de mensagem';
    await clickInstagramPoint(page, messageButtonPoint, `O botão de mensagem do perfil @${username}`);
    stage = 'abrir o editor do Direct';
    const editor = await visibleInstagramEditor(page, 'direct');
    stage = 'digitar a mensagem do Direct';
    await typeInstagramMessage(page, editor, message);
    stage = 'enviar o Direct';
    const submitPoint = await page.evaluate(findInstagramDirectSubmitPointOnPage);
    if (submitPoint) await clickInstagramPoint(page, submitPoint, 'O botão Enviar do Direct');
    else await page.keyboard.press('Enter');
    await delay(1800);
    stage = 'confirmar o envio do Direct';
    if (await instagramEditorStillContains(page, 'direct', message)) {
      throw new Error('o Instagram manteve o texto no editor');
    }
  } catch (error) {
    actionError = new Error(`Não foi possível ${stage}: ${error.message}`);
  }
  try {
    await navigateInstagram(page, postUrl);
    await revealInstagramComments(page);
  } catch (recoveryError) {
    if (!actionError) throw recoveryError;
    sendInstagramLog('warning', `O Direct falhou e a publicação também não pôde ser recarregada: ${recoveryError.message}`);
  }
  if (actionError) throw actionError;
}

async function scanInstagramPost(job) {
  const page = job.page;
  if (!page.url().startsWith(job.postUrl)) await navigateInstagram(page, job.postUrl);
  await revealInstagramComments(page);
  const comments = await extractInstagramComments(page);
  job.cycles++;
  if (job.cycles === 1 || job.cycles % 10 === 0) {
    sendInstagramLog(comments.length ? 'info' : 'warning', comments.length
      ? `${comments.length} comentário${comments.length === 1 ? ' visível' : 's visíveis'} na publicação.`
      : 'Nenhum comentário visível foi encontrado nesta verificação.');
  }
  const state = loadInstagramState();
  const key = instagramPostStateKey(job.postUrl);
  const post = state.posts[key] || {
    url: job.postUrl,
    lastScanAt: '',
    processed: {},
    matches: {},
    commentedUsers: {},
    directUsers: {}
  };
  const previousScanAt = post.lastScanAt ? Date.parse(post.lastScanAt) : 0;
  const scanStartedAt = new Date().toISOString();
  const processExisting = job.processExistingOnce === true;
  if (processExisting) job.processExistingOnce = false;
  const collected = collectNewInstagramMatches(post, comments, job.keywords, scanStartedAt, {
    processExisting,
    notBefore: job.startedAt
  });
  const { newComments, newMatches } = collected;
  if (!previousScanAt && comments.length) {
    sendInstagramLog('info', `${comments.length} comentário${comments.length === 1 ? '' : 's'} existente${comments.length === 1 ? '' : 's'} registrado${comments.length === 1 ? '' : 's'} sem envio. Para testar, publique um novo comentário depois que o monitor estiver ativo.`);
  }
  for (const match of collected.matchesFound) {
    sendInstagramLog('match', `@${match.username} comentou “${match.text}” e ativou a palavra “${match.keyword}”.`, { username: match.username });
  }
  if (!processExisting && collected.withoutKeyword > 0) {
    sendInstagramLog('info', `${collected.withoutKeyword} comentário${collected.withoutKeyword === 1 ? ' novo não contém' : 's novos não contêm'} nenhuma das palavras-chave configuradas.`);
  }
  if (!processExisting && collected.ignoredBeforeMonitor > 0) {
    sendInstagramLog('info', `${collected.ignoredBeforeMonitor} comentário${collected.ignoredBeforeMonitor === 1 ? ' revelado depois foi ignorado porque é anterior' : 's revelados depois foram ignorados porque são anteriores'} ao início deste monitoramento.`);
  }
  if (processExisting) {
    sendInstagramLog(newMatches ? 'success' : 'warning', newMatches
      ? `${newMatches} comentário${newMatches === 1 ? ' visível recuperado e colocado' : 's visíveis recuperados e colocados'} na fila de envio.`
      : `Reprocessamento concluído: ${comments.length} comentário${comments.length === 1 ? ' visível' : 's visíveis'}; ${collected.withoutKeyword} sem palavra-chave e ${collected.alreadyMatched} já registrado${collected.alreadyMatched === 1 ? '' : 's'}.`);
  }

  state.posts[key] = post;
  saveInstagramState(state);
  job.scanned = Object.keys(post.processed).length;
  job.matches += newMatches;

  const pending = Object.entries(post.matches)
    .filter(([usernameKey]) => (job.replyComment && !post.commentedUsers[usernameKey]) || (job.sendDirect && !post.directUsers[usernameKey]))
    .sort(([, left], [, right]) => String(left.timestamp).localeCompare(String(right.timestamp)))
    .slice(0, 100);
  for (const [usernameKey, match] of pending) {
    if (job.cancelled) break;
    const personalized = applyMessageTags(job.message, { name: match.name || match.username, link: job.postUrl });
    if (job.replyComment && !post.commentedUsers[usernameKey]) {
      try {
        sendInstagramLog('info', `Preparando resposta pública para @${match.username}...`, { username: match.username });
        await replyToInstagramComment(page, match, personalized);
        post.commentedUsers[usernameKey] = { timestamp: new Date().toISOString() };
        job.commentsSent++;
        recordOutboundMetric(true, 'instagram-comment');
        sendInstagramLog('success', `Resposta publicada no comentário de @${match.username}.`, { username: match.username });
      } catch (error) {
        recordOutboundMetric(false, 'instagram-comment');
        sendInstagramLog('error', `Falha ao responder @${match.username}: ${error.message}`, { username: match.username });
        try {
          sendInstagramLog('info', 'Recarregando a publicação antes de tentar o Direct...');
          await navigateInstagram(page, job.postUrl);
          await revealInstagramComments(page);
        } catch (recoveryError) {
          sendInstagramLog('warning', `Não foi possível recarregar a publicação: ${recoveryError.message}`);
        }
      }
      saveInstagramState(state);
    }
    if (job.sendDirect && !post.directUsers[usernameKey] && !job.cancelled) {
      try {
        sendInstagramLog('info', `Abrindo o Direct de @${match.username}...`, { username: match.username });
        await sendInstagramDirect(page, match.username, personalized, job.postUrl);
        post.directUsers[usernameKey] = { timestamp: new Date().toISOString() };
        job.directsSent++;
        recordOutboundMetric(true, 'instagram-direct');
        sendInstagramLog('success', `Mensagem enviada por Direct para @${match.username}.`, { username: match.username });
      } catch (error) {
        recordOutboundMetric(false, 'instagram-direct');
        sendInstagramLog('error', `Falha no Direct para @${match.username}: ${error.message}`, { username: match.username });
      }
      saveInstagramState(state);
    }
  }
  sendInstagramStatus({
    active: true,
    loggedIn: true,
    postUrl: job.postUrl,
    scanned: job.scanned,
    matches: job.matches,
    commentsSent: job.commentsSent,
    directsSent: job.directsSent,
    newComments,
    message: processExisting
      ? `${comments.length} comentário${comments.length === 1 ? ' visível' : 's visíveis'} • ${newMatches} correspondência${newMatches === 1 ? ' nova' : 's novas'} • envios pendentes processados.`
      : (previousScanAt
        ? `${comments.length} comentário${comments.length === 1 ? ' visível' : 's visíveis'} • ${newComments} novo${newComments === 1 ? '' : 's'} • ${newMatches} palavra${newMatches === 1 ? ' acionada' : 's acionadas'}.`
        : 'Leitura inicial concluída; comentários existentes foram apenas registrados.')
  });
}

async function waitForInstagramInterval(job) {
  const end = Date.now() + (job.intervalSeconds * 1000);
  while (!job.cancelled && !job.processExistingOnce && Date.now() < end) await delay(Math.min(500, end - Date.now()));
}

async function runInstagramMonitor(job) {
  try {
    await navigateInstagram(job.page, job.postUrl);
    sendInstagramLog('info', 'Monitoramento iniciado. A primeira leitura registra os comentários existentes sem respondê-los.');
    while (!job.cancelled) {
      try {
        await scanInstagramPost(job);
      } catch (error) {
        logRuntimeError('instagram:monitoramento', error);
        sendInstagramLog('error', `Falha na verificação: ${error.message}`);
        if (!(await instagramSessionIsAuthenticated(job.page))) {
          sendInstagramStatus({ active: false, loggedIn: false, message: 'A sessão do Instagram expirou. Faça login novamente.' });
          break;
        }
      }
      await waitForInstagramInterval(job);
    }
  } finally {
    if (instagramJob === job) instagramJob = null;
    sendInstagramStatus({ active: false, loggedIn: await instagramSessionIsAuthenticated(job.page), message: job.cancelled ? 'Monitoramento interrompido.' : 'Monitoramento encerrado.' });
  }
}

function sendBulkProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bulk:progress', payload);
  }
}

async function waitForBulkDelay(milliseconds, job) {
  const startedAt = Date.now();
  const end = Date.now() + milliseconds;
  while (!job.cancelled && Date.now() < end) {
    await delay(Math.min(250, end - Date.now()));
  }
  recordPauseMetric(Date.now() - startedAt);
}

function calculateRandomBulkDelaySeconds(minSeconds, maxSeconds, randomValue = Math.random()) {
  return Math.floor(randomValue * (maxSeconds - minSeconds + 1)) + minSeconds;
}

async function resolveSavedWhatsAppContacts() {
  const allContacts = await client.getContacts();
  const savedContacts = allContacts.filter(contact => (
    contact?.isMyContact === true &&
    contact?.isUser === true &&
    contact?.isWAContact === true &&
    contact?.isGroup !== true &&
    contact?.isMe !== true &&
    contact?.isBlocked !== true
  ));

  const lidIds = [...new Set(savedContacts
    .map(contact => String(contact?.id?._serialized || ''))
    .filter(id => id.endsWith('@lid')))];
  const phoneByLid = new Map();

  for (let offset = 0; offset < lidIds.length; offset += 100) {
    const chunk = lidIds.slice(offset, offset + 100);
    try {
      const mappings = await client.getContactLidAndPhone(chunk);
      for (const mapping of mappings || []) {
        const lid = String(mapping?.lid || '');
        const phone = String(mapping?.pn || '');
        if (lid && phone) phoneByLid.set(lid, phone);
      }
    } catch (error) {
      logRuntimeError('importação-contatos-whatsapp:resolver-lid', error);
    }
  }

  const contactsByPhone = new Map();
  let unresolved = 0;

  for (const contact of savedContacts) {
    const serializedId = String(contact?.id?._serialized || '');
    const phoneSource = serializedId.endsWith('@lid')
      ? phoneByLid.get(serializedId)
      : (contact?.number || contact?.id?.user || serializedId);
    const phone = normalizePhone(phoneSource);
    if (!phone) {
      unresolved++;
      continue;
    }

    const name = [contact.name, contact.shortName, contact.verifiedName, contact.pushname]
      .map(value => String(value || '').trim())
      .find(Boolean) || phone;
    const existing = contactsByPhone.get(phone);
    if (!existing || (existing.name === existing.phone && name !== phone)) {
      contactsByPhone.set(phone, { name, phone, source: 'whatsapp' });
    }
  }

  const resolvedContacts = [...contactsByPhone.values()]
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' }));
  const limitedContacts = resolvedContacts.slice(0, 5000);

  return {
    contacts: limitedContacts,
    savedCount: savedContacts.length,
    unresolved,
    duplicates: Math.max(0, savedContacts.length - unresolved - resolvedContacts.length),
    truncated: Math.max(0, resolvedContacts.length - limitedContacts.length)
  };
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

ipcMain.handle('bulk:import-whatsapp-contacts', async () => {
  if (!connectionState.connected) {
    return { ok: false, error: 'Conecte o WhatsApp antes de importar os contatos.' };
  }

  try {
    const result = await resolveSavedWhatsAppContacts();
    console.log(`👥 Contatos do WhatsApp: ${result.contacts.length} resolvidos de ${result.savedCount} salvos.`);
    return { ok: true, ...result };
  } catch (error) {
    logRuntimeError('importação-contatos-whatsapp', error);
    return {
      ok: false,
      error: 'Não foi possível ler os contatos salvos do WhatsApp. Aguarde a sincronização e tente novamente.'
    };
  }
});

ipcMain.handle('bulk:start', async (_event, payload) => {
  if (bulkJob) return { ok: false, error: 'Já existe um envio em andamento.' };
  if (!connectionState.connected) return { ok: false, error: 'Conecte o WhatsApp antes de iniciar o envio.' };

  const contacts = Array.isArray(payload?.contacts) ? payload.contacts.slice(0, 5000) : [];
  const message = String(payload?.message || '').trim();
  const imagePath = payload?.imagePath ? path.resolve(String(payload.imagePath)) : null;
  const legacyDelay = Number(payload?.delaySeconds);
  const delayMinSeconds = Math.max(3, Math.min(600, Number(payload?.delayMinSeconds) || legacyDelay || DEFAULT_CONFIG.bulkDelayMinSeconds));
  const delayMaxSeconds = Math.max(3, Math.min(600, Number(payload?.delayMaxSeconds) || legacyDelay || DEFAULT_CONFIG.bulkDelayMaxSeconds));
  if (!contacts.length) return { ok: false, error: 'Selecione pelo menos um contato.' };
  if (!message && !imagePath) return { ok: false, error: 'Informe uma mensagem ou selecione uma imagem.' };
  if (imagePath && !fs.existsSync(imagePath)) return { ok: false, error: 'A imagem selecionada não existe mais.' };
  if (delayMinSeconds > delayMaxSeconds) return { ok: false, error: 'O intervalo inicial não pode ser maior que o intervalo final.' };

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
        recordOutboundMetric(true, 'bulk');
      } catch (err) {
        failed++;
        error = err.message || String(err);
        recordOutboundMetric(false, 'bulk');
      }

      const hasNextContact = index < contacts.length - 1 && !job.cancelled;
      const nextDelaySeconds = hasNextContact
        ? calculateRandomBulkDelaySeconds(delayMinSeconds, delayMaxSeconds)
        : null;
      sendBulkProgress({
        current: index + 1,
        total: contacts.length,
        sent,
        failed,
        contact: { name: String(contact.name || ''), phone: String(contact.phone || '') },
        error,
        nextDelaySeconds
      });
      if (nextDelaySeconds !== null) await waitForBulkDelay(nextDelaySeconds * 1000, job);
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

const MAX_EMAIL_RECIPIENTS = 500;
const MAX_EMAIL_ATTACHMENTS = 10;
const MAX_EMAIL_PAYLOAD_BYTES = 18 * 1024 * 1024;

function normalizeEmailAddress(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function createGmailTransport(email, appPassword, pooled = false) {
  return nodemailer.createTransport({
    service: 'gmail',
    pool: pooled,
    maxConnections: 1,
    maxMessages: 100,
    auth: {
      user: email,
      pass: String(appPassword || '').replace(/\s+/g, '')
    },
    connectionTimeout: 45000,
    greetingTimeout: 30000,
    socketTimeout: 90000
  });
}

function getFriendlyEmailError(error) {
  const code = String(error?.code || '');
  const response = String(error?.response || error?.message || 'Falha desconhecida.');
  if (code === 'EAUTH' || /535|username and password not accepted|invalid login/i.test(response)) {
    return 'O Gmail recusou a autenticação. Confira o e-mail, ative a verificação em duas etapas e gere uma Senha de app de 16 caracteres.';
  }
  if (/daily user sending limit|rate limit|quota|4\.7\.28|5\.4\.5/i.test(response)) {
    return 'O limite de envio do Gmail foi atingido. Interrompa a campanha e aguarde a liberação da conta.';
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || /timeout/i.test(response)) {
    return 'A conexão com o Gmail demorou demais. Verifique a internet, firewall ou antivírus e tente novamente.';
  }
  return response.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function escapeEmailHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function applyEmailTags(template, contact, html = false) {
  const fullName = String(contact?.name || '').trim() || normalizeEmailAddress(contact?.email) || 'Cliente';
  const firstName = fullName.split(/\s+/)[0];
  const now = new Date();
  const values = {
    nome: fullName,
    primeironome: firstName,
    email: normalizeEmailAddress(contact?.email) || '',
    data: now.toLocaleDateString('pt-BR'),
    hora: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  };
  return String(template || '').replace(
    /\{(Nome|PrimeiroNome|Email|Data|Hora)\}/gi,
    (_match, tag) => html ? escapeEmailHtml(values[tag.toLowerCase()]) : values[tag.toLowerCase()]
  );
}

function sanitizeEmailHtml(value) {
  return String(value || '')
    .replace(/<(script|iframe|object|embed|form|meta|link|base|svg|math)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|iframe|object|embed|form|meta|link|base|svg|math)\b[^>]*\/?\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '$1="#"')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/url\s*\(\s*['"]?\s*javascript:[^)]*\)/gi, '');
}

function emailHtmlToText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sendEmailProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('email:progress', payload);
}

ipcMain.handle('email:test-connection', async (_event, payload) => {
  const email = normalizeEmailAddress(payload?.email);
  const appPassword = String(payload?.appPassword || '').replace(/\s+/g, '');
  if (!email) return { ok: false, error: 'Informe um endereço de e-mail válido.' };
  if (appPassword.length < 16) return { ok: false, error: 'Informe a Senha de app de 16 caracteres gerada pelo Google.' };
  const transporter = createGmailTransport(email, appPassword);
  try {
    await transporter.verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: getFriendlyEmailError(error) };
  } finally {
    transporter.close();
  }
});

ipcMain.handle('email:select-attachments', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar documentos para anexar',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Documentos', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'zip', 'png', 'jpg', 'jpeg', 'webp'] },
      { name: 'Todos os arquivos', extensions: ['*'] }
    ]
  });
  if (result.canceled) return { ok: true, files: [] };
  try {
    const files = result.filePaths.slice(0, MAX_EMAIL_ATTACHMENTS).map(filePath => {
      const stats = fs.statSync(filePath);
      return { path: filePath, name: path.basename(filePath), size: stats.size };
    });
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_EMAIL_PAYLOAD_BYTES) {
      return { ok: false, error: 'Os anexos ultrapassam 18 MB. Remova alguns arquivos e tente novamente.' };
    }
    return { ok: true, files };
  } catch (error) {
    return { ok: false, error: `Não foi possível ler os anexos: ${error.message}` };
  }
});

ipcMain.handle('email:import-contacts', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar destinatários de e-mail',
    properties: ['openFile'],
    filters: [{ name: 'Planilhas', extensions: ['xlsx', 'csv'] }]
  });
  if (result.canceled) return { ok: true, contacts: [] };
  try {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const filePath = result.filePaths[0];
    if (path.extname(filePath).toLowerCase() === '.csv') await workbook.csv.readFile(filePath);
    else await workbook.xlsx.readFile(filePath);
    const sheet = workbook.worksheets[0];
    if (!sheet) return { ok: false, error: 'A planilha não possui páginas.' };
    const normalizeHeader = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    const headers = sheet.getRow(1).values.map(normalizeHeader);
    const nameColumn = headers.findIndex(value => ['nome', 'name', 'contato', 'responsavel'].includes(value));
    const emailColumn = headers.findIndex(value => ['email', 'e-mail', 'correio'].includes(value));
    if (emailColumn < 1) return { ok: false, error: 'Crie uma coluna chamada Email ou E-mail.' };
    const contacts = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const email = normalizeEmailAddress(row.getCell(emailColumn).text);
      if (!email) return;
      const name = nameColumn > 0 ? row.getCell(nameColumn).text.trim() : '';
      contacts.push({ name: name || email, email });
    });
    return { ok: true, contacts };
  } catch (error) {
    return { ok: false, error: `Não foi possível importar a planilha: ${error.message}` };
  }
});

ipcMain.handle('email:start', async (_event, payload) => {
  if (emailJob) return { ok: false, error: 'Já existe um disparo de e-mail em andamento.' };
  const config = loadConfig();
  const senderEmail = normalizeEmailAddress(config.emailSenderAddress);
  const appPassword = String(config.emailAppPassword || '').replace(/\s+/g, '');
  const contacts = Array.isArray(payload?.contacts) ? payload.contacts.slice(0, MAX_EMAIL_RECIPIENTS) : [];
  const subjectTemplate = String(payload?.subject || '').trim().slice(0, 998);
  const rawHtml = String(payload?.html || '');
  const sanitizedHtml = sanitizeEmailHtml(rawHtml);
  const attachmentPaths = Array.isArray(payload?.attachments) ? payload.attachments.slice(0, MAX_EMAIL_ATTACHMENTS) : [];
  const delayMinSeconds = Math.max(3, Math.min(600, Number(payload?.delayMinSeconds) || config.emailDelayMinSeconds));
  const delayMaxSeconds = Math.max(3, Math.min(600, Number(payload?.delayMaxSeconds) || config.emailDelayMaxSeconds));
  if (!senderEmail || appPassword.length < 16) return { ok: false, error: 'Teste e salve a conexão do Gmail antes de iniciar.' };
  if (!contacts.length) return { ok: false, error: 'Selecione pelo menos um destinatário.' };
  if (!subjectTemplate) return { ok: false, error: 'Informe o assunto do e-mail.' };
  if (!emailHtmlToText(sanitizedHtml) && !/<img\b/i.test(sanitizedHtml)) return { ok: false, error: 'Digite o conteúdo do e-mail.' };
  if (delayMinSeconds > delayMaxSeconds) return { ok: false, error: 'O intervalo inicial não pode ser maior que o intervalo final.' };
  if (Buffer.byteLength(sanitizedHtml, 'utf8') > MAX_EMAIL_PAYLOAD_BYTES) return { ok: false, error: 'O conteúdo do e-mail ultrapassa 18 MB. Reduza as imagens coladas.' };

  const attachments = [];
  let attachmentBytes = 0;
  for (const attachmentPath of attachmentPaths) {
    const resolvedPath = path.resolve(String(attachmentPath));
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
      return { ok: false, error: `O anexo ${path.basename(resolvedPath)} não está mais disponível.` };
    }
    const size = fs.statSync(resolvedPath).size;
    attachmentBytes += size;
    attachments.push({ filename: path.basename(resolvedPath), path: resolvedPath });
  }
  if (attachmentBytes + Buffer.byteLength(sanitizedHtml, 'utf8') > MAX_EMAIL_PAYLOAD_BYTES) {
    return { ok: false, error: 'O conteúdo e os anexos ultrapassam 18 MB.' };
  }

  const transporter = createGmailTransport(senderEmail, appPassword, true);
  const job = { cancelled: false };
  emailJob = job;
  let sent = 0;
  let failed = 0;
  try {
    for (let index = 0; index < contacts.length && !job.cancelled; index++) {
      const contact = contacts[index] || {};
      const recipientEmail = normalizeEmailAddress(contact.email);
      let error = null;
      try {
        if (!recipientEmail) throw new Error('Endereço de e-mail inválido');
        const personalizedHtml = applyEmailTags(sanitizedHtml, contact, true);
        const personalizedSubject = applyEmailTags(subjectTemplate, contact, false).replace(/[\r\n]+/g, ' ').slice(0, 998);
        await transporter.sendMail({
          from: { name: String(config.emailSenderName || senderEmail).replace(/[\r\n]+/g, ' '), address: senderEmail },
          replyTo: senderEmail,
          to: { name: (String(contact.name || '').replace(/[\r\n]+/g, ' ').trim() || recipientEmail), address: recipientEmail },
          subject: personalizedSubject,
          text: emailHtmlToText(personalizedHtml),
          html: personalizedHtml,
          attachments,
          attachDataUrls: true
        });
        sent++;
        recordOutboundMetric(true, 'email');
      } catch (sendError) {
        failed++;
        error = getFriendlyEmailError(sendError);
        recordOutboundMetric(false, 'email');
      }
      const hasNextContact = index < contacts.length - 1 && !job.cancelled;
      const nextDelaySeconds = hasNextContact
        ? calculateRandomBulkDelaySeconds(delayMinSeconds, delayMaxSeconds)
        : null;
      sendEmailProgress({
        current: index + 1,
        total: contacts.length,
        sent,
        failed,
        contact: { name: String(contact.name || ''), email: String(contact.email || '') },
        error,
        nextDelaySeconds
      });
      if (nextDelaySeconds !== null) await waitForBulkDelay(nextDelaySeconds * 1000, job);
    }
    return { ok: true, cancelled: job.cancelled, sent, failed, total: contacts.length };
  } finally {
    transporter.close();
    emailJob = null;
  }
});

ipcMain.handle('email:cancel', async () => {
  if (!emailJob) return { ok: false, error: 'Nenhum disparo de e-mail está em andamento.' };
  emailJob.cancelled = true;
  return { ok: true };
});

ipcMain.handle('instagram:open-login', async () => {
  if (instagramJob) return { ok: false, error: 'Pare o Bot do Instagram antes de abrir a janela de login.' };
  try {
    const page = await ensureInstagramBrowser({ headless: false });
    const savedSession = await instagramSessionIsAuthenticated(page);
    await page.goto(savedSession ? 'https://www.instagram.com/' : 'https://www.instagram.com/accounts/login/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    const loggedIn = await instagramSessionIsAuthenticated(page) && !/\/accounts\/login/i.test(page.url());
    await page.bringToFront();
    sendInstagramStatus({ active: Boolean(instagramJob), loggedIn, message: loggedIn ? 'Sessão do Instagram encontrada.' : 'Faça login na janela do Instagram e depois clique em Verificar sessão.' });
    return { ok: true, loggedIn };
  } catch (error) {
    logRuntimeError('instagram:abrir-login', error);
    return { ok: false, error: `Não foi possível abrir o Instagram: ${error.message}` };
  }
});

ipcMain.handle('instagram:check-session', async () => {
  try {
    const page = await ensureInstagramBrowser({ headless: Boolean(instagramJob) });
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const loggedIn = await instagramSessionIsAuthenticated(page) && !/\/accounts\/login/i.test(page.url());
    if (loggedIn && !instagramJob) await page.bringToFront();
    sendInstagramStatus({ active: Boolean(instagramJob), loggedIn, message: loggedIn ? 'Instagram conectado e pronto.' : 'Login ainda não identificado.' });
    return { ok: true, loggedIn };
  } catch (error) {
    logRuntimeError('instagram:verificar-sessão', error);
    return { ok: false, loggedIn: false, error: error.message };
  }
});

ipcMain.handle('instagram:get-status', async () => ({
  ok: true,
  active: Boolean(instagramJob),
  browserOpen: Boolean(instagramBrowser && instagramPage && !instagramPage.isClosed()),
  runningHidden: Boolean(instagramBrowser?.connected && instagramBrowserHeadless),
  loggedIn: await instagramSessionIsAuthenticated(),
  postUrl: instagramJob?.postUrl || '',
  scanned: instagramJob?.scanned || 0,
  matches: instagramJob?.matches || 0,
  commentsSent: instagramJob?.commentsSent || 0,
  directsSent: instagramJob?.directsSent || 0
}));

ipcMain.handle('instagram:start', async (_event, payload) => {
  if (instagramJob) return { ok: false, error: 'O monitoramento do Instagram já está ativo.' };
  const postUrl = normalizeInstagramPostUrl(payload?.postUrl);
  if (!postUrl) return { ok: false, error: 'Informe um link válido de publicação ou Reel do Instagram.' };
  const keywordList = parseInstagramKeywords(payload?.keywords);
  if (!keywordList.length) return { ok: false, error: 'Cadastre pelo menos uma palavra-chave.' };
  const replyComment = payload?.replyComment === true;
  const sendDirect = payload?.sendDirect === true;
  if (!replyComment && !sendDirect) return { ok: false, error: 'Ative a resposta no comentário, o envio por Direct ou as duas opções.' };
  const message = String(payload?.message || '').trim().slice(0, 5000);
  if (!message) return { ok: false, error: 'Digite a mensagem que será enviada.' };
  const intervalSeconds = Math.max(15, Math.min(300, Number(payload?.intervalSeconds) || DEFAULT_CONFIG.instagramMonitorIntervalSeconds));
  const monitorStartedAt = new Date().toISOString();

  try {
    let page = await ensureInstagramBrowser({ headless: false });
    if (!(await instagramSessionIsAuthenticated(page))) {
      await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.bringToFront();
      return { ok: false, error: 'Faça login na janela do Instagram e clique em Verificar sessão antes de iniciar.' };
    }
    sendInstagramStatus({ active: false, loggedIn: true, message: 'Iniciando o navegador oculto do Instagram...' });
    page = await ensureInstagramBrowser({ headless: true });
    if (!(await instagramSessionIsAuthenticated(page))) {
      return { ok: false, error: 'A sessão do Instagram não pôde ser reutilizada no modo oculto. Abra o login e conecte novamente.' };
    }
    const config = loadConfig();
    config.instagramPostUrl = postUrl;
    config.instagramKeywords = keywordList.map(keyword => keyword).join('\n');
    config.instagramReplyComment = replyComment;
    config.instagramSendDirect = sendDirect;
    config.instagramMessage = message;
    config.instagramMonitorIntervalSeconds = intervalSeconds;
    saveConfig(config);

    const job = {
      cancelled: false,
      page,
      postUrl,
      keywords: keywordList,
      replyComment,
      sendDirect,
      message,
      intervalSeconds,
      scanned: 0,
      matches: 0,
      commentsSent: 0,
      directsSent: 0,
      cycles: 0,
      processExistingOnce: false,
      startedAt: monitorStartedAt
    };
    instagramJob = job;
    sendInstagramStatus({ active: true, loggedIn: true, runningHidden: true, postUrl, message: 'Bot ativo em segundo plano. Abrindo a publicação no navegador oculto...' });
    void runInstagramMonitor(job).catch(error => {
      logRuntimeError('instagram:execução', error);
      sendInstagramLog('error', `O monitoramento foi encerrado: ${error.message}`);
    });
    return { ok: true, postUrl };
  } catch (error) {
    instagramJob = null;
    logRuntimeError('instagram:iniciar', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('instagram:stop', async () => {
  if (!instagramJob) return { ok: false, error: 'O monitoramento do Instagram não está ativo.' };
  instagramJob.cancelled = true;
  sendInstagramStatus({ active: true, loggedIn: true, message: 'Interrompendo o monitoramento...' });
  return { ok: true };
});

ipcMain.handle('instagram:process-visible', async () => {
  if (!instagramJob || instagramJob.cancelled) {
    return { ok: false, error: 'Inicie o Bot do Instagram antes de reprocessar os comentários visíveis.' };
  }
  instagramJob.processExistingOnce = true;
  sendInstagramLog('info', 'Reprocessamento manual solicitado. A verificação dos comentários visíveis foi antecipada.');
  sendInstagramStatus({ active: true, loggedIn: true, message: 'Reprocessando agora os comentários visíveis...' });
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

  let whatsappSendAttempted = false;
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
    whatsappSendAttempted = true;
    await client.sendMessage(to, media);
    recordOutboundMetric(true, 'ai-voice');
  } catch (err) {
    console.error('TTS falhou:', err.message);
    if (whatsappSendAttempted) recordOutboundMetric(false, 'ai-voice');
  }
}
