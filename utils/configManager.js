const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');
const { FIXED_LOG_CHANNEL } = require('./notifications');
const { isSupabaseEnabled, supabaseRequest } = require('./supabaseClient');
const { formatLocalDate, formatTime } = require('./pontoManager');

const GUILD_CONFIGS_PATH = path.join(__dirname, '..', 'commands', 'guildConfigs.json');
const configCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function ensureGuildConfigsFile() {
  if (!fs.existsSync(GUILD_CONFIGS_PATH)) {
    fs.writeFileSync(GUILD_CONFIGS_PATH, `${JSON.stringify({}, null, 2)}\n`, 'utf8');
  }
}

function readGuildConfigs() {
  ensureGuildConfigsFile();
  try {
    return JSON.parse(fs.readFileSync(GUILD_CONFIGS_PATH, 'utf8') || '{}');
  } catch (error) {
    logger.error('Erro ao ler guildConfigs.json:', error);
    return {};
  }
}

function writeGuildConfigs(configs) {
  ensureGuildConfigsFile();
  fs.writeFileSync(GUILD_CONFIGS_PATH, `${JSON.stringify(configs, null, 2)}\n`, 'utf8');
}

function getDefaultConfig(guildId) {
  return {
    guildId,
    guildName: 'Servidor',
    botEnabled: true,
    maintenanceEnabled: false,
    language: 'pt-BR',
    prefix: '!',
    timezone: 'America/Sao_Paulo',
    logChannelId: FIXED_LOG_CHANNEL,
    welcomeChannelId: null,
    leaveChannelId: null,
    alertChannelId: null,
    verifyRoleId: null,
    welcomeMessage: '{user}, bem-vindo(a) ao servidor!',
    leaveMessage: '{user} saiu do servidor.',
    maintenanceMessage: 'O bot está em manutenção.',
  };
}

async function getGuildConfig(guildId) {
  try {
    const cached = configCache.get(guildId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      logger.debug(`Config do servidor ${guildId} carregada do cache`);
      return cached.data;
    }

    if (isSupabaseEnabled()) {
      const rows = await supabaseRequest('guild_configs', {
        query: {
          select: 'guild_id,data,updated_at',
          guild_id: `eq.${guildId}`,
          limit: 1,
        },
      });

      const remote = Array.isArray(rows) && rows[0] ? rows[0].data : {};
      const config = {
        ...getDefaultConfig(guildId),
        ...remote,
        guildId,
        logChannelId: FIXED_LOG_CHANNEL,
      };

      configCache.set(guildId, { data: config, timestamp: Date.now() });
      return config;
    }

    const configs = readGuildConfigs();
    const config = {
      ...getDefaultConfig(guildId),
      ...(configs[guildId] || {}),
      guildId,
      logChannelId: FIXED_LOG_CHANNEL,
    };

    configCache.set(guildId, { data: config, timestamp: Date.now() });
    return config;
  } catch (error) {
    logger.error(`Erro ao buscar config do servidor ${guildId}:`, error);
    return getDefaultConfig(guildId);
  }
}

async function updateGuildConfig(guildId, updates) {
  try {
    if (isSupabaseEnabled()) {
      const current = await getGuildConfig(guildId);
      const next = {
        ...current,
        ...updates,
        guildId,
        logChannelId: FIXED_LOG_CHANNEL,
        updatedAt: new Date().toISOString(),
      };

      await supabaseRequest('guild_configs', {
        method: 'POST',
        query: { on_conflict: 'guild_id' },
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: {
          guild_id: guildId,
          data: next,
          updated_at: next.updatedAt,
        },
      });

      configCache.delete(guildId);
      logger.info(`Config do servidor ${guildId} atualizada no Supabase`);
      return next;
    }

    const configs = readGuildConfigs();
    const current = {
      ...getDefaultConfig(guildId),
      ...(configs[guildId] || {}),
    };

    const next = {
      ...current,
      ...updates,
      guildId,
      logChannelId: FIXED_LOG_CHANNEL,
      updatedAt: new Date().toISOString(),
    };

    configs[guildId] = next;
    writeGuildConfigs(configs);
    configCache.delete(guildId);
    logger.info(`Config do servidor ${guildId} atualizada`);
    return next;
  } catch (error) {
    logger.error(`Erro ao atualizar config do servidor ${guildId}:`, error);
    throw error;
  }
}

async function deleteGuildConfig(guildId) {
  try {
    if (isSupabaseEnabled()) {
      await supabaseRequest('guild_configs', {
        method: 'DELETE',
        query: { guild_id: `eq.${guildId}` },
        headers: { Prefer: 'return=minimal' },
      });

      configCache.delete(guildId);
      logger.info(`Config do servidor ${guildId} deletada do Supabase`);
      return;
    }

    const configs = readGuildConfigs();
    delete configs[guildId];
    writeGuildConfigs(configs);
    configCache.delete(guildId);
    logger.info(`Config do servidor ${guildId} deletada`);
  } catch (error) {
    logger.error(`Erro ao deletar config do servidor ${guildId}:`, error);
    throw error;
  }
}

function clearGuildCache(guildId) {
  configCache.delete(guildId);
  logger.debug(`Cache do servidor ${guildId} limpo`);
}

function clearAllCache() {
  configCache.clear();
  logger.debug('Todo o cache de configuracoes foi limpo');
}

function processMessageVariables(message, user, guild) {
  if (!message) return '';

  return message
    .replace(/{user}/g, user?.toString() || 'Usuário')
    .replace(/{username}/g, user?.username || 'Usuário')
    .replace(/{server}/g, guild?.name || 'Servidor')
    .replace(/{serverId}/g, guild?.id || 'N/A')
    .replace(/{memberCount}/g, String(guild?.memberCount || 'N/A'))
    .replace(/{date}/g, formatLocalDate(new Date()))
    .replace(/{time}/g, formatTime(new Date()));
}

module.exports = {
  getGuildConfig,
  getDefaultConfig,
  updateGuildConfig,
  deleteGuildConfig,
  clearGuildCache,
  clearAllCache,
  processMessageVariables,
};
