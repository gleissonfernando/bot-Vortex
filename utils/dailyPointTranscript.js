const fs = require('fs');
const path = require('path');
const { buildAllPointsReportPayload } = require('./pontoReport');
const { resetGuildPoints, formatDate } = require('./pontoManager');
const { updateStatusPanel } = require('./pontoPanel');
const { logger } = require('./logger');
const { isPrimaryGuild, isPrimaryGuildChannel } = require('./guildScope');

const DAILY_POINT_CHANNEL_ID = '1498473417144533255';
const STATE_PATH = path.join(__dirname, '..', 'commands', 'dailyPointTranscriptState.json');
const TIME_ZONE = 'America/Sao_Paulo';

let interval = null;

function ensureStateFile() {
  if (!fs.existsSync(STATE_PATH)) {
    fs.writeFileSync(STATE_PATH, `${JSON.stringify({}, null, 2)}\n`, 'utf8');
  }
}

function readState() {
  ensureStateFile();
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function writeState(data) {
  ensureStateFile();
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function getSaoPauloParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parts.hour,
    minute: parts.minute,
  };
}

async function sendDailyPointTranscriptForGuild(client, guild) {
  if (!isPrimaryGuild(guild.id)) return false;
  const channel = await client.channels.fetch(DAILY_POINT_CHANNEL_ID).catch(() => null);
  if (!isPrimaryGuildChannel(channel)) return false;
  if (!channel?.isTextBased?.()) return false;

  const payload = await buildAllPointsReportPayload(guild, { includeAllMembers: true, suppressMentions: true });

  const content = [
    `📌 **Transcript diario de ponto**`,
    `Servidor: **${guild.name}**`,
    `Gerado em: **${formatDate(new Date())}**`,
    'Depois deste envio, o ciclo de ponto foi reiniciado automaticamente.',
  ].join('\n');

  await channel.send({
    content,
    embeds: payload.embeds || [],
    files: payload.files || [],
    allowedMentions: { parse: [] },
  });

  await resetGuildPoints(guild.id);
  await updateStatusPanel(client, guild.id).catch(() => null);
  return true;
}

async function runDailyPointTranscript(client, force = false) {
  const nowParts = getSaoPauloParts();
  if (!force && !(nowParts.hour === '00' && nowParts.minute === '00')) return [];

  const state = readState();
  const results = [];

  for (const guild of client.guilds.cache.values()) {
    if (!isPrimaryGuild(guild.id)) continue;
    const stateKey = `${guild.id}:${nowParts.dateKey}`;
    if (!force && state[stateKey]) continue;

    const sent = await sendDailyPointTranscriptForGuild(client, guild).catch((error) => {
      logger.error('Erro ao enviar transcript diario de ponto:', error);
      return false;
    });

    if (sent) {
      state[stateKey] = new Date().toISOString();
      results.push({ guildId: guild.id, sent: true });
    }
  }

  writeState(state);
  return results;
}

function initDailyPointTranscript(client) {
  if (interval) clearInterval(interval);
  interval = setInterval(() => {
    runDailyPointTranscript(client).catch((error) => logger.error('Erro no agendador diario de ponto:', error));
  }, 30 * 1000);
}

module.exports = {
  DAILY_POINT_CHANNEL_ID,
  initDailyPointTranscript,
  runDailyPointTranscript,
};
