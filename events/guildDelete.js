const { Events } = require("discord.js");
const { logger } = require("../utils/logger");
const { deleteGuildConfig } = require("../utils/configManager");
const { sendStaffLog } = require("../utils/notifications");

module.exports = {
  name: Events.GuildDelete,
  async execute(guild) {
    try {
      logger.warn(`Bot foi removido do servidor: ${guild.name} (${guild.id})`);
      await deleteGuildConfig(guild.id).catch((error) => {
        logger.error(`Erro ao limpar configuracoes do servidor ${guild.id}:`, error);
      });

      // Log em tempo real no canal de logs principal
      const client = guild.client;
      await sendStaffLog(
        client,
        "📤 Bot Removido de Servidor",
        `O bot foi removido do servidor **${guild.name}** (\`${guild.id}\`).`,
        "#ED4245"
      );

    } catch (error) {
      console.error(`[VORTEX] Erro ao processar remoção do bot do servidor ${guild.id}:`, error.message);
    }
  },
};
