const { createPointTranscriptRecord } = require('./pointTranscriptStore');
const {
  formatDate,
  formatDuration,
  formatLocalDate,
} = require('./pontoManager');
const { logger } = require('./logger');

function getLatestSession(data = {}) {
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  return sessions.length ? sessions[sessions.length - 1] : null;
}

function getActionSnapshot(action, result = {}) {
  const data = result.data || {};
  const latestSession = getLatestSession(data);
  const opened = action === 'opened';
  const startedAt = opened
    ? data.activePointStartedAt || data.lastPointOpenAt || latestSession?.startedAt || null
    : latestSession?.startedAt || data.lastPointOpenAt || null;
  const closedAt = opened ? null : latestSession?.closedAt || data.lastPointCloseAt || null;
  const durationMs = opened
    ? (startedAt ? Math.max(0, Date.now() - new Date(startedAt).getTime()) : 0)
    : Number(result.durationMs || latestSession?.durationMs || 0);

  return {
    startedAt,
    closedAt,
    durationMs,
    dateAt: closedAt || startedAt || new Date(),
    status: opened ? 'Aberto' : 'Fechado',
  };
}

function buildPointActionSummaryContent({ target, action, result, transcriptUrl }) {
  const data = result?.data || {};
  const userId = String(target?.id || data.userId || '');
  const snapshot = getActionSnapshot(action, result);

  return [
    '📊 **VORTEX | RELATÓRIO DE PONTO**',
    '',
    `👤 Usuário: ${userId ? `<@${userId}>` : (data.userName || 'N/A')}`,
    `🆔 ID: ${userId ? `\`${userId}\`` : '`N/A`'}`,
    `📅 Data: **${formatLocalDate(snapshot.dateAt)}**`,
    `⏰ Entrada: **${formatDate(snapshot.startedAt)}**`,
    `⏰ Saída: **${snapshot.closedAt ? formatDate(snapshot.closedAt) : 'Em andamento'}**`,
    `⌛ Tempo total: **${formatDuration(snapshot.durationMs)}**`,
    `📈 Status: **${snapshot.status}**`,
    '',
    '🔗 Transcript:',
    transcriptUrl || 'Indisponível no momento.',
  ].join('\n');
}

async function createPointActionTranscriptSummary({ guild, target, generatedBy, action, result }) {
  let transcript = null;
  let transcriptUrl = null;

  try {
    transcript = await createPointTranscriptRecord({
      guild,
      target,
      generatedBy: generatedBy || target,
    });
    transcriptUrl = transcript.url;
  } catch (error) {
    logger.error('Erro ao gerar transcript automatico de ponto:', error, {
      guildId: guild?.id || null,
      userId: target?.id || result?.data?.userId || null,
      action,
    });
  }

  return {
    transcript,
    transcriptUrl,
    content: buildPointActionSummaryContent({
      target,
      action,
      result,
      transcriptUrl,
    }),
  };
}

module.exports = {
  buildPointActionSummaryContent,
  createPointActionTranscriptSummary,
};
