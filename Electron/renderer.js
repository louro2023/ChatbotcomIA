async function testAiApiKey(key) {
  return window.electronAPI.testGeminiApiKey(key);
}

let editingIdx = null;

function updateAiEnabledDisplay(enabled) {
  const status = document.getElementById('aiMasterStatus');
  const history = document.getElementById('aiUseConversation');
  const voice = document.getElementById('aiVoiceEnabled');
  if (status) {
    status.className = enabled ? 'active' : 'inactive';
    status.textContent = enabled ? 'IA ativada' : 'IA desativada';
  }
  if (history) history.disabled = !enabled;
  if (voice) voice.disabled = !enabled;
}

function updateDefaultMessagesDisplay(enabled) {
  const status = document.getElementById('defaultMessagesStatus');
  if (status) {
    status.className = enabled ? 'active' : 'inactive';
    status.textContent = enabled ? 'Mensagens ativadas' : 'Mensagens desativadas';
  }
  document.querySelectorAll('#defaultMessageForm textarea, #defaultMessageForm button, #defaultNoReplyForm textarea, #defaultNoReplyForm button')
    .forEach(element => { element.disabled = !enabled; });
}

function formatUsageNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Math.max(0, Number(value) || 0));
}

function formatUsageDate(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

async function renderGeminiUsage() {
  const refreshButton = document.getElementById('refreshGeminiUsage');
  if (!window.electronAPI?.getGeminiUsage) return;
  try {
    if (refreshButton) refreshButton.disabled = true;
    const usage = await window.electronAPI.getGeminiUsage();
    if (!usage?.ok) throw new Error(usage?.error || 'Não foi possível ler o consumo.');
    document.getElementById('geminiUsageRequests').textContent = formatUsageNumber(usage.requests);
    document.getElementById('geminiUsagePrompt').textContent = formatUsageNumber(usage.promptTokens);
    document.getElementById('geminiUsageResponse').textContent = formatUsageNumber(usage.responseTokens);
    document.getElementById('geminiUsageThought').textContent = formatUsageNumber(usage.thoughtTokens);
    document.getElementById('geminiUsageTotal').textContent = formatUsageNumber(usage.totalTokens);
    document.getElementById('geminiUsagePeriod').textContent = `Modelo ${usage.model} · contador local desde ${formatUsageDate(usage.trackingStartedAt, 'a ativação do painel')}`;
    document.getElementById('geminiUsageUpdated').textContent = usage.lastRequestAt
      ? `Última resposta registrada em ${formatUsageDate(usage.lastRequestAt, 'data desconhecida')}.`
      : 'Nenhuma resposta da IA registrada ainda.';
  } catch (error) {
    const updated = document.getElementById('geminiUsageUpdated');
    if (updated) updated.textContent = `Não foi possível atualizar o consumo: ${error.message}`;
  } finally {
    if (refreshButton) refreshButton.disabled = false;
  }
}

function formatMetricDuration(milliseconds, emptyValue = '0s') {
  const totalSeconds = Math.max(0, Math.round(Number(milliseconds) / 1000));
  if (!totalSeconds) return emptyValue;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}min`;
  if (minutes) return `${minutes}min ${seconds}s`;
  return `${seconds}s`;
}

function renderMetricBars(elementId, data, labelFormatter) {
  const chart = document.getElementById(elementId);
  if (!chart) return;
  chart.replaceChildren();
  const highest = Math.max(1, ...data.map(item => Number(item.count) || 0));
  data.forEach((item, index) => {
    const column = document.createElement('div');
    column.className = 'metric-bar-column';
    const value = document.createElement('span');
    value.className = 'metric-bar-value';
    value.textContent = String(item.count || 0);
    const track = document.createElement('div');
    track.className = 'metric-bar-track';
    const bar = document.createElement('div');
    bar.className = 'metric-bar-fill';
    const percentage = ((Number(item.count) || 0) / highest) * 100;
    bar.style.height = item.count ? `${Math.max(8, percentage)}%` : '2px';
    track.appendChild(bar);
    const label = document.createElement('small');
    label.textContent = labelFormatter(item, index);
    column.title = `${label.textContent}: ${item.count || 0} envio${item.count === 1 ? '' : 's'}`;
    column.append(value, track, label);
    chart.appendChild(column);
  });
}

async function renderMetrics() {
  const refreshButton = document.getElementById('refreshMetrics');
  const errorArea = document.getElementById('metricsError');
  if (!window.electronAPI?.getMetrics) return;
  try {
    if (refreshButton) refreshButton.disabled = true;
    const metrics = await window.electronAPI.getMetrics();
    if (!metrics?.ok) throw new Error(metrics?.error || 'Não foi possível carregar as métricas.');
    document.getElementById('metricSentToday').textContent = formatUsageNumber(metrics.sentToday);
    document.getElementById('metricAttemptsToday').textContent = `${formatUsageNumber(metrics.attemptsToday)} tentativa${metrics.attemptsToday === 1 ? '' : 's'}`;
    document.getElementById('metricAverageInterval').textContent = formatMetricDuration(metrics.averageIntervalMs, '—');
    document.getElementById('metricTotalPause').textContent = formatMetricDuration(metrics.totalPauseMs);
    document.getElementById('metricAiRate').textContent = `${Number(metrics.aiResponseRate || 0).toFixed(1).replace('.', ',')}%`;
    document.getElementById('metricAiDetail').textContent = `${formatUsageNumber(metrics.aiResponses)} de ${formatUsageNumber(metrics.aiAttempts)} tentativa${metrics.aiAttempts === 1 ? '' : 's'}`;
    document.getElementById('metricFailureRate').textContent = `${Number(metrics.failureRate || 0).toFixed(1).replace('.', ',')}%`;
    document.getElementById('metricFailureDetail').textContent = `${formatUsageNumber(metrics.failedToday)} falha${metrics.failedToday === 1 ? '' : 's'} hoje`;
    document.getElementById('metricLastSent').textContent = metrics.lastSentAt
      ? new Date(metrics.lastSentAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '—';
    document.getElementById('metricThisHour').textContent = formatUsageNumber(metrics.sentThisHour);
    document.getElementById('metricThisMinute').textContent = formatUsageNumber(metrics.sentThisMinute);
    renderMetricBars('metricHourlyChart', metrics.hourly || [], item => `${String(item.hour).padStart(2, '0')}h`);
    renderMetricBars('metricMinuteChart', metrics.byMinute || [], item => item.label);
    document.getElementById('metricsUpdatedAt').textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR')} • dados armazenados somente neste computador.`;
    if (errorArea) errorArea.style.display = 'none';
  } catch (error) {
    if (errorArea) {
      errorArea.textContent = `Não foi possível atualizar o painel: ${error.message}`;
      errorArea.style.display = '';
    }
  } finally {
    if (refreshButton) refreshButton.disabled = false;
  }
}

document.getElementById('refreshMetrics').addEventListener('click', renderMetrics);

