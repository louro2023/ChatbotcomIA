function recordGroupActivity(previous = {}, event, timestamp = new Date().toISOString()) {
  return {
    ...previous,
    received: (previous.received || 0) + (['own-message', 'no-match', 'matched'].includes(event.decision) ? 1 : 0),
    sent: (previous.sent || 0) + (event.decision === 'sent' ? 1 : 0),
    failed: (previous.failed || 0) + (event.decision === 'send-error' ? 1 : 0),
    lastDecision: event.decision, lastSource: event.source, lastActivityAt: timestamp,
    error: event.error || '',
    activity: [{ timestamp, decision: event.decision, command: event.command || '', error: event.error || '' }, ...(previous.activity || [])].slice(0, 100)
  };
}
module.exports = { recordGroupActivity };
