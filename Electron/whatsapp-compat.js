// Runtime bridge for WA message keys renamed from _serialized to $1.
// Source: https://github.com/wwebjs/whatsapp-web.js/issues/201845
function installWhatsAppMessageKeyCompatibility() {
  if (typeof window.require !== 'function') return { ready: false, patchedPrototypes: 0, compatibleKeys: 0 };
  const collections = window.require('WAWebCollections');
  if (!collections?.Chat?.getModelsArray || !collections?.Msg) return { ready: false, patchedPrototypes: 0, compatibleKeys: 0 };
  const keys = [
    ...(collections.Msg?.getModelsArray?.() || []).map(message => message.id),
    ...collections.Chat.getModelsArray().map(chat => chat.lastReceivedKey)
  ].filter(Boolean);
  let patchedPrototypes = 0;
  for (const key of keys) {
    if (typeof key.$1 !== 'string' || key._serialized != null) continue;
    const prototype = Object.getPrototypeOf(key);
    if (!prototype || prototype === Object.prototype || Object.getOwnPropertyDescriptor(prototype, '_serialized')) continue;
    Object.defineProperty(prototype, '_serialized', {
      configurable: true,
      get() { return this.$1; },
      set(value) { Object.defineProperty(this, '_serialized', { configurable: true, writable: true, enumerable: true, value }); }
    });
    patchedPrototypes++;
  }
  // serialize() returns plain keys: normalize the library's public message model too.
  const utils = window.WWebJS;
  if (utils?.getMessageModel && !utils.getMessageModel.turboWhatsMessageKeyCompatibility) {
    const original = utils.getMessageModel;
    const compatible = function (...args) {
      const message = original.apply(this, args);
      const id = message?.id;
      if (id && typeof id === 'object' && !id._serialized && typeof id.$1 === 'string') {
        message.id = { ...id, _serialized: id.$1 };
      }
      return message;
    };
    compatible.turboWhatsMessageKeyCompatibility = true;
    utils.getMessageModel = compatible;
  }
  return { ready: true, patchedPrototypes, compatibleKeys: keys.filter(key => typeof key._serialized === 'string').length };
}
function serializedMessageId(id) {
  if (typeof id === 'string') return id;
  return id?._serialized || id?.$1 || '';
}
async function completeWhatsAppInitialSync() {
  const socket = typeof window.require === 'function' && window.require('WAWebSocketModel')?.Socket;
  if (!socket?.hasSynced || window.WWebJS || typeof window.onAppStateHasSyncedEvent !== 'function') return;
  if (window.turboWhatsInitialSyncPending) return window.turboWhatsInitialSyncPending;
  const pending = window.onAppStateHasSyncedEvent();
  window.turboWhatsInitialSyncPending = pending;
  try { return await pending; }
  finally { if (window.turboWhatsInitialSyncPending === pending) window.turboWhatsInitialSyncPending = null; }
}
function withWhatsAppCompatibility(Client) {
  return class extends Client {
    async inject() {
      if (this._turboInjectPending) return this._turboInjectPending;
      const work = (async () => {
        const attached = await this.pupPage.evaluate(() => {
          if (!window.turboWhatsListenersAttached || !window.WWebJS || typeof window.require !== 'function') return false;
          const state = window.require('WAWebSocketModel')?.Socket?.state;
          return ['CONNECTED', 'OPENING', 'PAIRING', 'TIMEOUT', 'CONFLICT'].includes(state);
        });
        if (attached) return;
        let authenticated = false;
        const onAuthenticated = () => { authenticated = true; };
        this.on('authenticated', onAuthenticated);
        try {
          await super.inject();
          // The socket may already be synced before the library subscribes to
          // change:hasSynced. Complete that initial handshake exactly once.
          if (!authenticated) await this.pupPage.evaluate(completeWhatsAppInitialSync);
        } finally { this.removeListener('authenticated', onAuthenticated); }
      })();
      this._turboInjectPending = work;
      try { return await work; }
      finally { if (this._turboInjectPending === work) this._turboInjectPending = null; }
    }
    async attachEventListeners() {
      if (this._turboAttachPending) return this._turboAttachPending;
      const work = (async () => {
        const attached = await this.pupPage.evaluate(() => Boolean(window.turboWhatsListenersAttached));
        if (attached) return;
        await this.pupPage.evaluate(installWhatsAppMessageKeyCompatibility);
        await super.attachEventListeners();
        await this.pupPage.evaluate(() => { window.turboWhatsListenersAttached = true; });
      })();
      this._turboAttachPending = work;
      try { return await work; }
      finally { if (this._turboAttachPending === work) this._turboAttachPending = null; }
    }
  };
}
module.exports = { installWhatsAppMessageKeyCompatibility, serializedMessageId, completeWhatsAppInitialSync, withWhatsAppCompatibility };
