const { SlashCommandBuilder } = require('discord.js');
const { buildOrderAdminPanelPayload, hasOrderManagerPermission } = require('../../utils/orderManager');
const { safeReply } = require('../../utils/safeReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gerenciamento-encomenda')
    .setDescription('Abre o painel administrativo do Sistema de Encomendas Vortex.'),

  async execute(interaction) {
    if (!hasOrderManagerPermission(interaction.member)) {
      return safeReply(interaction, {
        content: 'Voce nao tem permissao para gerenciar encomendas.',
        ephemeral: true,
      });
    }

    return safeReply(interaction, await buildOrderAdminPanelPayload(interaction));
  },
};
