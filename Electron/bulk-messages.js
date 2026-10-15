const MAX_BULK_MESSAGE_VARIATIONS = 5;

function normalizeBulkMessageVariations(values, legacyMessage = '') {
  const variations = (Array.isArray(values) ? values : [])
    .slice(0, MAX_BULK_MESSAGE_VARIATIONS)
    .map(value => String(value || '').trim())
    .filter(Boolean);
  const fallback = String(legacyMessage || '').trim();
  if (!variations.length && fallback) variations.push(fallback);
  return variations;
}

function selectBulkMessageVariation(variations, contactIndex) {
  if (!Array.isArray(variations) || !variations.length) return '';
  const index = Math.max(0, Math.floor(Number(contactIndex) || 0));
  return variations[index % variations.length];
}

module.exports = {
  MAX_BULK_MESSAGE_VARIATIONS,
  normalizeBulkMessageVariations,
  selectBulkMessageVariation
};