window.addEventListener('DOMContentLoaded', async () => {
  const btnSair = document.getElementById('btnSair');
  if (btnSair) {
    btnSair.onclick = async () => {
      const confirmed = confirm('Sair desconectará esta conta do WhatsApp Web e exigirá um novo QR Code no próximo acesso. Deseja continuar?');
      if (!confirmed) return;

      btnSair.disabled = true;
      const originalText = btnSair.textContent;
      btnSair.textContent = 'Desconectando...';
      try {
        const result = await window.electronAPI.logoutAndQuit();
        if (!result?.ok) {
          alert(result?.error || 'Não foi possível desconectar do WhatsApp.');
          btnSair.disabled = false;
          btnSair.textContent = originalText;
        }
      } catch (err) {
        alert(`Erro ao sair: ${err.message}`);
        btnSair.disabled = false;
        btnSair.textContent = originalText;
      }
    };
  }

  const btnReconectar = document.getElementById('btnReconectar');
  if (btnReconectar) {
    btnReconectar.onclick = async () => {
      btnReconectar.disabled = true;
      btnReconectar.textContent = '🔄 Reconectando...';
      try {
        const result = await window.electronAPI.reconnectWhatsApp();
        if (result.ok) {
          btnReconectar.textContent = '🔄 Reconectar WhatsApp';
        } else {
          alert('Erro: ' + result.error);
          btnReconectar.textContent = '🔄 Reconectar WhatsApp';
        }
      } catch (err) {
        alert('Erro ao reconectar: ' + err.message);
        btnReconectar.textContent = '🔄 Reconectar WhatsApp';
      }
      btnReconectar.disabled = false;
    };
  }

  const btnResetWhatsApp = document.getElementById('btnResetWhatsApp');
  if (btnResetWhatsApp) {
    btnResetWhatsApp.onclick = async () => {
      const confirmed = confirm('Resetar a conexão desconectará o WhatsApp atual e exibirá um novo QR Code. Deseja continuar?');
      if (!confirmed) return;

      btnResetWhatsApp.disabled = true;
      if (btnReconectar) btnReconectar.disabled = true;
      const originalText = btnResetWhatsApp.innerHTML;
      btnResetWhatsApp.textContent = 'Resetando...';
      try {
        const result = await window.electronAPI.resetWhatsApp();
        if (!result?.ok) alert(result?.error || 'Não foi possível resetar a conexão.');
      } catch (err) {
        alert(`Erro ao resetar a conexão: ${err.message}`);
      } finally {
        btnResetWhatsApp.innerHTML = originalText;
        btnResetWhatsApp.disabled = false;
        if (btnReconectar) btnReconectar.disabled = false;
      }
    };
  }

  // Navigation handler
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      // Remove active class from all items
      navItems.forEach(ni => ni.classList.remove('active'));
      // Add active class to clicked item
      item.classList.add('active');

      // Hide all sections
      const sections = document.querySelectorAll('.section');
      sections.forEach(section => section.classList.remove('active'));

      // Show selected section
      const sectionId = item.getAttribute('data-section') + '-section';
      const section = document.getElementById(sectionId);
      if (section) {
        section.classList.add('active');
      }
    });
  });

  showLoadingBar();
  await renderRules();
  await renderGeminiUsage();
  await renderBulkContacts();
  await loadBulkDelaySettings();
  await renderMetrics();
  window.setInterval(renderGeminiUsage, 15000);
  window.setInterval(renderMetrics, 10000);
});

// --- INÍCIO: Barra de carregamento QR Code ---
function showLoadingBar() {
  const area = document.getElementById('loadingBarArea');
  if (!area) return;
  area.style.display = '';
}
// --- FIM: Barra de carregamento QR Code ---

// --- INÍCIO: QR Code e status WhatsApp (via preload) ---
let waIsConnected = false;
let connectionReadyTimer = null;

function updateConnectionLoader(data = {}) {
  const progress = Math.max(0, Math.min(100, Number(data.progress ?? 5)));
  const phase = data.phase || 'starting';
  const loader = document.getElementById('connectionLoader');
  const eyebrow = document.getElementById('connectionLoaderEyebrow');
  const title = document.getElementById('connectionLoaderTitle');
  const text = document.getElementById('connectionLoaderText');
  const hint = document.getElementById('connectionLoaderHint');
  const percent = document.getElementById('connectionLoaderPercent');
  const bar = document.getElementById('connectionProgressBar');
  if (!loader || !eyebrow || !title || !text || !hint || !percent || !bar) return;

  const copy = {
    starting: {
      eyebrow: 'Iniciando TurboWhats',
      title: 'Abrindo conexão segura',
      description: 'Estamos preparando os serviços usados para conectar seu WhatsApp.',
      hint: 'Mantenha o TurboWhats aberto durante esta preparação.'
    },
    qr: {
      eyebrow: 'Aguardando seu celular',
      title: 'Leia o QR Code para continuar',
      description: 'No WhatsApp, abra Aparelhos conectados e escolha Conectar aparelho.',
      hint: 'Depois da leitura, o QR Code desaparecerá e a autenticação começará automaticamente.'
    },
    authenticated: {
      eyebrow: 'Celular autorizado',
      title: 'QR Code confirmado',
      description: 'Seu celular autorizou o acesso. Agora estamos protegendo a sessão neste computador.',
      hint: 'Não feche o TurboWhats: a sincronização das conversas começará em seguida.'
    },
    sync: {
      eyebrow: 'Preparando seu atendimento',
      title: 'Organizando conversas e mensagens',
      description: data.message || 'Sincronizando os dados necessários para iniciar o atendimento.',
      hint: 'Na primeira conexão, esta etapa pode levar alguns minutos. O tempo depende da quantidade de conversas.'
    },
    ready: {
      eyebrow: 'TurboWhats online',
      title: 'Tudo pronto para atender',
      description: 'Seu WhatsApp foi conectado e o acompanhamento de mensagens está ativo.',
      hint: 'Você já pode configurar respostas, IA e disparos nas abas ao lado.'
    },
    reset: {
      eyebrow: 'Reiniciando conexão',
      title: 'Preparando um novo QR Code',
      description: 'Estamos encerrando a sessão anterior com segurança.',
      hint: 'O novo QR Code será exibido assim que estiver disponível.'
    }
  };
  const currentCopy = copy[phase] || copy.starting;
  eyebrow.textContent = currentCopy.eyebrow;
  title.textContent = currentCopy.title;
  text.textContent = currentCopy.description;
  hint.querySelector('p').textContent = currentCopy.hint;
  percent.textContent = `${Math.round(progress)}%`;
  bar.style.width = `${progress}%`;
  loader.dataset.phase = phase;
  loader.classList.toggle('success', phase === 'ready');

  const steps = ['connectionStepQr', 'connectionStepAuth', 'connectionStepSync', 'connectionStepReady'];
  const phaseIndex = { starting: 0, reset: 0, qr: 0, authenticated: 1, sync: 2, ready: 3 };
  const currentIndex = phaseIndex[phase] ?? 0;
  steps.forEach((step, index) => {
    const element = document.getElementById(step);
    if (!element) return;
    const done = phase === 'ready' || index < currentIndex;
    const active = phase !== 'ready' && index === currentIndex;
    element.classList.toggle('done', done);
    element.classList.toggle('active', active);
    const marker = element.querySelector('span');
    marker.textContent = done ? '✓' : String(index + 1);
  });
}

