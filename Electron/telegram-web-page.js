// Runs inside the official Telegram Web K page; authentication stays in its
// own browser profile. Nothing here exports application credentials.
async function telegramWebPage(action = 'state', args = {}) {
  const root = window.rootScope, m = root?.managers;
  const owner = root?.myId ? `telegram:${root.myId}` : '';
  const visible = el => el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  const groupId = peer => peer._ === 'peerChannel' ? `telegram:${-(1000000000000n + BigInt(peer.channel_id))}` : peer._ === 'peerChat' ? `telegram:-${peer.chat_id}` : '';
  if (action === 'state') {
    if (owner) return { connected: true, account: owner, phase: 'ready', label: owner };
    const password = [...document.querySelectorAll('input[type="password"]')].find(visible);
    if (password) return { connected: false, phase: 'password', passwordRequired: true, error: password.classList.contains('error') ? 'Senha incorreta. Tente novamente.' : '' };
    const canvas = [...document.querySelectorAll('canvas')].find(c => /qr/i.test(c.className) && c.width >= 150);
    if (canvas) return { connected: false, phase: 'qr', qr: canvas.toDataURL('image/png') };
    return { connected: false, phase: 'connecting' };
  }
  if (action === 'password') {
    const input = [...document.querySelectorAll('input[type="password"]')].find(visible);
    if (!input || input.disabled) throw new Error('Não há solicitação de senha pendente.');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, args.password);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, charCode: 13, bubbles: true }));
    return { ok: true };
  }
  if (!owner || !m?.apiManager) throw new Error('O Telegram Web ainda não está conectado.');
  if (args.owner && args.owner !== owner) throw new Error('A conta do Telegram mudou.');
  if (action === 'logout') { await m.apiManager.logOut(); return { ok: true }; }
  let bridge = window.__turboWhatsTelegramWeb;
  if (!bridge || bridge.owner !== owner || bridge.root !== root) {
    if (bridge?.listeners) for (const [name, fn] of bridge.listeners) bridge.root.removeEventListener(name, fn);
    bridge = window.__turboWhatsTelegramWeb = { owner, root, peers: new Map(), queue: [], media: new Map(), listeners: [], since: Math.floor(Date.now() / 1000) };
    const receive = async value => {
      const msg = value?.message && typeof value.message === 'object' ? value.message : value;
      if (msg?._ !== 'message' || msg.pFlags?.out || msg.date < bridge.since || (!msg.message && !msg.media)) return;
      try {
        const peer = await m.appPeersManager.getOutputPeer(msg.peerId);
        if (`telegram:${root.myId}` !== owner || window.__turboWhatsTelegramWeb !== bridge) return;
        const group = peer._ !== 'peerUser';
        if (group && await m.appPeersManager.isBroadcast(msg.peerId)) return;
        const id = group ? groupId(peer) : `${owner}:${peer.user_id}`;
        bridge.peers.set(id, { inputPeer: await m.appPeersManager.getInputPeerById(msg.peerId), peerId: msg.peerId });
        const rawId = Number(msg.id ?? Number(msg.mid) % 0x100000000), key = `${owner}:${id}:${rawId}`;
        const document = msg.media?.document, photo = msg.media?.photo;
        const mime = document?.mime_type || (photo ? 'image/jpeg' : '');
        if (mime) { bridge.media.set(key, { document, photo }); while (bridge.media.size > 100) bridge.media.delete(bridge.media.keys().next().value); }
        bridge.queue.push({ from: id, body: String(msg.message || ''), fromMe: false, id: { _serialized: key }, timestamp: msg.date,
          isGroup: group, messageId: rawId, hasMedia: Boolean(mime), mime,
          type: mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : mime ? 'document' : 'chat' });
        if (bridge.queue.length > 2000) bridge.queue.shift();
      } catch (error) { bridge.error = error.message || String(error); }
    };
    for (const name of ['history_multiappend', 'history_append']) { root.addEventListener(name, receive); bridge.listeners.push([name, receive]); }
  }
  if (action === 'install') return { ok: true };
  if (action === 'poll') return { messages: bridge.queue.splice(0), error: bridge.error || '' };
  const invoke = async (method, params) => {
    if (`telegram:${window.rootScope?.myId}` !== owner) throw new Error('A conta do Telegram mudou.');
    const result = await m.apiManager.invokeApi(method, params, { ignoreErrors: true });
    if (`telegram:${window.rootScope?.myId}` !== owner) throw new Error('A conta do Telegram mudou.');
    return result;
  };
  if (action === 'groups') {
    const result = new Map();
    for (const folder of [0, 1]) {
      let offsetPeer = { _: 'inputPeerEmpty' }, offsetId = 0, offsetDate = 0;
      for (let page = 0; page < 20; page++) {
        const response = await invoke('messages.getDialogs', { folder_id: folder, offset_peer: offsetPeer, offset_id: offsetId, offset_date: offsetDate, limit: 100, hash: '0', exclude_pinned: offsetId > 0 });
        if (!Array.isArray(response.dialogs)) break;
        await m.appChatsManager.saveApiChats(response.chats || []);
        await m.appUsersManager.saveApiUsers(response.users || []);
        const chats = new Map((response.chats || []).map(chat => [String(chat.id), chat]));
        const users = new Map((response.users || []).map(user => [String(user.id), user]));
        const inputOf = peer => {
          if (peer._ === 'peerUser') { const user = users.get(String(peer.user_id)); return user && { _: 'inputPeerUser', user_id: peer.user_id, access_hash: user.access_hash }; }
          if (peer._ === 'peerChat') return { _: 'inputPeerChat', chat_id: peer.chat_id };
          const chat = chats.get(String(peer.channel_id)); return chat && { _: 'inputPeerChannel', channel_id: peer.channel_id, access_hash: chat.access_hash };
        };
        for (const dialog of response.dialogs) {
          const peer = dialog.peer; if (!peer || peer._ === 'peerUser') continue;
          const chat = chats.get(String(peer.chat_id || peer.channel_id));
          if (!chat || chat.pFlags?.left || chat.pFlags?.deactivated || chat._.includes('Forbidden')) continue;
          if (peer._ === 'peerChannel' && !chat.pFlags?.megagroup && !chat.megagroup) continue;
          const id = groupId(peer);
          bridge.peers.set(id, { inputPeer: inputOf(peer), peerId: -Number(peer.chat_id || peer.channel_id) });
          result.set(id, { id, name: String(chat.title || 'Grupo'), photo: '' });
        }
        const last = response.dialogs.filter(dialog => dialog.peer).at(-1);
        if (response.dialogs.length < 100 || !last) break;
        const input = inputOf(last.peer);
        const msg = (response.messages || []).find(msg => msg.id === last.top_message && JSON.stringify(msg.peer_id) === JSON.stringify(last.peer));
        if (!input || !msg || last.top_message === offsetId) break;
        offsetPeer = input; offsetId = last.top_message; offsetDate = msg.date;
      }
    }
    return [...result.values()];
  }
  if (action === 'media') {
    const media = bridge.media.get(args.key); if (!media) return null;
    const document = media.document, photo = media.photo;
    if (Number(document?.size || 0) > 14 * 1024 * 1024) return null;
    const thumb = photo?.sizes?.filter(size => size._ === 'photoSize' || size._ === 'photoSizeProgressive').sort((a, b) => b.w * b.h - a.w * a.h)[0];
    const blob = await m.apiFileManager.downloadMedia({ media: document || photo, ...(thumb ? { thumb } : {}) });
    if (!blob || blob.size > 14 * 1024 * 1024) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return { mimetype: document?.mime_type || 'image/jpeg', data: btoa(binary) };
  }
  const target = bridge.peers.get(args.id);
  if (!target?.inputPeer) throw new Error('Atualize os grupos ou aguarde uma nova mensagem deste contato.');
  if (!/^telegram:-\d+$/.test(args.id) && !args.id.startsWith(`${owner}:`)) throw new Error('Destino de outra conta ou plataforma.');
  const nextRandomId = () => {
    const bytes = crypto.getRandomValues(new Uint32Array(2));
    return ((BigInt(bytes[0] & 0x7fffffff) << 32n) | BigInt(bytes[1])).toString();
  };
  if (action === 'send') {
    const updates = await invoke('messages.sendMessage', { peer: target.inputPeer, message: args.text, random_id: nextRandomId(), no_webpage: true });
    if (!updates?._) throw new Error('O Telegram não confirmou o envio.');
    if (updates._ !== 'updateShortSentMessage') await m.apiUpdatesManager?.processUpdateMessage(updates);
    return { ok: true };
  }
  if (action === 'read') {
    if (!/^telegram:-\d+$/.test(args.id)) return { ok: true };
    if (target.inputPeer._ === 'inputPeerChannel') await invoke('channels.readHistory', { channel: { _: 'inputChannel', channel_id: target.inputPeer.channel_id, access_hash: target.inputPeer.access_hash }, max_id: args.messageId });
    else await invoke('messages.readHistory', { peer: target.inputPeer, max_id: args.messageId });
    return { ok: true };
  }
  if (action === 'typing') { await invoke('messages.setTyping', { peer: target.inputPeer, action: { _: 'sendMessageTypingAction' } }); return { ok: true }; }
  if (action === 'file') {
    const bytes = Uint8Array.from(atob(args.data), char => char.charCodeAt(0));
    const file = await m.apiFileManager.upload({ file: new File([bytes], args.name, { type: 'audio/mpeg' }), fileName: args.name });
    const updates = await invoke('messages.sendMedia', { peer: target.inputPeer, message: '', random_id: nextRandomId(),
      media: { _: 'inputMediaUploadedDocument', file, mime_type: 'audio/mpeg', attributes: [{ _: 'documentAttributeFilename', file_name: args.name }] } });
    if (!updates?._) throw new Error('O Telegram não confirmou o envio do áudio.');
    await m.apiUpdatesManager?.processUpdateMessage(updates);
    return { ok: true };
  }
  throw new Error('Operação Telegram Web inválida.');
}
module.exports = { telegramWebPage };
