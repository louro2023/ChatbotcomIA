const DEFAULT_BULK_PAUSE_EVERY_MESSAGES = 50;
const DEFAULT_BULK_LONG_PAUSE_MINUTES = 15;
const MIN_BULK_PAUSE_EVERY_MESSAGES = 10;
const MAX_BULK_PAUSE_EVERY_MESSAGES = 500;
const MIN_BULK_LONG_PAUSE_MINUTES = 1;
const MAX_BULK_LONG_PAUSE_MINUTES = 120;

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function normalizeBulkLongPauseSettings(value = {}) {
  return {
    pauseEveryMessages: boundedInteger(value.pauseEveryMessages, DEFAULT_BULK_PAUSE_EVERY_MESSAGES, MIN_BULK_PAUSE_EVERY_MESSAGES, MAX_BULK_PAUSE_EVERY_MESSAGES),
    longPauseMinutes: boundedInteger(value.longPauseMinutes, DEFAULT_BULK_LONG_PAUSE_MINUTES, MIN_BULK_LONG_PAUSE_MINUTES, MAX_BULK_LONG_PAUSE_MINUTES)
  };
}

function shouldTakeBulkLongPause(sentSinceLongPause, hasNextContact, settings) {
  const normalized = normalizeBulkLongPauseSettings(settings);
  return hasNextContact === true && Number(sentSinceLongPause) >= normalized.pauseEveryMessages;
}

module.exports = {
  DEFAULT_BULK_LONG_PAUSE_MINUTES,
  DEFAULT_BULK_PAUSE_EVERY_MESSAGES,
  MAX_BULK_LONG_PAUSE_MINUTES,
  MAX_BULK_PAUSE_EVERY_MESSAGES,
  MIN_BULK_LONG_PAUSE_MINUTES,
  MIN_BULK_PAUSE_EVERY_MESSAGES,
  normalizeBulkLongPauseSettings,
  shouldTakeBulkLongPause
};
