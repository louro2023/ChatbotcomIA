(() => {
  const api = window.electronAPI;
  if (!api.getTelegramState) return;
  const el = id => document.getElementById(id);
  let state = {}, busy = false;
  function render(data) {
    state = data;
    const waiting = ['connecting', 'qr', 'password'].includes(data.phase);
    el('telegram-status').textContent = data.connected ? `Conectado · ${data.label || data.account}` : waiting ? 'Conectando' : 'Desconectado';
    el('telegram-status').className = `group-badge${data.connected ? ' active' : ''}`;
    el('telegram-header-status').textContent = `Telegram · ${data.connected ? 'Conectado' : waiting ? 'Conectando' : 'Desconectado'}`;
    el('telegram-header-status').className = `group-badge${data.connected ? ' active' : ''}`;
    el('telegram-connect').disabled = busy || data.connected || waiting;
    for (const id of ['telegram-api-id', 'telegram-api-hash']) el(id).disabled = busy || data.connected || waiting;
    el('telegram-logout').disabled = busy || (!data.connected && !waiting && !data.savedSession && data.phase === 'idle');
    el('telegram-qr-area').hidden = !data.qr;
    if (data.qr) el('telegram-qr').src = data.qr; else el('telegram-qr').removeAttribute('src');
    el('telegram-password-form').hidden = !data.passwordRequired;
    el('telegram-password-hint').textContent = data.hint ? `Dica da sua conta: ${data.hint}` : '';
    el('telegram-feedback').textContent = data.error || (data.connected ? 'Telegram conectado. O WhatsApp continua independente.' : data.passwordRequired ? 'Digite a senha de duas etapas para concluir.' : data.qr ? 'Escaneie o QR Code no Telegram do celular.' : waiting ? 'Preparando conexão com o Telegram...' : data.savedSession ? 'Sessão salva. Clique em Conectar para retomar sem preencher as credenciais.' : 'Configure as credenciais para gerar o QR Code.');
  }
  async function action(callback) {
    let errorMessage = '';
    busy = true; render(state);
    try { const result = await callback(); if (result?.ok === false) throw new Error(result.error); }
    catch (error) { errorMessage = error.message; }
    finally { busy = false; render(state); if (errorMessage) el('telegram-feedback').textContent = errorMessage; }
  }
  el('telegram-connect-form').onsubmit = event => {
    event.preventDefault();
    const apiId = el('telegram-api-id').value.trim(), apiHash = el('telegram-api-hash').value.trim();
    void action(async () => {
      const result = await api.connectTelegram(apiId || apiHash ? { apiId, apiHash } : undefined);
      el('telegram-api-hash').value = ''; return result;
    });
  };
  el('telegram-password-form').onsubmit = event => {
    event.preventDefault(); const password = el('telegram-password').value; el('telegram-password').value = '';
    void action(() => api.submitTelegramPassword(password));
  };
  el('telegram-logout').onclick = async () => {
    if (await window.askConfirmation('Desconectar o Telegram e remover a sessão salva? O WhatsApp continuará conectado.', { confirmLabel: 'Desconectar Telegram' })) void action(() => api.logoutTelegram());
  };
  api.onTelegramStatus(render);
  void api.getTelegramState().then(render).catch(error => { el('telegram-feedback').textContent = error.message; });
})();