window.electronAPI.onWaQr((qrUrl) => {
  const qrcodeContainer = document.getElementById('qrcodeContainer');
  const connectedArea = document.getElementById('connectedArea');
  const imgDiv = document.getElementById('qrcodeImg');
  const loadingArea = document.getElementById('loadingBarArea');

  if (qrUrl) {
    waIsConnected = false;
    updateConnectionLoader({ phase: 'qr', progress: 10 });
    // Esconde área de conectado e carregamento
    if (connectedArea) connectedArea.style.display = 'none';
    if (loadingArea) loadingArea.style.display = 'none';

    // Mostra QR code
    if (qrcodeContainer) qrcodeContainer.style.display = '';
    if (imgDiv) {
      imgDiv.replaceChildren();
      const img = document.createElement('img');
      img.src = qrUrl;
      img.alt = 'QR Code do TurboWhats';
      img.className = 'qr-img';
      imgDiv.appendChild(img);
    }
  } else {
    // QR code escaneado, esconde container
    if (qrcodeContainer) qrcodeContainer.style.display = 'none';
    if (loadingArea && !waIsConnected) loadingArea.style.display = '';
  }
});

window.electronAPI.onWaStatus((data) => {
  const status = document.getElementById('waStatus');
  const errorArea = document.getElementById('errorArea');
  const errorText = document.getElementById('errorText');
  const btnReconectar = document.getElementById('btnReconectar');
  const connectedArea = document.getElementById('connectedArea');
  const loadingArea = document.getElementById('loadingBarArea');
  const qrcodeContainer = document.getElementById('qrcodeContainer');

  if (data.connected) {
    waIsConnected = true;
    clearTimeout(connectionReadyTimer);
    status.innerHTML = '<span class="status-dot connected">●</span> <span id="waStatusText">TurboWhats online</span>';
    errorArea.style.display = 'none';
    if (btnReconectar) btnReconectar.style.display = 'none';
    if (connectedArea) connectedArea.style.display = 'none';
    if (loadingArea) loadingArea.style.display = '';
    if (qrcodeContainer) qrcodeContainer.style.display = 'none';
    updateConnectionLoader({ ...data, phase: 'ready', progress: 100 });
    connectionReadyTimer = setTimeout(() => {
      if (loadingArea) loadingArea.style.display = 'none';
      if (connectedArea) connectedArea.style.display = '';
    }, 2200);
  } else if (data.error) {
    waIsConnected = false;
    clearTimeout(connectionReadyTimer);
    status.innerHTML = '<span class="status-dot disconnected">●</span> <span id="waStatusText">Erro ❌</span>';
    errorArea.style.display = '';
    errorText.textContent = data.error;
    if (btnReconectar) btnReconectar.style.display = '';
    if (connectedArea) connectedArea.style.display = 'none';
    if (loadingArea) loadingArea.style.display = 'none';
  } else if (data.message) {
    waIsConnected = false;
    clearTimeout(connectionReadyTimer);
    errorArea.style.display = 'none';
    updateConnectionLoader(data);
    if (data.phase === 'qr') {
      status.innerHTML = '<span class="status-dot attempting">●</span> <span id="waStatusText">Escaneando QR Code</span>';
      if (loadingArea) loadingArea.style.display = 'none';
      if (qrcodeContainer) qrcodeContainer.style.display = '';
      if (connectedArea) connectedArea.style.display = 'none';
    } else {
      status.innerHTML = '<span class="status-dot attempting">●</span> <span id="waStatusText">Conectando...</span>';
      if (loadingArea) loadingArea.style.display = '';
      if (qrcodeContainer) qrcodeContainer.style.display = 'none';
      if (connectedArea) connectedArea.style.display = 'none';
    }
  } else {
    waIsConnected = false;
    status.innerHTML = '<span class="status-dot disconnected">●</span> <span id="waStatusText">Desconectado ⚠️</span>';
    if (btnReconectar) btnReconectar.style.display = '';
    if (connectedArea) connectedArea.style.display = 'none';
  }
});
// --- FIM: QR Code e status WhatsApp ---

async function readConfig() {
  const cfg = await window.electronAPI.readConfig();
  return cfg || { rules: [], defaultMessage: '', defaultNoReply: '', aiApiKey: '', aiContexts: [] };
}

async function writeConfig(newCfg) {
  const result = await window.electronAPI.writeConfig(newCfg);
  if (!result || !result.ok) {
    throw new Error(result?.error || 'Não foi possível salvar a configuração.');
  }
}

// API Key
async function loadAiApiKey() {
  const cfg = await readConfig();
  return cfg.aiApiKey || '';
}
async function saveAiApiKey(key) {
  const cfg = await readConfig();
  cfg.aiApiKey = key;
  await writeConfig(cfg);
}

// ElevenLabs
async function loadElevenLabsConfig() {
  const cfg = await readConfig();
  return {
    apiKey: cfg.elevenLabsApiKey || '',
    voiceId: cfg.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM'
  };
}
async function saveElevenLabsConfig(apiKey, voiceId) {
  const cfg = await readConfig();
  cfg.elevenLabsApiKey = apiKey;
  cfg.elevenLabsVoiceId = voiceId;
  await writeConfig(cfg);
}

// Contextos IA
async function loadAiContexts() {
  const cfg = await readConfig();
  return cfg.aiContexts || [];
}
async function saveAiContexts(contexts) {
  const cfg = await readConfig();
  cfg.aiContexts = contexts;
  await writeConfig(cfg);
}
async function addAiContext(context) {
  const contexts = await loadAiContexts();
  contexts.push(context);
  await saveAiContexts(contexts);
  await renderAiContexts();
}
async function deleteAiContext(idx) {
  const contexts = await loadAiContexts();
  contexts.splice(idx, 1);
  await saveAiContexts(contexts);
  await renderAiContexts();
}

// Regras
async function loadRules() {
  const cfg = await readConfig();
  return cfg.rules || [];
}
async function saveRules(rules) {
  const cfg = await readConfig();
  cfg.rules = rules;
  await writeConfig(cfg);
}

// Mensagens padrão
async function loadDefaultMessage() {
  const cfg = await readConfig();
  return cfg.defaultMessage || '';
}
async function loadDefaultNoReply() {
  const cfg = await readConfig();
  return cfg.defaultNoReply || '';
}
async function saveDefaultMessage(msg) {
  const cfg = await readConfig();
  cfg.defaultMessage = msg;
  await writeConfig(cfg);
}
async function saveDefaultNoReply(msg) {
  const cfg = await readConfig();
  cfg.defaultNoReply = msg;
  await writeConfig(cfg);
}

