const MAX_CONSECUTIVE_FAILURES = 5;
const FAILURE_RATE_WINDOW = 10;
const MAX_FAILURE_RATE = 0.5;

function errorText(error) {
  return [error?.message, error?.code, error?.status, error?.name]
    .filter(value => value !== undefined && value !== null)
    .join(' ')
    .trim();
}

function classifyBulkSendError(error) {
  const technicalError = errorText(error) || 'Falha desconhecida';
  const normalized = technicalError
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const status = Number(error?.status);

  if (
    status === 403
    || status === 429
    || /rate.?limit|too many requests|throttl|spam|temporar(?:ily|iamente)?.?block|account.{0,30}(?:ban|block|restrict)|conta.{0,30}(?:ban|bloque|restri)|not allowed to send|sending limit/.test(normalized)
  ) {
    return {
      kind: 'restriction',
      immediate: true,
      title: 'Possível limite ou restrição do WhatsApp',
      reason: 'O WhatsApp indicou excesso de solicitações, limitação ou possível restrição da conta. Continuar enviando poderia aumentar o risco de bloqueio.',
      technicalError
    };
  }

  if (
    status === 401
    || /not connected|disconnected|session closed|target closed|execution context was destroyed|protocol error|page has been closed|client is not ready|unauthori[sz]ed|logged out|logout/.test(normalized)
  ) {
    return {
      kind: 'connection',
      immediate: true,
      title: 'Conexão com o WhatsApp interrompida',
      reason: 'A sessão deixou de estar disponível durante a campanha. A automação foi parada para não acumular novas tentativas em uma conexão instável.',
      technicalError
    };
  }

  if (/numero invalido|not registered|nao registrado|invalid (?:number|wid|recipient)/.test(normalized)) {
    return {
      kind: 'recipient',
      immediate: false,
      title: 'Destinatário inválido',
      reason: 'O número não é válido ou não está registrado no WhatsApp.',
      technicalError
    };
  }

  return {
    kind: 'send-failure',
    immediate: false,
    title: 'Falha no envio',
    reason: 'O WhatsApp não concluiu o envio para este destinatário.',
    technicalError
  };
}

function evaluateBulkCircuitBreaker({ classification, consecutiveFailures, recentOutcomes }) {
  if (classification?.immediate) {
    return {
      type: classification.kind,
      title: classification.title,
      reason: classification.reason,
      technicalError: classification.technicalError
    };
  }

  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    return {
      type: 'consecutive-failures',
      title: 'Muitas falhas consecutivas',
      reason: `Ocorreram ${consecutiveFailures} falhas seguidas. Isso pode indicar lista inválida, conexão instável ou limitação da conta.`,
      technicalError: classification?.technicalError || ''
    };
  }

  const outcomes = (Array.isArray(recentOutcomes) ? recentOutcomes : []).slice(-FAILURE_RATE_WINDOW);
  if (outcomes.length >= FAILURE_RATE_WINDOW) {
    const failures = outcomes.filter(success => success !== true).length;
    const failureRate = failures / outcomes.length;
    if (failureRate >= MAX_FAILURE_RATE) {
      return {
        type: 'failure-rate',
        title: 'Taxa de falhas elevada',
        reason: `${failures} das últimas ${outcomes.length} tentativas falharam (${Math.round(failureRate * 100)}%). A campanha foi interrompida para proteger a conta.`,
        technicalError: classification?.technicalError || ''
      };
    }
  }

  return null;
}

module.exports = {
  FAILURE_RATE_WINDOW,
  MAX_CONSECUTIVE_FAILURES,
  MAX_FAILURE_RATE,
  classifyBulkSendError,
  evaluateBulkCircuitBreaker
};
