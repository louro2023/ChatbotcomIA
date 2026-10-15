function createSessionRecovery({ state, stop, destroy, initialize, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let pending = null;
  function reconnect() {
    if (state.connected) return Promise.resolve({ ok: true, alreadyConnected: true });
    if (pending) return pending;
    if (state.initializing) return Promise.resolve({ ok: false, error: 'A conexão com o WhatsApp já está sendo iniciada.' });
    const work = (async () => {
      state.initializing = true;
      state.attempting = true;
      stop();
      try {
        await destroy();
        await wait(1000);
        state.initializing = false;
        return await initialize();
      } catch (error) {
        state.initializing = false;
        state.attempting = false;
        throw error;
      }
    })();
    pending = work;
    void work.finally(() => { if (pending === work) pending = null; }).catch(() => {});
    return work;
  }
  return { reconnect };
}
module.exports = { createSessionRecovery };
