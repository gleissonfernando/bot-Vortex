const fs = require('fs');
const path = require('path');
const { resetGuildPoints } = require('./pontoManager');
const { updateStatusPanel } = require('./pontoPanel');
const { logger } = require('./logger');
const { isPrimaryGuild } = require('./guildScope');
const { createDailyPointReportRecord } = require('./pointTranscriptStore');

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

function shiftDateKey(dateKey, offsetDays) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  const base = Date.UTC(year, month - 1, day);
  return new Date(base + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function sendDailyPointTranscriptForGuild(client, guild) {
  if (!isPrimaryGuild(guild.id)) return false;

  const nowParts = getSaoPauloParts();
  const reportDateKey = nowParts.hour === '00' ? shiftDateKey(nowParts.dateKey, -1) : nowParts.dateKey;
  const { record, url } = await createDailyPointReportRecord({
    guild,
    generatedBy: client.user,
    dateKey: reportDateKey,
    includeAllMembers: false,
    includeOnlyActive: true,
  });

  logger.info(`Relatorio diario de ponto gerado apenas no site: ${record.id} (${url})`);

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
