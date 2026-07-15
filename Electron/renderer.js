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
  window.setInterval(renderGeminiUsage, 15000);
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
  const title = document.getElementById('connectionLoaderTitle');
  const text = document.getElementById('connectionLoaderText');
  const percent = document.getElementById('connectionLoaderPercent');
  const bar = document.getElementById('connectionProgressBar');
  if (!loader || !title || !text || !percent || !bar) return;

  const copy = {
    starting: ['Preparando conexão segura...', 'Aguarde enquanto iniciamos os serviços necessários.'],
    qr: ['Aguardando leitura do QR Code', 'Escaneie o código acima usando o WhatsApp do seu celular.'],
    authenticated: ['QR Code confirmado!', 'Autenticando sua conta e protegendo a sessão local...'],
    sync: ['Sincronizando com o WhatsApp', data.message || 'Carregando conversas e preparando o atendimento...'],
    ready: ['Conexão realizada com sucesso!', 'Seu WhatsApp está pronto para receber e enviar mensagens.'],
    reset: ['Preparando um novo QR Code', 'Encerrando a sessão anterior com segurança...']
  };
  const [heading, description] = copy[phase] || copy.starting;
  title.textContent = heading;
  text.textContent = description;
  percent.textContent = `${Math.round(progress)}%`;
  bar.style.width = `${progress}%`;
  loader.classList.toggle('success', phase === 'ready');

  const steps = [
    { id: 'connectionStepQr', threshold: 10 },
    { id: 'connectionStepAuth', threshold: 45 },
    { id: 'connectionStepSync', threshold: 65 },
    { id: 'connectionStepReady', threshold: 100 }
  ];
  let activeAssigned = false;
  steps.forEach((step, index) => {
    const element = document.getElementById(step.id);
    const nextThreshold = steps[index + 1]?.threshold ?? 101;
    const done = progress >= nextThreshold || progress === 100;
    const active = !done && progress >= step.threshold && !activeAssigned;
    element.classList.toggle('done', done);
    element.classList.toggle('active', active);
    const marker = element.querySelector('span');
    marker.textContent = done ? '✓' : String(index + 1);
    if (active) activeAssigned = true;
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
      img.alt = 'QR Code';
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
    status.innerHTML = '<span class="status-dot connected">●</span> <span id="waStatusText">Conectado ✅</span>';
    errorArea.style.display = 'none';
    if (btnReconectar) btnReconectar.style.display = 'none';
    if (connectedArea) connectedArea.style.display = 'none';
    if (loadingArea) loadingArea.style.display = '';
    if (qrcodeContainer) qrcodeContainer.style.display = 'none';
    updateConnectionLoader({ ...data, phase: 'ready', progress: 100 });
    connectionReadyTimer = setTimeout(() => {
      if (loadingArea) loadingArea.style.display = 'none';
      if (connectedArea) connectedArea.style.display = '';
    }, 1400);
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
  if (defaultMessagesEnabled) defaultMessagesEnabled.checked = cfg.defaultMessagesEnabled !== false;
  if (aiEnabled) aiEnabled.checked = cfg.aiEnabled !== false;
  if (aiUseConversation) aiUseConversation.checked = cfg.aiUseConversation !== false;
  if (aiVoiceEnabled) aiVoiceEnabled.checked = !!cfg.aiVoiceEnabled;
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

function normalizeBulkPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.length >= 12 && digits.length <= 15 ? digits : null;
}

function applyBulkPreviewTags(template, contact) {
  const fullName = String(contact?.name || '').trim() || 'Cliente';
  const firstName = fullName.split(/\s+/)[0];
  const now = new Date();
  const values = {
    nome: fullName,
    primeironome: firstName,
    telefone: String(contact?.phone || ''),
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

function setBulkRunning(running) {
  bulkRunning = running;
  document.getElementById('bulkStart').disabled = running;
  document.getElementById('bulkCancel').style.display = running ? '' : 'none';
  document.getElementById('bulkContactForm').querySelectorAll('input, button').forEach(element => {
    element.disabled = running;
  });
  document.getElementById('bulkImportContacts').disabled = running;
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
    phone.textContent = contact.phone;
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
}

function editBulkContact(contact) {
  document.getElementById('bulkContactId').value = contact.id;
  document.getElementById('bulkContactName').value = contact.name || '';
  document.getElementById('bulkContactPhone').value = contact.phone;
  document.getElementById('bulkSaveContact').textContent = 'Salvar';
}

async function deleteBulkContact(id) {
  const contacts = await loadBulkContacts();
  await saveBulkContacts(contacts.filter(contact => contact.id !== id));
  bulkSelectedIds.delete(id);
  await renderBulkContacts();
}

document.getElementById('bulkContactForm').addEventListener('submit', async event => {
  event.preventDefault();
  const id = document.getElementById('bulkContactId').value;
  const name = document.getElementById('bulkContactName').value.trim();
  const phone = normalizeBulkPhone(document.getElementById('bulkContactPhone').value);
  if (!phone) {
    alert('Informe um número válido com DDD. Exemplo: 5511999999999.');
    return;
  }

  const contacts = await loadBulkContacts();
  const duplicate = contacts.find(contact => contact.phone === phone && contact.id !== id);
  if (duplicate) {
    alert('Este número já está cadastrado.');
    return;
  }
  if (id) {
    const index = contacts.findIndex(contact => contact.id === id);
    if (index >= 0) contacts[index] = { id, name, phone };
  } else {
    contacts.push({ id: crypto.randomUUID(), name, phone });
  }
  await saveBulkContacts(contacts);
  event.target.reset();
  document.getElementById('bulkContactId').value = '';
  document.getElementById('bulkSaveContact').textContent = 'Adicionar';
  await renderBulkContacts();
});

document.getElementById('bulkSelectAll').addEventListener('change', async event => {
  const contacts = await loadBulkContacts();
  if (event.target.checked) contacts.forEach(contact => bulkSelectedIds.add(contact.id));
  else bulkSelectedIds.clear();
  await renderBulkContacts();
});

document.getElementById('bulkImportContacts').addEventListener('click', async () => {
  const result = await window.electronAPI.importBulkContacts();
  if (!result?.ok) {
    alert(result?.error || 'Falha ao importar contatos.');
    return;
  }
  if (!result.contacts.length) return;

  const contacts = await loadBulkContacts();
  const phones = new Set(contacts.map(contact => contact.phone));
  let added = 0;
  for (const imported of result.contacts) {
    const phone = normalizeBulkPhone(imported.phone);
    if (!phone || phones.has(phone)) continue;
    contacts.push({ id: crypto.randomUUID(), name: imported.name || '', phone });
    phones.add(phone);
    added++;
  }
  await saveBulkContacts(contacts);
  await renderBulkContacts();
  alert(`${added} contato${added === 1 ? '' : 's'} importado${added === 1 ? '' : 's'}.`);
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
  line.textContent = data.error ? `✕ ${label}: ${data.error}` : `✓ ${label}`;
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
      delaySeconds: Number(document.getElementById('bulkDelay').value)
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
