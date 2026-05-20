const { logger } = require('./logger');

const SECRET_KEY_PATTERN = /password|passwd|pwd|token|secret|authorization|apikey|api_key|service_role|mongodb_uri|mongo_uri|database_url/i;

function redactString(value) {
  return String(value)
    .replace(/(mongodb(?:\+srv)?:\/\/[^:]+:)([^@]+)(@)/gi, '$1[REDACTED]$3')
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]');
}

function sanitizeValue(value, seen = new WeakSet()) {
  if (value === undefined) return '[undefined]';

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      code: value.code || value.reason?.code || null,
      details: value.details || null,
      hint: value.hint || null,
    };
  }

  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return `[Function${value.name ? `: ${value.name}` : ''}]`;
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    sanitized[key] = SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : sanitizeValue(item, seen);
  }

  return sanitized;
}

function stringifyValue(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';

  try {
    const sanitized = sanitizeValue(value);
    const text = typeof sanitized === 'string'
      ? sanitized
      : JSON.stringify(sanitized, null, 2);

    return text.length > 8000 ? `${text.slice(0, 8000)}... [truncated]` : text;
  } catch (error) {
    return `[unserializable payload: ${error.message}]`;
  }
}

function getErrorMessage(error) {
  if (!error) return 'Erro desconhecido';
  return error.message || String(error);
}

function getErrorStack(error) {
  return error?.stack || 'Stack indisponivel';
}

function formatDatabaseError({
  event = 'database',
  error,
  payload = null,
  query = null,
  params = null,
} = {}) {
  return [
    '[DATABASE ERROR]',
    `Evento: ${event}`,
    `Mensagem: ${getErrorMessage(error)}`,
    `Stack: ${getErrorStack(error)}`,
    `Payload recebido: ${stringifyValue(payload)}`,
    `Query: ${stringifyValue(query ?? error?.query ?? null)}`,
    `Params: ${stringifyValue(params ?? error?.params ?? null)}`,
  ].join('\n');
}

function logDatabaseError(context = {}) {
  const formatted = formatDatabaseError(context);
  logger.error(formatted, context.error instanceof Error ? context.error : null);
  return formatted;
}

module.exports = {
  formatDatabaseError,
  logDatabaseError,
  sanitizeValue,
  stringifyValue,
};
