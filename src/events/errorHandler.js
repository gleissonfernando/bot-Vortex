const { logger } = require('../utils/logger');

function formatError(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack || null,
      name: error.name,
    };
  }
  return {
    message: String(error || 'Erro desconhecido'),
    stack: null,
    name: typeof error,
  };
}

function setupErrorHandlers(client, { notifyError = null, notifyBotDown = null } = {}) {
  let notifying = false;

  async function notify(error, context) {
    const details = formatError(error);
    logger.critical(`Erro global capturado: ${context}`, error instanceof Error ? error : null, {
      context,
      message: details.message,
      stack: details.stack,
      at: new Date().toISOString(),
    });

    if (notifying || !client) return;
    notifying = true;
    try {
      if (typeof notifyError === 'function') {
        await notifyError(client, error, context).catch(() => null);
      }
      if (typeof notifyBotDown === 'function') {
        await notifyBotDown(client, error, context).catch(() => null);
      }
    } finally {
      notifying = false;
    }
  }

  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    notify(error, 'Uncaught Exception').catch(() => null);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
    notify(reason, 'Unhandled Rejection').catch(() => null);
  });

  return { notify };
}

module.exports = { setupErrorHandlers };
