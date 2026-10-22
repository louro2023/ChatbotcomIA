const crypto = require('crypto');
const normalize = value => String(value || '').trim().toLowerCase();
function createGroupMonitor({ read, write, account, send, typing = async () => {}, report = () => {}, isGroupId = id => id.endsWith('@g.us') }) {
  const pending = new Set();
  const done = new Set();
  function accountKey() {
    const id = account();
    if (!id) throw new Error('Conta indisponível.');
    return crypto.createHash('sha256').update(id).digest('hex');
  }
  function settings() { return read()[accountKey()] || {}; }
  function update(payload) {
    const key = accountKey();
    const state = read();
    const groups = state[key] || {};
    const id = String(payload.groupId || '');
    if (!isGroupId(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('Grupo inválido.');
    const previous = groups[id] || { enabled: false, commands: [] };
    const next = { ...previous, commands: previous.commands.slice() };
    if (payload.action === 'toggle-group') {
      next.enabled = payload.enabled === true;
      if (next.enabled) {
        for (const [otherId, group] of Object.entries(groups)) {
          if (otherId !== id && group.enabled) groups[otherId] = { ...group, enabled: false };
        }
      }
    }
    else if (payload.action === 'save-command') {
      const trigger = normalize(payload.trigger);
      const response = String(payload.response || '');
      if (!/^![^\s!]+$/u.test(trigger)) throw new Error('Use um comando iniciado por !, sem espaços.');
      if (!response.trim()) throw new Error('Informe a mensagem de resposta.');
      const index = payload.id ? next.commands.findIndex(command => command.id === payload.id) : -1;
      if (payload.id && index < 0) throw new Error('Comando não encontrado.');
      if (next.commands.some(command => command.trigger === trigger && command.id !== payload.id)) throw new Error('Este comando já existe neste grupo.');
      const command = { id: payload.id || crypto.randomUUID(), trigger, response, enabled: payload.enabled === true };
      if (index < 0) next.commands.push(command); else next.commands[index] = command;
    } else if (payload.action === 'save-schedule') {
      const intervalMinutes = Number(payload.intervalMinutes);
      const messages = Array.isArray(payload.messages) ? payload.messages.map(text => String(text).trim()).filter(Boolean) : [];
      if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 10080) throw new Error('Informe um intervalo inteiro entre 1 e 10080 minutos.');
      if (!messages.length || messages.length > 20 || messages.some(text => text.length > 10000)) throw new Error('Adicione de 1 a 20 mensagens, com até 10000 caracteres cada.');
      next.schedule = { enabled: payload.enabled === true, intervalMinutes, messages, revision: crypto.randomUUID() };
    } else if (payload.action === 'toggle-typing') {
      next.simulatedTypingEnabled = payload.enabled === true;
    } else {
      const index = next.commands.findIndex(command => command.id === payload.id);
      if (index < 0) throw new Error('Comando não encontrado.');
      if (payload.action === 'delete-command') next.commands.splice(index, 1);
      else if (payload.action === 'toggle-command') next.commands[index] = { ...next.commands[index], enabled: payload.enabled === true };
      else throw new Error('Ação inválida.');
    }
    state[key] = { ...groups, [id]: next };
    write(state);
    return state[key];
  }
  async function handle(message, source = 'event') {
    if (!isGroupId(String(message?.from || '')) || !account()) return false;
    const group = settings()[message.from];
    if (!group?.enabled) return false;
    const notify = (decision, details = {}) => report({ groupId: message.from, source, decision, ...details });
    if (message.fromMe) { notify('own-message'); return false; }
    const command = group?.enabled && group.commands.find(command => command.enabled && command.trigger === normalize(message.body));
    if (!command) { notify('no-match'); return false; }
    const id = require('./whatsapp-compat').serializedMessageId(message.id);
    if (!id) return false;
    const key = `${accountKey()}:${id}`;
    if (pending.has(key) || done.has(key)) return false;
    pending.add(key);
    const respondingAccount = account();
    try {
      notify('matched', { command: command.trigger });
      if (group.simulatedTypingEnabled !== false) {
        notify('typing', { command: command.trigger });
        await typing(message.from, command.response);
      }
      if (account() !== respondingAccount || !settings()[message.from]?.enabled || !settings()[message.from].commands.some(current => current.id === command.id && current.enabled)) {
        notify('cancelled', { command: command.trigger });
        return false;
      }
      await send(message.from, command.response);
      done.add(key);
      while (done.size > 5000) done.delete(done.values().next().value);
      notify('sent', { command: command.trigger });
      return true;
    } catch (error) {
      notify('send-error', { command: command.trigger, error: error.message });
      throw error;
    } finally { pending.delete(key); }
  }
  return { settings, update, handle };
}
module.exports = { createGroupMonitor };
