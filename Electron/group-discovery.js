/** Executed inside WhatsApp Web; avoid serializing unrelated chats/messages. */
function readWhatsAppGroupSummaries() {
  const collections = window.require('WAWebCollections');
  const groups = new Map();
  const idOf = value => typeof value === 'string' ? value : value?._serialized || value?.toString?.() || '';
  for (const chat of collections.Chat.getModelsArray()) {
    const id = idOf(chat.id);
    if (!id.endsWith('@g.us')) continue;
    groups.set(id, { id, name: String(chat.name || chat.formattedTitle || chat.groupMetadata?.subject || id), photo: '' });
  }
  // Metadata may contain participating groups not yet materialized as chats.
  const metadataCollection = collections.GroupMetadata || collections.WAWebGroupMetadataCollection;
  for (const metadata of metadataCollection?.getModelsArray?.() || []) {
    const id = idOf(metadata.id);
    if (!id.endsWith('@g.us') || metadata.isParentGroup || metadata.isInGroup === false) continue;
    if (!groups.has(id)) groups.set(id, { id, name: String(metadata.subject || id), photo: '' });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
module.exports = { readWhatsAppGroupSummaries };