const messageSaveFeedbackTimers = new Map();

function showMessageSaveFeedback(elementId, type, text) {
  const feedback = document.getElementById(elementId);
  if (!feedback) return;
  const previousTimer = messageSaveFeedbackTimers.get(elementId);
  if (previousTimer) window.clearTimeout(previousTimer);
  feedback.className = `message-save-feedback ${type} visible`;
  feedback.textContent = text;
  const timer = window.setTimeout(() => {
    feedback.classList.remove('visible');
    messageSaveFeedbackTimers.delete(elementId);
  }, 4500);
  messageSaveFeedbackTimers.set(elementId, timer);
}

async function renderRules() {
  const rules = await loadRules();
  const list = document.getElementById('rulesList');
  list.innerHTML = '';
  rules.forEach((rule, idx) => {
    const li = document.createElement('li');
    li.className = 'rule-item';

    const text = document.createElement('div');
    text.className = 'rule-text';
    text.textContent = `Quando receber: "${String(rule.trigger || '')}" → Responder: "${String(rule.response || '')}"`;

    const actions = document.createElement('span');
    actions.className = 'rule-actions';
    const editButton = document.createElement('button');
    editButton.className = 'btn btn-secondary';
    editButton.dataset.action = 'edit';
    editButton.dataset.idx = String(idx);
    editButton.textContent = 'Editar';
    const deleteButton = document.createElement('button');
    deleteButton.className = 'btn btn-danger';
    deleteButton.dataset.action = 'delete';
    deleteButton.dataset.idx = String(idx);
    deleteButton.textContent = 'Excluir';
    actions.append(editButton, deleteButton);
    li.append(text, actions);
    list.appendChild(li);
  });
  const rulesEmpty = document.getElementById('rulesEmpty');
  if (rulesEmpty) rulesEmpty.style.display = rules.length ? 'none' : '';
  document.getElementById('defaultMessage').value = await loadDefaultMessage();
  document.getElementById('defaultNoReply').value = await loadDefaultNoReply();
  document.getElementById('aiApiKey').value = await loadAiApiKey();
  document.getElementById('aiContext').value = '';
  await renderAiContexts();

  // flags IA
  const cfg = await readConfig();
  const defaultMessagesEnabled = document.getElementById('defaultMessagesEnabled');
  const aiEnabled = document.getElementById('aiEnabled');
  const aiUseConversation = document.getElementById('aiUseConversation');
  const aiVoiceEnabled = document.getElementById('aiVoiceEnabled');
  const simulatedTypingEnabled = document.getElementById('simulatedTypingEnabled');
  if (defaultMessagesEnabled) defaultMessagesEnabled.checked = cfg.defaultMessagesEnabled !== false;
  if (aiEnabled) aiEnabled.checked = cfg.aiEnabled !== false;
  if (aiUseConversation) aiUseConversation.checked = cfg.aiUseConversation !== false;
  if (aiVoiceEnabled) aiVoiceEnabled.checked = !!cfg.aiVoiceEnabled;
  if (simulatedTypingEnabled) simulatedTypingEnabled.checked = cfg.simulatedTypingEnabled !== false;
  updateAiEnabledDisplay(cfg.aiEnabled !== false);
  updateDefaultMessagesDisplay(cfg.defaultMessagesEnabled !== false);

  // ElevenLabs
  const voiceConfig = await loadElevenLabsConfig();
  const elevenLabsApiKey = document.getElementById('elevenLabsApiKey');
  const elevenLabsVoiceId = document.getElementById('elevenLabsVoiceId');
  if (elevenLabsApiKey) elevenLabsApiKey.value = voiceConfig.apiKey;
  if (elevenLabsVoiceId) elevenLabsVoiceId.value = voiceConfig.voiceId;
}

async function renderAiContexts() {
  const contexts = await loadAiContexts();
  const list = document.getElementById('aiContextList');
  list.innerHTML = '';
  contexts.forEach((ctx, idx) => {
    const li = document.createElement('li');
    li.className = 'context-item';
    const text = document.createElement('span');
    text.className = 'context-text';
    text.textContent = String(ctx);
    const deleteButton = document.createElement('button');
    deleteButton.className = 'btn btn-danger';
    deleteButton.dataset.action = 'delete-context';
    deleteButton.dataset.idx = String(idx);
    deleteButton.textContent = 'Excluir';
    li.append(text, deleteButton);
    list.appendChild(li);
  });
}

// Delegação de eventos para listas
document.getElementById('rulesList').addEventListener('click', async (e) => {
  const target = e.target;
  const action = target.getAttribute('data-action');
  const idx = Number(target.getAttribute('data-idx'));
  if (action === 'edit') {
    const rules = await loadRules();
    const rule = rules[idx];
    document.getElementById('trigger').value = rule.trigger;
    document.getElementById('response').value = rule.response;
    editingIdx = idx;
    document.getElementById('submitBtn').textContent = 'Salvar edição';
  } else if (action === 'delete') {
    const rules = await loadRules();
    rules.splice(idx, 1);
    await saveRules(rules);
    await renderRules();
  }
});

document.getElementById('aiContextList').addEventListener('click', async (e) => {
  const target = e.target;
  const action = target.getAttribute('data-action');
  const idx = Number(target.getAttribute('data-idx'));
  if (action === 'delete-context') {
    await deleteAiContext(idx);
  }
});

document.getElementById('refreshGeminiUsage').addEventListener('click', renderGeminiUsage);

document.getElementById('defaultMessagesEnabled').addEventListener('change', async (e) => {
  const enabled = !!e.target.checked;
  const cfg = await readConfig();
  cfg.defaultMessagesEnabled = enabled;
  e.target.disabled = true;
  try {
    await writeConfig(cfg);
    updateDefaultMessagesDisplay(enabled);
  } catch (error) {
    e.target.checked = !enabled;
    updateDefaultMessagesDisplay(!enabled);
    alert(`Não foi possível alterar as mensagens padrão: ${error.message}`);
  } finally {
    e.target.disabled = false;
  }
});

// Controle mestre e opções da IA
document.getElementById('aiEnabled').addEventListener('change', async (e) => {
  const enabled = !!e.target.checked;
  const toggle = e.target;
  const status = document.getElementById('aiApiStatus');
  const cfg = await readConfig();
  toggle.disabled = true;
  try {
    if (enabled) {
      const key = document.getElementById('aiApiKey').value.trim() || cfg.aiApiKey || '';
      if (!key) throw new Error('Salve uma API Key válida antes de ativar a IA.');
      status.className = 'api-status testing';
      status.textContent = 'Validando a chave antes de ativar a IA...';
      const result = await testAiApiKey(key);
      if (!result?.ok) throw new Error(result?.error || 'A chave não foi aceita pelo Gemini.');
      cfg.aiApiKey = key;
    }
    cfg.aiEnabled = enabled;
    await writeConfig(cfg);
    updateAiEnabledDisplay(enabled);
    status.className = enabled ? 'api-status success' : 'api-status saved';
    status.textContent = enabled
      ? 'Chave validada e IA ativada.'
      : 'IA desativada. As respostas pendentes foram canceladas.';
  } catch (error) {
    toggle.checked = !enabled;
    updateAiEnabledDisplay(!enabled);
    status.className = 'api-status error';
    status.textContent = `Não foi possível alterar o estado da IA: ${error.message}`;
  } finally {
    toggle.disabled = false;
  }
});

