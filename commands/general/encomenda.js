const { SlashCommandBuilder } = require('discord.js');
const { buildOrderPanelPayload, hasOrderUserPermission } = require('../../utils/orderManager');
const { safeReply } = require('../../utils/safeReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('encomenda')
    .setDescription('Abre o Sistema de Encomendas V2.'),

  async execute(interaction) {
    if (!hasOrderUserPermission(interaction.member)) {
      return safeReply(interaction, {
        content: 'Voce nao tem permissao para abrir o painel de encomendas.',
        ephemeral: true,
      });
    }

    return safeReply(interaction, buildOrderPanelPayload(interaction));
  },
};
