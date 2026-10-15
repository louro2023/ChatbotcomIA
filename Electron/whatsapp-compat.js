// Runtime bridge for WA message keys renamed from _serialized to $1.
// Source: https://github.com/wwebjs/whatsapp-web.js/issues/201845
function installWhatsAppMessageKeyCompatibility() {
  const collections = window.require('WAWebCollections');
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
  return { patchedPrototypes, compatibleKeys: keys.filter(key => typeof key._serialized === 'string').length };
}
function serializedMessageId(id) {
  if (typeof id === 'string') return id;
  return id?._serialized || id?.$1 || '';
}
function withWhatsAppCompatibility(Client) {
  return class extends Client {
    async attachEventListeners() {
      await this.pupPage.evaluate(installWhatsAppMessageKeyCompatibility);
      return super.attachEventListeners();
    }
  };
}
module.exports = { installWhatsAppMessageKeyCompatibility, serializedMessageId, withWhatsAppCompatibility };
