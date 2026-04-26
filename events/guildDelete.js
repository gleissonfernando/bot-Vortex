const { Events } = require("discord.js");
const { sendStaffLog } = require("../utils/notifications");

module.exports = {
  name: Events.GuildDelete,
  async execute(guild) {
    try {
      console.log(`[VORTEX] Bot foi removido do servidor: ${guild.name} (${guild.id})`);

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