document.getElementById('aiUseConversation').addEventListener('change', async (e) => {
  const cfg = await readConfig();
  cfg.aiUseConversation = !!e.target.checked;
  await writeConfig(cfg);
});
document.getElementById('aiVoiceEnabled').addEventListener('change', async (e) => {
  const cfg = await readConfig();
  cfg.aiVoiceEnabled = !!e.target.checked;
  await writeConfig(cfg);
});
document.getElementById('simulatedTypingEnabled').addEventListener('change', async (e) => {
  const cfg = await readConfig();
  cfg.simulatedTypingEnabled = !!e.target.checked;
  await writeConfig(cfg);
});

// Salvar configurações de voz
document.getElementById('saveVoiceSettings').addEventListener('click', async () => {
  const apiKey = document.getElementById('elevenLabsApiKey').value.trim();
  const voiceId = document.getElementById('elevenLabsVoiceId').value;
  await saveElevenLabsConfig(apiKey, voiceId);
  alert('Configurações de voz salvas com sucesso!');
});

// Salva somente após validar e ativa a IA automaticamente.
document.getElementById('aiApiKeyForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const key = document.getElementById('aiApiKey').value.trim();
  const status = document.getElementById('aiApiStatus');
  const button = document.getElementById('saveAiApiKeyBtn');
  const toggle = document.getElementById('aiEnabled');
  if (!key) {
    status.className = 'api-status error';
    status.textContent = 'Informe uma API Key antes de salvar.';
    return;
  }
  button.disabled = true;
  button.textContent = 'Testando chave...';
  status.className = 'api-status testing';
  status.textContent = 'Testando a conexão com o Gemini...';
  try {
    const result = await testAiApiKey(key);
    if (!result?.ok) throw new Error(result?.error || 'A chave não foi aceita pelo Gemini.');
    const cfg = await readConfig();
    cfg.aiApiKey = key;
    cfg.aiEnabled = true;
    await writeConfig(cfg);
    toggle.checked = true;
    updateAiEnabledDisplay(true);
    status.className = 'api-status success';
    status.textContent = `Chave validada, salva e IA ativada usando ${result.model}.`;
    await renderGeminiUsage();
  } catch (error) {
    status.className = 'api-status error';
    status.textContent = `A chave não foi salva: ${error.message}`;
  } finally {
    button.disabled = document.getElementById('defaultMessagesEnabled')?.checked === false;
    button.textContent = 'Salvar e ativar API Key';
  }
});

// Adicionar contexto/treinamento da IA
document.getElementById('aiContextForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const context = document.getElementById('aiContext').value.trim();
  if (context) {
    await addAiContext(context);
    document.getElementById('aiContext').value = '';
  }
});

// Regras - adicionar/editar
document.getElementById('ruleForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const trigger = document.getElementById('trigger').value.trim();
  const response = document.getElementById('response').value.trim();
  if (trigger && response) {
    const rules = await loadRules();
    if (editingIdx !== null) {
      rules[editingIdx] = { trigger, response };
      editingIdx = null;
      document.getElementById('submitBtn').textContent = 'Adicionar Regra';
    } else {
      rules.push({ trigger, response });
    }
    await saveRules(rules);
    document.getElementById('trigger').value = '';
    document.getElementById('response').value = '';
    await renderRules();
  }
});

// Salvar mensagem padrão (primeira resposta)
document.getElementById('defaultMessageForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const msg = document.getElementById('defaultMessage').value;
  const button = document.getElementById('saveDefaultMessageBtn');
  button.disabled = true;
  button.textContent = 'Salvando...';
  try {
    await saveDefaultMessage(msg);
    showMessageSaveFeedback('defaultMessageSaveStatus', 'success', '✓ Primeira mensagem salva com sucesso.');
  } catch (error) {
    showMessageSaveFeedback('defaultMessageSaveStatus', 'error', `Não foi possível salvar: ${error.message}`);
  } finally {
    button.disabled = document.getElementById('defaultMessagesEnabled')?.checked === false;
    button.textContent = 'Salvar Mensagem';
  }
});

