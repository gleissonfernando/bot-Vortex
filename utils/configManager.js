const GuildConfig = require('../backend/models/GuildConfig');
const { logger } = require('./logger');

/**
 * Cache em memória para configurações (evita consultas repetidas ao DB)
 */
const configCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * Buscar configuração de um servidor (com cache)
 */
async function getGuildConfig(guildId) {
  try {
    // Verificar cache
    const cached = configCache.get(guildId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      logger.debug(`Config do servidor ${guildId} carregada do cache`);
      return cached.data;
    }

    // Buscar do banco de dados
    const config = await GuildConfig.findOne({ guildId });
    
    if (config) {
      // Salvar no cache
      configCache.set(guildId, {
        data: config,
        timestamp: Date.now()
      });
      logger.info(`Config do servidor ${guildId} carregada do banco`);
      return config;
    }

    // Retornar configuração padrão se não existir
    logger.warn(`Config não encontrada para ${guildId}, usando padrão`);
    return getDefaultConfig(guildId);

  } catch (error) {
    logger.error(`Erro ao buscar config do servidor ${guildId}:`, error);
    return getDefaultConfig(guildId);
  }
}

/**
 * Obter configuração padrão
 */
function getDefaultConfig(guildId) {
  return {
    guildId,
    guildName: 'Servidor',
    botEnabled: true,
    maintenanceEnabled: false,
    language: 'pt-BR',
    prefix: '!',
    timezone: 'America/Sao_Paulo',
    logChannelId: null,
    welcomeChannelId: null,
    leaveChannelId: null,
    alertChannelId: null,
    verifyRoleId: null,
    welcomeMessage: '{user}, bem-vindo(a) ao servidor!',
    leaveMessage: '{user} saiu do servidor.',
    maintenanceMessage: '⚠️ O bot está em manutenção.'
  };
}

/**
 * Salvar/atualizar configuração de um servidor
 */
async function updateGuildConfig(guildId, updates) {
  try {
    const config = await GuildConfig.findOneAndUpdate(
      { guildId },
      { $set: { ...updates, updatedAt: new Date() } },
      { upsert: true, new: true }
    );

    // Invalidar cache
    configCache.delete(guildId);
    logger.info(`Config do servidor ${guildId} atualizada`);
    
    return config;
  } catch (error) {
    logger.error(`Erro ao atualizar config do servidor ${guildId}:`, error);
    throw error;
  }
}

/**
 * Deletar configuração de um servidor
 */
async function deleteGuildConfig(guildId) {
  try {
    await GuildConfig.deleteOne({ guildId });
    configCache.delete(guildId);
    logger.info(`Config do servidor ${guildId} deletada`);
  } catch (error) {
    logger.error(`Erro ao deletar config do servidor ${guildId}:`, error);
    throw error;
  }
}

/**
 * Limpar cache de um servidor
 */
function clearGuildCache(guildId) {
  configCache.delete(guildId);
  logger.debug(`Cache do servidor ${guildId} limpo`);
}

/**
 * Limpar todo o cache
 */
function clearAllCache() {
  configCache.clear();
  logger.debug('Todo o cache de configurações foi limpo');
}

/**
 * Processar variáveis em mensagens
 */
function processMessageVariables(message, user, guild) {
  if (!message) return '';

  return message
    .replace(/{user}/g, user?.toString() || 'Usuário')
    .replace(/{username}/g, user?.username || 'Usuário')
    .replace(/{server}/g, guild?.name || 'Servidor')
    .replace(/{serverId}/g, guild?.id || 'N/A')
    .replace(/{memberCount}/g, guild?.memberCount || 'N/A')
    .replace(/{date}/g, new Date().toLocaleDateString('pt-BR'))
    .replace(/{time}/g, new Date().toLocaleTimeString('pt-BR'));
}

module.exports = {
  getGuildConfig,
  getDefaultConfig,
  updateGuildConfig,
  deleteGuildConfig,
  clearGuildCache,
  clearAllCache,
  processMessageVariables
};
