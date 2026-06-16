const { SlashCommandBuilder } = require('discord.js');
const { buildOrderPanelPayload, hasOrderManagerPermission } = require('../../utils/orderManager');
const { safeReply } = require('../../utils/safeReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('encomenda')
    .setDescription('Abre o painel de encomendas de municao.'),

  async execute(interaction) {
    if (!hasOrderManagerPermission(interaction.member)) {
      return safeReply(interaction, {
        content: 'Voce nao tem permissao para abrir o painel de encomendas.',
        ephemeral: true,
      });
    }

    return safeReply(interaction, buildOrderPanelPayload(interaction));
  },
};