// Salvar mensagem padrão (sem resposta)
document.getElementById('defaultNoReplyForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const msg = document.getElementById('defaultNoReply').value;
  const button = document.getElementById('saveDefaultNoReplyBtn');
  button.disabled = true;
  button.textContent = 'Salvando...';
  try {
    await saveDefaultNoReply(msg);
    showMessageSaveFeedback('defaultNoReplySaveStatus', 'success', '✓ Mensagem padrão salva com sucesso.');
  } catch (error) {
    showMessageSaveFeedback('defaultNoReplySaveStatus', 'error', `Não foi possível salvar: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Salvar Mensagem';
  }
});

// --- Disparos em massa (integração Send Louro) ---
let bulkSelectedImagePath = null;
let bulkRunning = false;
const bulkSelectedIds = new Set();
const BULK_DELAY_MIN_SECONDS = 3;
const BULK_DELAY_MAX_SECONDS = 600;
const BULK_COUNTRY_CODES = ['591', '593', '506', '503', '502', '509', '504', '505', '507', '595', '598', '351', '55', '54', '56', '57', '53', '52', '51', '58', '34', '44', '39', '49', '33', '1'];

function bulkDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeBulkPhone(value) {
  let digits = bulkDigits(value);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

function buildBulkPhone(countryCode, areaCode, localNumber) {
  const country = bulkDigits(countryCode);
  const area = bulkDigits(areaCode);
  const number = bulkDigits(localNumber);
  const phone = `${country}${area}${number}`;
  if (!country || country.length > 3 || !area || area.length > 4 || number.length < 4 || number.length > 12) return null;
  return phone.length >= 8 && phone.length <= 15 ? phone : null;
}

function getBulkPhoneParts(contact = {}) {
  const storedCountry = bulkDigits(contact.countryCode);
  const storedArea = bulkDigits(contact.areaCode);
  const storedNumber = bulkDigits(contact.localNumber);
  if (buildBulkPhone(storedCountry, storedArea, storedNumber)) {
    return { countryCode: storedCountry, areaCode: storedArea, localNumber: storedNumber };
  }

  const phone = normalizeBulkPhone(contact.phone) || '';
  const countryCode = BULK_COUNTRY_CODES.find(code => phone.startsWith(code)) || '55';
  const nationalNumber = phone.startsWith(countryCode) ? phone.slice(countryCode.length) : phone;
  const preferredAreaLength = countryCode === '1' ? 3 : 2;
  const areaLength = nationalNumber.length > preferredAreaLength + 4 ? preferredAreaLength : Math.max(1, nationalNumber.length - 4);
  return {
    countryCode,
    areaCode: nationalNumber.slice(0, areaLength),
    localNumber: nationalNumber.slice(areaLength)
  };
}

function formatBulkPhone(contact = {}) {
  const parts = getBulkPhoneParts(contact);
  const number = parts.localNumber;
  const formattedNumber = number.length > 4 ? `${number.slice(0, -4)}-${number.slice(-4)}` : number;
  return `+${parts.countryCode}${parts.areaCode ? ` (${parts.areaCode})` : ''}${formattedNumber ? ` ${formattedNumber}` : ''}`;
}

function updateBulkPhonePreview() {
  const preview = document.getElementById('bulkPhonePreview');
  if (!preview) return;
  const countryCode = bulkDigits(document.getElementById('bulkContactCountry').value);
  const areaCode = bulkDigits(document.getElementById('bulkContactAreaCode').value);
  const localNumber = bulkDigits(document.getElementById('bulkContactNumber').value);
  const phone = buildBulkPhone(countryCode, areaCode, localNumber);
  const formatted = formatBulkPhone({ countryCode, areaCode, localNumber, phone });
  preview.replaceChildren(document.createTextNode(phone ? 'Número completo: ' : 'Preencha DDD e número: '));
  const strong = document.createElement('strong');
  strong.textContent = formatted;
  preview.appendChild(strong);
}

function applyBulkPreviewTags(template, contact) {
  const fullName = String(contact?.name || '').trim() || 'Cliente';
  const firstName = fullName.split(/\s+/)[0];
  const now = new Date();
  const values = {
    nome: fullName,
    primeironome: firstName,
    telefone: formatBulkPhone(contact),
    data: now.toLocaleDateString('pt-BR'),
    hora: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  };
  return String(template || '').replace(
    /\{(Nome|PrimeiroNome|Telefone|Data|Hora)\}/gi,
    (_match, tag) => values[tag.toLowerCase()]
  );
}

async function updateBulkMessagePreview() {
  const preview = document.getElementById('bulkMessagePreview');
  if (!preview) return;
  const message = document.getElementById('bulkMessage').value;
  if (!message) {
    preview.textContent = 'Digite uma mensagem para visualizar a personalização.';
    return;
  }
  const contacts = await loadBulkContacts();
  const contact = contacts.find(item => bulkSelectedIds.has(item.id)) || contacts[0] || {
    name: 'João da Silva',
    phone: '5511999999999'
  };
  preview.textContent = applyBulkPreviewTags(message, contact);
}

async function loadBulkContacts() {
  const cfg = await readConfig();
  return Array.isArray(cfg.bulkContacts) ? cfg.bulkContacts : [];
}

async function saveBulkContacts(contacts) {
  const cfg = await readConfig();
  cfg.bulkContacts = contacts;
  await writeConfig(cfg);
}

function getBulkDelayRange() {
  const rawMin = Number(document.getElementById('bulkDelayMin').value);
  const rawMax = Number(document.getElementById('bulkDelayMax').value);
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) return null;
  const min = Math.round(rawMin);
  const max = Math.round(rawMax);
  if (min < BULK_DELAY_MIN_SECONDS || max > BULK_DELAY_MAX_SECONDS || min > max) return null;
  return { min, max };
}

async function loadBulkDelaySettings() {
  const cfg = await readConfig();
  document.getElementById('bulkDelayMin').value = Number(cfg.bulkDelayMinSeconds) || 10;
  document.getElementById('bulkDelayMax').value = Number(cfg.bulkDelayMaxSeconds) || 20;
}

async function saveBulkDelaySettings(range) {
  const cfg = await readConfig();
  cfg.bulkDelayMinSeconds = range.min;
  cfg.bulkDelayMaxSeconds = range.max;
  await writeConfig(cfg);
}

for (const fieldId of ['bulkDelayMin', 'bulkDelayMax']) {
  document.getElementById(fieldId).addEventListener('change', async () => {
    const range = getBulkDelayRange();
    if (range) await saveBulkDelaySettings(range);
  });
}

function setBulkRunning(running) {
  bulkRunning = running;
  document.getElementById('bulkStart').disabled = running;
  document.getElementById('bulkCancel').style.display = running ? '' : 'none';
  document.getElementById('bulkContactForm').querySelectorAll('input, select, button').forEach(element => {
    element.disabled = running;
  });
  document.getElementById('bulkImportContacts').disabled = running;
  document.getElementById('bulkImportWhatsApp').disabled = running;
  document.getElementById('bulkDeleteSelected').disabled = running || bulkSelectedIds.size === 0;
}

function setBulkImportFeedback(type, message) {
  const feedback = document.getElementById('bulkImportFeedback');
  if (!feedback) return;
  feedback.className = `bulk-import-feedback ${type || ''}`.trim();
  feedback.textContent = message || '';
}

function setBulkImportButtonsDisabled(disabled) {
  document.getElementById('bulkImportContacts').disabled = disabled || bulkRunning;
  document.getElementById('bulkImportWhatsApp').disabled = disabled || bulkRunning;
}

async function mergeImportedBulkContacts(importedContacts) {
  const contacts = await loadBulkContacts();
  const phones = new Set(contacts.map(contact => normalizeBulkPhone(contact.phone)).filter(Boolean));
  let added = 0;
  let skipped = 0;

  for (const imported of importedContacts || []) {
    const phone = normalizeBulkPhone(imported.phone);
    if (!phone || phones.has(phone)) {
      skipped++;
      continue;
    }
    const phoneParts = getBulkPhoneParts({ phone });
    contacts.push({
      id: crypto.randomUUID(),
      name: String(imported.name || '').trim(),
      phone,
      ...phoneParts
    });
    phones.add(phone);
    added++;
  }

  if (added) {
    await saveBulkContacts(contacts);
    await renderBulkContacts();
  }
  return { added, skipped };
}

async function renderBulkContacts() {
  const contacts = await loadBulkContacts();
  const list = document.getElementById('bulkContactsList');
  if (!list) return;
  list.replaceChildren();

  if (!contacts.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Nenhum contato cadastrado.';
    list.appendChild(empty);
  }

  for (const contact of contacts) {
    const row = document.createElement('div');
    row.className = 'bulk-contact-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'bulk-contact-select';
    checkbox.dataset.id = contact.id;
    checkbox.checked = bulkSelectedIds.has(contact.id);
    checkbox.disabled = bulkRunning;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) bulkSelectedIds.add(contact.id);
      else bulkSelectedIds.delete(contact.id);
      updateBulkSelectionState(contacts);
      updateBulkMessagePreview();
    });

    const info = document.createElement('div');
    info.className = 'bulk-contact-info';
    const name = document.createElement('strong');
    name.textContent = contact.name || 'Sem nome';
    const phone = document.createElement('span');
    phone.textContent = formatBulkPhone(contact);
    info.append(name, phone);

    const actions = document.createElement('div');
    actions.className = 'bulk-contact-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn btn-secondary btn-small';
    edit.textContent = 'Editar';
    edit.disabled = bulkRunning;
    edit.addEventListener('click', () => editBulkContact(contact));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-danger btn-small';
    remove.textContent = 'Excluir';
    remove.disabled = bulkRunning;
    remove.addEventListener('click', () => deleteBulkContact(contact.id));
    actions.append(edit, remove);

    row.append(checkbox, info, actions);
    list.appendChild(row);
  }

  document.getElementById('bulkContactCount').textContent = `${contacts.length} contato${contacts.length === 1 ? '' : 's'}`;
  updateBulkSelectionState(contacts);
  await updateBulkMessagePreview();
}

function updateBulkSelectionState(contacts) {
  const validIds = new Set(contacts.map(contact => contact.id));
  for (const id of bulkSelectedIds) {
    if (!validIds.has(id)) bulkSelectedIds.delete(id);
  }
  const selectAll = document.getElementById('bulkSelectAll');
  selectAll.checked = contacts.length > 0 && contacts.every(contact => bulkSelectedIds.has(contact.id));
  selectAll.indeterminate = contacts.some(contact => bulkSelectedIds.has(contact.id)) && !selectAll.checked;
  const selectedCount = contacts.filter(contact => bulkSelectedIds.has(contact.id)).length;
  const deleteButton = document.getElementById('bulkDeleteSelected');
  deleteButton.disabled = bulkRunning || selectedCount === 0;
  deleteButton.textContent = selectedCount
    ? `Excluir selecionados (${selectedCount})`
    : 'Excluir selecionados';
}

function editBulkContact(contact) {
  const phoneParts = getBulkPhoneParts(contact);
  document.getElementById('bulkContactId').value = contact.id;
  document.getElementById('bulkContactName').value = contact.name || '';
  document.getElementById('bulkContactCountry').value = phoneParts.countryCode;
  document.getElementById('bulkContactAreaCode').value = phoneParts.areaCode;
  document.getElementById('bulkContactNumber').value = phoneParts.localNumber;
  document.getElementById('bulkSaveContact').textContent = 'Salvar';
  updateBulkPhonePreview();
}

async function deleteBulkContact(id) {
  const contacts = await loadBulkContacts();
  await saveBulkContacts(contacts.filter(contact => contact.id !== id));
  bulkSelectedIds.delete(id);
  await renderBulkContacts();
}

function removeBulkContactsByIds(contacts, selectedIds) {
  const ids = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  return (contacts || []).filter(contact => !ids.has(contact.id));
}

document.getElementById('bulkContactForm').addEventListener('submit', async event => {
  event.preventDefault();
  const id = document.getElementById('bulkContactId').value;
  const name = document.getElementById('bulkContactName').value.trim();
  const countryCode = bulkDigits(document.getElementById('bulkContactCountry').value);
  const areaCode = bulkDigits(document.getElementById('bulkContactAreaCode').value);
  const localNumber = bulkDigits(document.getElementById('bulkContactNumber').value);
  const phone = buildBulkPhone(countryCode, areaCode, localNumber);
  if (!phone) {
    alert('Confira o país, o DDD e o número. Exemplo: Brasil (+55), DDD 21 e número 981682922.');
    return;
  }

  const contacts = await loadBulkContacts();
  const duplicate = contacts.find(contact => normalizeBulkPhone(contact.phone) === phone && contact.id !== id);
  if (duplicate) {
    alert('Este número já está cadastrado.');
    return;
  }
  const savedContact = { id: id || crypto.randomUUID(), name, countryCode, areaCode, localNumber, phone };
  if (id) {
    const index = contacts.findIndex(contact => contact.id === id);
    if (index >= 0) contacts[index] = savedContact;
  } else {
    contacts.push(savedContact);
  }
  await saveBulkContacts(contacts);
  event.target.reset();
  document.getElementById('bulkContactId').value = '';
  document.getElementById('bulkSaveContact').textContent = 'Adicionar';
  updateBulkPhonePreview();
  await renderBulkContacts();
});

for (const fieldId of ['bulkContactAreaCode', 'bulkContactNumber']) {
  document.getElementById(fieldId).addEventListener('input', event => {
    event.target.value = bulkDigits(event.target.value);
    updateBulkPhonePreview();
  });
}
document.getElementById('bulkContactCountry').addEventListener('change', updateBulkPhonePreview);

document.getElementById('bulkSelectAll').addEventListener('change', async event => {
  const contacts = await loadBulkContacts();
  if (event.target.checked) contacts.forEach(contact => bulkSelectedIds.add(contact.id));
  else bulkSelectedIds.clear();
  await renderBulkContacts();
});

document.getElementById('bulkDeleteSelected').addEventListener('click', async () => {
  const contacts = await loadBulkContacts();
  const selectedContacts = contacts.filter(contact => bulkSelectedIds.has(contact.id));
  if (!selectedContacts.length) return;

  const confirmed = confirm(`Excluir ${selectedContacts.length} contato${selectedContacts.length === 1 ? '' : 's'} selecionado${selectedContacts.length === 1 ? '' : 's'}? Esta ação não pode ser desfeita.`);
  if (!confirmed) return;

  const button = document.getElementById('bulkDeleteSelected');
  button.disabled = true;
  button.textContent = 'Excluindo...';
  const selectedIdSet = new Set(selectedContacts.map(contact => contact.id));
  const editingId = document.getElementById('bulkContactId').value;

  try {
    await saveBulkContacts(removeBulkContactsByIds(contacts, selectedIdSet));
    bulkSelectedIds.clear();
    if (selectedIdSet.has(editingId)) {
      document.getElementById('bulkContactForm').reset();
      document.getElementById('bulkContactId').value = '';
      document.getElementById('bulkSaveContact').textContent = 'Adicionar';
      updateBulkPhonePreview();
    }
    setBulkImportFeedback('success', `${selectedContacts.length} contato${selectedContacts.length === 1 ? '' : 's'} excluído${selectedContacts.length === 1 ? '' : 's'} com sucesso.`);
    await renderBulkContacts();
  } catch (error) {
    setBulkImportFeedback('error', `Não foi possível excluir os contatos: ${error.message || error}`);
    updateBulkSelectionState(contacts);
  }
});

document.getElementById('bulkImportWhatsApp').addEventListener('click', async () => {
  const button = document.getElementById('bulkImportWhatsApp');
  const originalContent = button.innerHTML;
  setBulkImportButtonsDisabled(true);
  button.textContent = 'Lendo contatos...';
  setBulkImportFeedback('loading', 'Sincronizando a lista de contatos salvos do WhatsApp...');

  try {
    const result = await window.electronAPI.importWhatsAppContacts();
    if (!result?.ok) {
      setBulkImportFeedback('error', result?.error || 'Não foi possível importar os contatos do WhatsApp.');
      return;
    }

    const merged = await mergeImportedBulkContacts(result.contacts);
    const details = [];
    if (merged.skipped) details.push(`${merged.skipped} já existente${merged.skipped === 1 ? '' : 's'} no TurboWhats`);
    if (result.unresolved) details.push(`${result.unresolved} sem número disponível`);
    if (result.truncated) details.push(`${result.truncated} acima do limite de 5.000`);
    const suffix = details.length ? ` ${details.join('; ')}.` : '';
    let message;
    if (merged.added) {
      message = `${merged.added} contato${merged.added === 1 ? '' : 's'} importado${merged.added === 1 ? '' : 's'} do WhatsApp.${suffix}`;
    } else if (!result.savedCount) {
      message = 'Nenhum contato salvo foi encontrado no WhatsApp conectado.';
    } else {
      message = `Nenhum contato novo foi adicionado.${suffix || ' Todos os contatos encontrados já estavam cadastrados.'}`;
    }
    setBulkImportFeedback('success', message);
  } catch (error) {
    setBulkImportFeedback('error', `Falha ao importar: ${error.message || error}`);
  } finally {
    button.innerHTML = originalContent;
    setBulkImportButtonsDisabled(false);
  }
});

document.getElementById('bulkImportContacts').addEventListener('click', async () => {
  setBulkImportButtonsDisabled(true);
  setBulkImportFeedback('loading', 'Abrindo e validando a planilha de contatos...');
  try {
    const result = await window.electronAPI.importBulkContacts();
    if (!result?.ok) {
      setBulkImportFeedback('error', result?.error || 'Falha ao importar contatos.');
      return;
    }
    if (!result.contacts.length) {
      setBulkImportFeedback('', '');
      return;
    }

    const merged = await mergeImportedBulkContacts(result.contacts);
    const skippedText = merged.skipped ? ` ${merged.skipped} linha${merged.skipped === 1 ? '' : 's'} inválida${merged.skipped === 1 ? '' : 's'} ou duplicada${merged.skipped === 1 ? '' : 's'}.` : '';
    setBulkImportFeedback('success', `${merged.added} contato${merged.added === 1 ? '' : 's'} importado${merged.added === 1 ? '' : 's'} da planilha.${skippedText}`);
  } catch (error) {
    setBulkImportFeedback('error', `Falha ao importar: ${error.message || error}`);
  } finally {
    setBulkImportButtonsDisabled(false);
  }
});

document.getElementById('bulkSelectImage').addEventListener('click', async () => {
  const imagePath = await window.electronAPI.selectBulkImage();
  if (!imagePath) return;
  bulkSelectedImagePath = imagePath;
  document.getElementById('bulkImageName').textContent = imagePath.split(/[\\/]/).pop();
  document.getElementById('bulkClearImage').style.display = '';
});

document.getElementById('bulkClearImage').addEventListener('click', () => {
  bulkSelectedImagePath = null;
  document.getElementById('bulkImageName').textContent = 'Nenhuma imagem selecionada';
  document.getElementById('bulkClearImage').style.display = 'none';
});

document.getElementById('bulkMessage').addEventListener('input', updateBulkMessagePreview);

document.querySelectorAll('.tag-chip').forEach(button => {
  button.addEventListener('click', () => {
    const textarea = document.getElementById('bulkMessage');
    const tag = button.dataset.tag || '';
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.setRangeText(tag, start, end, 'end');
    textarea.focus();
    updateBulkMessagePreview();
  });
});

window.electronAPI.onBulkProgress(data => {
  const area = document.getElementById('bulkProgressArea');
  area.style.display = '';
  document.getElementById('bulkProgressText').textContent = data.error ? 'Envio com falha' : 'Enviando campanha';
  document.getElementById('bulkProgressStats').textContent = `${data.current}/${data.total} • ${data.sent} enviados • ${data.failed} falhas`;
  document.getElementById('bulkProgressBar').style.width = `${Math.round((data.current / data.total) * 100)}%`;

  const line = document.createElement('div');
  line.className = data.error ? 'bulk-log-error' : 'bulk-log-success';
  const label = data.contact.name || data.contact.phone;
  const waitText = Number.isFinite(data.nextDelaySeconds) ? ` • próximo envio em ${data.nextDelaySeconds}s` : '';
  line.textContent = data.error ? `✕ ${label}: ${data.error}${waitText}` : `✓ ${label}${waitText}`;
  const log = document.getElementById('bulkProgressLog');
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
});

document.getElementById('bulkStart').addEventListener('click', async () => {
  if (!document.getElementById('bulkConsent').checked) {
    alert('Confirme que os contatos autorizaram o recebimento das mensagens.');
    return;
  }
  const allContacts = await loadBulkContacts();
  const contacts = allContacts.filter(contact => bulkSelectedIds.has(contact.id));
  if (!contacts.length) {
    alert('Selecione pelo menos um contato.');
    return;
  }

  const message = document.getElementById('bulkMessage').value.trim();
  if (!message && !bulkSelectedImagePath) {
    alert('Digite uma mensagem ou selecione uma imagem.');
    return;
  }

  const delayRange = getBulkDelayRange();
  if (!delayRange) {
    alert('Informe um intervalo válido entre 3 e 600 segundos. O valor “De” não pode ser maior que o valor “Até”.');
    return;
  }
  await saveBulkDelaySettings(delayRange);

  const progressArea = document.getElementById('bulkProgressArea');
  progressArea.style.display = '';
  document.getElementById('bulkProgressText').textContent = 'Preparando campanha...';
  document.getElementById('bulkProgressStats').textContent = `0/${contacts.length}`;
  document.getElementById('bulkProgressBar').style.width = '0%';
  document.getElementById('bulkProgressLog').replaceChildren();
  setBulkRunning(true);

  try {
    const result = await window.electronAPI.startBulkSend({
      contacts,
      message,
      imagePath: bulkSelectedImagePath,
      delayMinSeconds: delayRange.min,
      delayMaxSeconds: delayRange.max
    });
    if (!result?.ok) {
      alert(result?.error || 'Não foi possível iniciar o envio.');
      return;
    }
    document.getElementById('bulkProgressText').textContent = result.cancelled ? 'Campanha cancelada' : 'Campanha concluída';
    document.getElementById('bulkProgressStats').textContent = `${result.sent} enviados • ${result.failed} falhas`;
  } catch (err) {
    alert(`Erro durante o envio: ${err.message}`);
  } finally {
    setBulkRunning(false);
    await renderBulkContacts();
  }
});

document.getElementById('bulkCancel').addEventListener('click', async () => {
  const result = await window.electronAPI.cancelBulkSend();
  if (!result?.ok) alert(result?.error || 'Não foi possível cancelar.');
  else document.getElementById('bulkProgressText').textContent = 'Cancelando...';
});
