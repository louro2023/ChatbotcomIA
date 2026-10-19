(() => {
  const api = window.electronAPI;
  let connected = false, account = '', groups = [], settings = {}, selected = '', editing = '', busy = false;
  let connectionVersion = 0;
  const el = id => document.getElementById(id);
  const feedback = text => { el('groups-feedback').textContent = text; };
  const searchKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const node = (tag, text) => { const element = document.createElement(tag); if (text) element.textContent = text; return element; };
  function addScheduleMessage(value = '') {
    const list = el('group-schedule-messages');
    if (list.children.length >= 20) return;
    const row = node('div'); row.className = 'group-schedule-variation';
    const label = node('label', 'Mensagem / variação');
    const text = node('textarea'); text.rows = 4; text.required = true; text.maxLength = 10000; text.value = value;
    text.placeholder = 'Escreva a mensagem para enviar no grupo. Aceita emojis, links e várias linhas.';
    label.append(text);
    const remove = button('Remover variação');
    remove.onclick = () => { if (list.children.length > 1) row.remove(); else text.value = ''; };
    row.append(label, remove); list.append(row);
  }
  function loadSchedule() {
    const schedule = settings[selected]?.schedule;
    el('group-schedule-minutes').value = schedule?.intervalMinutes || 30;
    el('group-schedule-enabled').checked = schedule?.enabled === true;
    el('group-schedule-messages').replaceChildren();
    for (const text of schedule?.messages || ['']) addScheduleMessage(text);
    el('group-schedule-status').textContent = '';
  }
  function clearForm() {
    editing = ''; el('groups-form').reset(); el('group-command-enabled').checked = true;
    el('groups-form-title').textContent = 'Novo comando'; el('groups-save').textContent = 'Salvar comando';
  }
  function selectGroup(id) {
    if (selected !== id) {
      selected = id; clearForm(); loadSchedule();
      for (const name of ['received', 'sent', 'errors']) el(`groups-live-${name}`).textContent = '0';
      el('groups-live-activity').replaceChildren();
      el('groups-live-error').hidden = true;
      el('groups-reader-status').textContent = 'Consultando o monitoramento deste grupo...';
    }
    feedback('Grupo selecionado. Cadastre os comandos no painel de configuração.');
    render();
    void refreshRuntime();
    el('groups-section').scrollTop = 0;
  }
  function button(text, className = 'btn btn-secondary btn-small') {
    const result = node('button', text); result.type = 'button'; result.className = className; return result;
  }
  function render() {
    el('groups-status').textContent = connected ? `${account ? `Conta: ${account.split('@')[0]}` : 'WhatsApp conectado'}${selected ? '' : ` · ${groups.length} grupo(s) disponível(is)`}` : 'Monitoramento indisponível: WhatsApp desconectado.';
    el('groups-refresh').disabled = busy || !connected;
    el('groups-refresh').textContent = busy ? 'Aguarde...' : 'Atualizar grupos';
    const list = el('groups-list'); const scrollTop = list.scrollTop; list.replaceChildren();
    const filtered = groups.filter(group => searchKey(group.name).includes(searchKey(el('groups-search').value.trim())));
    el('groups-count').textContent = groups.length ? `${filtered.length} de ${groups.length} grupo(s)` : '';
    if (!groups.length) list.textContent = connected ? 'Atualize a lista para carregar seus grupos.' : 'Conecte o WhatsApp para listar seus grupos.';
    else if (!filtered.length) list.textContent = 'Nenhum grupo corresponde à pesquisa. Tente outro nome.';
    for (const group of filtered) {
      const row = node('div'); row.className = `group-row${selected === group.id ? ' selected' : ''}`; row.dataset.groupId = group.id;
      const avatar = node('div', group.photo ? '' : (group.name.trim()[0] || 'G').toUpperCase()); avatar.className = 'group-avatar';
      if (group.photo) { const photo = node('img'); photo.src = group.photo; photo.alt = ''; avatar.append(photo); }
      const info = node('div'); info.className = 'group-info';
      const choose = button(group.name, 'group-select'); choose.setAttribute('aria-pressed', String(selected === group.id)); choose.disabled = busy;
      choose.onclick = () => selectGroup(group.id);
      const enabled = settings[group.id]?.enabled === true;
      const badge = node('span', !connected ? 'Indisponível' : enabled ? 'Ativo' : 'Inativo'); badge.className = `group-badge${enabled ? ' active' : ''}`;
      info.append(choose, badge);
      const actions = node('div'); actions.className = 'group-row-actions';
      const configure = button(selected === group.id ? 'Selecionado' : 'Configurar', 'btn btn-secondary btn-small group-configure'); configure.disabled = busy;
      configure.onclick = () => selectGroup(group.id);
      const label = node('label'); label.className = 'group-monitor-toggle';
      const toggle = node('input'); toggle.type = 'checkbox'; toggle.checked = enabled; toggle.disabled = busy || !connected; toggle.setAttribute('aria-label', `Monitorar ${group.name}`);
      toggle.onchange = () => { const checked = toggle.checked; selectGroup(group.id); void mutate({ action: 'toggle-group', enabled: checked }); };
      label.append(toggle, document.createTextNode(' Monitorar')); actions.append(configure, label);
      row.append(avatar, info, actions); list.append(row);
    }
    list.scrollTop = scrollTop;
    const current = groups.find(group => group.id === selected);
    document.querySelector('.groups-browser').hidden = Boolean(current);
    document.querySelector('.groups-editor').hidden = !current;
    document.querySelector('.groups-layout').classList.toggle('group-focused', Boolean(current));
    el('groups-refresh').hidden = Boolean(current);
    el('groups-change').hidden = !current;
    el('groups-change').disabled = busy;
    el('groups-live').hidden = !current;
    el('groups-selected').textContent = current ? current.name : 'Selecione um grupo';
    el('groups-empty').hidden = Boolean(current);
    el('groups-form').hidden = !current;
    el('groups-schedule-form').hidden = !current;
    el('groups-schedule-form').querySelectorAll('input,textarea,button').forEach(input => { input.disabled = busy || !connected; });
    el('groups-selected-controls').hidden = !current;
    el('groups-command-area').hidden = !current;
    el('groups-form').querySelectorAll('input,textarea,button').forEach(input => { input.disabled = busy || !connected; });
    const groupEnabled = settings[selected]?.enabled === true;
    el('groups-live-state').textContent = !connected ? 'Desconectado' : groupEnabled ? 'Aguardando leitura' : 'Inativo';
    el('groups-live-state').className = 'group-badge';
    el('groups-selected-enabled').checked = groupEnabled;
    el('groups-simulated-typing').checked = settings[selected]?.simulatedTypingEnabled !== false;
    el('groups-selected-enabled').disabled = busy || !connected;
    el('groups-selected-status').textContent = !connected ? 'Indisponível' : groupEnabled ? 'Ativo' : 'Inativo';
    el('groups-selected-status').className = `group-badge${groupEnabled && connected ? ' active' : ''}`;
    el('groups-selected-help').textContent = groupEnabled ? 'Os comandos ativos respondem às novas mensagens deste grupo.' : 'Cadastre os comandos e ative o monitoramento. Ao ativar este grupo, o grupo anterior será desativado.';
    const commands = el('groups-commands'); commands.replaceChildren();
    if (!current) return;
    const items = settings[selected]?.commands || [];
    el('groups-command-count').textContent = String(items.length);
    if (!items.length) { const empty = node('p', 'Nenhum comando cadastrado. Crie o primeiro comando no formulário acima.'); empty.className = 'groups-empty'; commands.append(empty); }
    for (const command of items) {
      const row = node('article'); row.className = 'group-command'; row.dataset.commandId = command.id;
      const heading = node('div'); heading.className = 'groups-command-heading';
      heading.append(node('strong', command.trigger));
      const label = node('label'); const toggle = node('input'); toggle.type = 'checkbox'; toggle.checked = command.enabled; toggle.disabled = busy || !connected;
      toggle.onchange = () => mutate({ action: 'toggle-command', id: command.id, enabled: toggle.checked });
      label.append(toggle, document.createTextNode(command.enabled ? ' Ativo' : ' Inativo')); heading.append(label);
      const response = node('p', command.response); response.className = 'group-response';
      const actions = node('div'); actions.className = 'groups-form-actions';
      const edit = button('Editar'); edit.disabled = busy || !connected;
      edit.onclick = () => {
        editing = command.id; el('group-trigger').value = command.trigger; el('group-response').value = command.response; el('group-command-enabled').checked = command.enabled;
        el('groups-form-title').textContent = `Editando ${command.trigger}`; el('groups-save').textContent = 'Salvar alterações'; el('group-trigger').focus();
      };
      const remove = button('Excluir'); remove.disabled = busy || !connected;
      remove.onclick = async () => {
        const targetGroup = selected;
        if (await askConfirmation(`Excluir o comando ${command.trigger}?`, { confirmLabel: 'Excluir' })) await mutate({ groupId: targetGroup, action: 'delete-command', id: command.id });
      };
      actions.append(edit, remove); row.append(heading, response, actions); commands.append(row);
    }
  }
  async function mutate(payload) {
    if (busy || !connected) return;
    const version = connectionVersion;
    busy = true; render();
    try {
      const result = await api.updateGroup({ account, groupId: selected, ...payload });
      if (version !== connectionVersion) return;
      if (!result.ok) throw new Error(result.error);
      settings = result.settings;
      if (payload.action === 'save-schedule') loadSchedule();
      if (payload.action === 'save-command' || payload.id === editing) clearForm();
      feedback(payload.action === 'save-command' ? 'Comando salvo. Cadastre outro comando ou teste no grupo com outra conta.' : payload.action === 'save-schedule' ? 'Envio automático salvo. As variações serão alternadas a cada intervalo.' : 'Configuração salva.');
    } catch (error) { feedback(error.message); }
    finally { busy = false; render(); void refreshRuntime(); }
  }
  async function refresh() {
    if (busy || !connected || !api.listGroups) return;
    const version = connectionVersion;
    busy = true; render(); feedback('Carregando grupos do WhatsApp...');
    try {
      const result = await api.listGroups();
      if (!connected || version !== connectionVersion) return;
      if (!result.ok) throw new Error(result.error);
      if (account !== result.account) { selected = ''; clearForm(); }
      account = result.account; groups = result.groups; settings = result.settings;
      if (!groups.some(group => group.id === selected)) { selected = ''; clearForm(); }
      feedback(groups.length ? 'Grupos atualizados. Clique em Configurar para cadastrar os comandos.' : 'Nenhum grupo retornado. Aguarde a sincronização e atualize novamente.');
    } catch (error) { feedback(error.message); }
    finally { busy = false; render(); }
    void loadPhotos();
  }
  async function loadPhotos() {
    if (!api.getGroupPhoto) return;
    const currentGroups = groups, currentAccount = account;
    for (const group of currentGroups) {
      if (!connected || groups !== currentGroups || account !== currentAccount) break;
      if (group.photo) continue;
      try {
        const photo = await api.getGroupPhoto({ account: currentAccount, groupId: group.id });
        if (!photo || !connected || groups !== currentGroups) continue;
        group.photo = photo;
        // Update only the avatar: replacing rows during a click can swallow it.
        const row = [...el('groups-list').children].find(row => row.dataset.groupId === group.id);
        const avatar = row?.querySelector('.group-avatar');
        if (avatar) { const img = node('img'); img.src = photo; img.alt = ''; avatar.replaceChildren(img); }
      } catch (_) { /* Photos are optional. */ }
    }
  }
  async function refreshRuntime() {
    if (!api.getGroupRuntimeStatus || !selected || !el('groups-section').classList.contains('active')) return;
    const groupId = selected;
    const version = connectionVersion;
    try {
      const status = await api.getGroupRuntimeStatus();
      if (selected !== groupId || status.account !== account || version !== connectionVersion) return;
      const item = status.groups[groupId] || {};
      const schedule = settings[groupId]?.schedule;
      const runtime = status.schedules?.[groupId];
      el('group-schedule-status').textContent = !schedule?.enabled ? 'Envio automático desativado.'
        : !status.connected ? 'Envio pausado: WhatsApp desconectado.'
        : !settings[groupId]?.enabled ? 'Ative o monitoramento deste grupo para iniciar os envios.'
        : runtime?.error ? `Falha no envio: ${runtime.error}. Nova tentativa no próximo intervalo.`
        : runtime?.nextAt ? `Próximo envio: ${new Date(runtime.nextAt).toLocaleString('pt-BR')} · ${schedule.messages.length} variação(ões).`
        : 'Preparando o próximo envio...';
      const decisions = {
        'own-message': 'Mensagem da própria conta ignorada. Teste com outra conta.',
        'no-match': 'Mensagem lida; nenhum comando ativo corresponde ao texto completo.',
        matched: 'Comando identificado; enviando resposta...',
        typing: 'Digitando a resposta...',
        cancelled: 'Resposta cancelada porque o grupo ou comando foi desativado.',
        sent: 'Resposta enviada com sucesso.',
        'send-error': `Falha ao enviar: ${item.error || 'consulte o diagnóstico'}`
      };
      const scanTime = status.lastScanAt ? new Date(status.lastScanAt).toLocaleTimeString('pt-BR') : '';
      const summary = !status.connected ? 'Leitura indisponível: WhatsApp desconectado.'
        : !settings[groupId]?.enabled ? 'Monitoramento inativo para este grupo.'
        : status.error ? `Falha na leitura: ${status.error}`
        : status.syncing ? 'WhatsApp sincronizando mensagens; sessão preservada.'
        : status.running && scanTime ? `Leitura contínua ativa · última verificação ${scanTime}` : 'Preparando leitura das mensagens...';
      el('groups-reader-status').textContent = `${summary} · ${item.received || 0} mensagem(ns) observada(s) · ${item.sent || 0} resposta(s). ${decisions[item.lastDecision] || ''}`;
      el('groups-live-state').textContent = !status.connected ? 'Desconectado' : !settings[groupId]?.enabled ? 'Inativo' : status.error ? 'Erro na leitura' : status.syncing ? 'Sincronizando' : status.running && scanTime ? 'Leitura ativa' : 'Preparando';
      el('groups-live-state').className = `group-badge${status.connected && settings[groupId]?.enabled && status.running && !status.error ? ' active' : ''}`;
      el('groups-live-received').textContent = String(item.received || 0);
      el('groups-live-sent').textContent = String(item.sent || 0);
      el('groups-live-errors').textContent = String(item.failed || 0);
      const error = status.error || item.error || '';
      el('groups-live-error').hidden = !error;
      el('groups-live-error').textContent = error ? `Erro: ${error}` : '';
      const activity = el('groups-live-activity'); activity.replaceChildren();
      for (const entry of (item.activity || []).slice(0, 40)) {
        const row = node('li'); row.className = entry.decision === 'send-error' ? 'group-activity-error' : entry.decision === 'sent' ? 'group-activity-success' : '';
        const time = node('time', new Date(entry.timestamp).toLocaleTimeString('pt-BR')); time.dateTime = entry.timestamp;
        const description = entry.decision === 'send-error' ? `Falha ao enviar ${entry.command}: ${entry.error}` : `${decisions[entry.decision] || entry.decision}${entry.command ? ` (${entry.command})` : ''}`;
        row.append(time, node('span', description)); activity.append(row);
      }
      if (!activity.children.length) activity.append(node('li', 'Aguardando novas mensagens neste grupo.'));
    } catch (error) {
      if (selected !== groupId || version !== connectionVersion) return;
      el('groups-reader-status').textContent = `Não foi possível consultar a leitura: ${error.message}`;
      el('groups-live-state').textContent = 'Erro na atualização';
      el('groups-live-error').hidden = false; el('groups-live-error').textContent = error.message;
    }
  }
  el('groups-search').addEventListener('input', render);
  el('group-schedule-add').onclick = () => addScheduleMessage();
  el('groups-schedule-form').onsubmit = event => {
    event.preventDefault();
    void mutate({ action: 'save-schedule', intervalMinutes: Number(el('group-schedule-minutes').value),
      messages: [...el('group-schedule-messages').querySelectorAll('textarea')].map(input => input.value),
      enabled: el('group-schedule-enabled').checked });
  };
  el('groups-form').onsubmit = event => { event.preventDefault(); void mutate({ action: 'save-command', id: editing || undefined, trigger: el('group-trigger').value, response: el('group-response').value, enabled: el('group-command-enabled').checked }); };
  el('groups-selected-enabled').onchange = event => mutate({ action: 'toggle-group', enabled: event.target.checked });
  el('groups-simulated-typing').onchange = event => mutate({ action: 'toggle-typing', enabled: event.target.checked });
  el('groups-cancel-edit').onclick = clearForm;
  el('groups-refresh').onclick = refresh;
  el('groups-change').onclick = () => {
    selected = ''; clearForm(); render(); feedback('Selecione o grupo que deseja configurar.');
    el('groups-section').scrollTop = 0;
    el('groups-search').focus();
  };
  document.querySelector('[data-section="groups"]').addEventListener('click', refresh);
  api.onWaStatus(data => {
    const wasConnected = connected; connected = data.connected === true;
    if (connected !== wasConnected) connectionVersion++;
    if (!connected && selected) {
      el('group-schedule-status').textContent = 'Envio pausado: WhatsApp desconectado. A contagem reinicia ao reconectar.';
      el('groups-reader-status').textContent = 'Leitura indisponível: WhatsApp desconectado.';
      el('groups-live-error').hidden = false; el('groups-live-error').textContent = 'WhatsApp desconectado. Reconecte para retomar o monitoramento.';
    }
    render();
    if (connected && !wasConnected && el('groups-section').classList.contains('active')) void refresh();
  });
  window.setInterval(refreshRuntime, 2000);
  render();
})();
