function createGroupScheduler({ account, settings, send, typing = async () => {}, report = () => {}, onError = () => {}, now = Date.now }) {
  const jobs = new Map();
  let timer = null, running = false, busy = false, generation = 0;
  function signature(owner, id, group) {
    return JSON.stringify([owner, id, group.schedule, group.simulatedTypingEnabled]);
  }
  function valid(group) {
    const schedule = group?.schedule;
    return group?.enabled && schedule?.enabled && Number.isInteger(schedule.intervalMinutes)
      && schedule.intervalMinutes >= 1 && schedule.intervalMinutes <= 10080
      && Array.isArray(schedule.messages) && schedule.messages.length > 0
      && schedule.messages.every(text => typeof text === 'string' && text.trim());
  }
  async function tick() {
    if (!running || busy) return;
    busy = true;
    const version = generation;
    try {
      const owner = account();
      const groups = owner ? settings() : {};
      for (const id of jobs.keys()) if (!valid(groups[id]) || jobs.get(id).signature !== signature(owner, id, groups[id])) jobs.delete(id);
      for (const [id, group] of Object.entries(groups)) {
        if (!id.endsWith('@g.us') || !valid(group)) continue;
        const interval = group.schedule.intervalMinutes * 60000;
        if (!jobs.has(id)) jobs.set(id, { signature: signature(owner, id, group), nextAt: now() + interval, index: 0, lastSentAt: null, error: '' });
        const job = jobs.get(id);
        if (now() < job.nextAt) continue;
        const text = group.schedule.messages[job.index % group.schedule.messages.length];
        const stillCurrent = () => running && version === generation && account() === owner
          && valid(settings()[id]) && signature(owner, id, settings()[id]) === job.signature;
        try {
          if (group.simulatedTypingEnabled !== false) await typing(id, text);
          if (!stillCurrent()) continue;
          await send(id, text);
          job.index++;
          job.lastSentAt = now(); job.error = '';
          report({ groupId: id, source: 'schedule', decision: 'sent', command: 'Envio programado' });
        } catch (error) {
          job.error = error.message;
          report({ groupId: id, source: 'schedule', decision: 'send-error', command: 'Envio programado', error: error.message });
        } finally {
          // Resume with a full interval, without accumulating missed sends.
          job.nextAt = now() + interval;
        }
      }
    } catch (error) { onError(error); }
    finally { busy = false; }
  }
  function stop() { running = false; generation++; clearInterval(timer); timer = null; jobs.clear(); }
  function start() { stop(); running = true; void tick(); timer = setInterval(() => { void tick(); }, 1000); }
  function status() { return Object.fromEntries([...jobs].map(([id, job]) => [id, { nextAt: job.nextAt, lastSentAt: job.lastSentAt, error: job.error }])); }
  return { start, stop, tick, status };
}
module.exports = { createGroupScheduler };
