const { SlashCommandBuilder } = require('discord.js');
const {
  finishActionById,
  hasActionManagerPermission,
  reportActionById,
  startActionById,
} = require('../../utils/actionManager');
const { safeReply } = require('../../utils/safeReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('acao')
    .setDescription('Gerencia o Sistema de Ação Vortex.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('iniciar')
        .setDescription('Inicia uma ação cadastrada no canal atual.')
        .addStringOption((option) =>
          option
            .setName('id')
            .setDescription('ID da ação. Se vazio, usa a ação aberta mais recente.')
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('finalizar')
        .setDescription('Finaliza uma ação e gera o relatório.')
        .addStringOption((option) =>
          option
            .setName('id')
            .setDescription('ID da ação. Se vazio, usa a ação aberta mais recente.')
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName('resultado')
            .setDescription('Resultado final da ação.')
            .setRequired(false)
            .addChoices(
              { name: 'Vitória', value: 'Vitoria' },
              { name: 'Derrota', value: 'Derrota' },
              { name: 'Cancelada', value: 'Cancelada' }
            )
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('relatorio')
        .setDescription('Gera o relatório final de uma ação.')
        .addStringOption((option) =>
          option
            .setName('id')
            .setDescription('ID da ação. Se vazio, usa a ação aberta mais recente.')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    if (!hasActionManagerPermission(interaction.member, interaction.user.id)) {
      return safeReply(interaction, {
        content: 'Voce nao tem permissao para gerenciar o Sistema de Ação Vortex.',
        ephemeral: true,
      });
    }

    const subcommand = interaction.options.getSubcommand();
    const actionId = interaction.options.getString('id') || '';

    if (subcommand === 'iniciar') {
      return startActionById(interaction, actionId);
    }

    if (subcommand === 'finalizar') {
      const resultado = interaction.options.getString('resultado') || '';
      return finishActionById(interaction, actionId, resultado);
    }

    if (subcommand === 'relatorio') {
      return reportActionById(interaction, actionId);
    }

    return safeReply(interaction, {
      content: 'Subcomando invalido.',
      ephemeral: true,
    });
  },
};
