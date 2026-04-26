const { Events } = require("discord.js");
const { logger } = require("../utils/logger");
const { deleteGuildConfig } = require("../utils/configManager");
const { sendStaffLog } = require("../utils/notifications");

module.exports = {
  name: Events.GuildDelete,
  async execute(guild) {
    try {
      logger.warn(`Bot foi removido do servidor: ${guild.name} (${guild.id})`);

      // 1. Deletar configurações do servidor do banco de dados
      await deleteGuildConfig(guild.id);
      logger.info(`Configurações do servidor ${guild.id} foram deletadas do banco de dados`);

      // 2. Log em tempo real no canal de logs principal
      const client = guild.client;
      await sendStaffLog(
        client,
        "📤 Bot Removido de Servidor",
        `O bot foi removido do servidor **${guild.name}** (\`${guild.id}\`).\nAs configurações locais foram limpas.`,
        "#ED4245"
      );

    } catch (error) {
      logger.error(`Erro ao processar remoção do bot do servidor ${guild.id}:`, error);
    }
  },
};
