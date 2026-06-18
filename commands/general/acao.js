const { SlashCommandBuilder } = require('discord.js');
const {
  buildActionAdminPanelPayload,
  hasActionManagerPermission,
} = require('../../utils/actionManager');
const { safeReply } = require('../../utils/safeReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('acao')
    .setDescription('Abre o Sistema de Ação Vortex.'),

  async execute(interaction) {
    if (!hasActionManagerPermission(interaction.member, interaction.user.id)) {
      return safeReply(interaction, {
        content: 'Voce nao tem permissao para abrir o Sistema de Ação Vortex.',
        ephemeral: true,
      });
    }

    return safeReply(interaction, await buildActionAdminPanelPayload(interaction));
  },
};
