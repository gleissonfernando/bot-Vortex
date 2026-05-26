const { SlashCommandBuilder } = require('discord.js');
const { buildBauPanelPayload, hasBauManagerPermission, registerBauPanel } = require('../../utils/bauManager');
const { safeDeferReply, safeEdit, safeReply } = require('../../utils/safeReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bau-membros')
    .setDescription('Cria o painel de bau em Components V2.')
    .addStringOption((option) =>
      option
        .setName('tipo')
        .setDescription('Qual bau deseja publicar')
        .setRequired(false)
        .addChoices(
          { name: 'Bau membros', value: 'membros' },
          { name: 'Bau gerencia', value: 'gerencia' },
        )),

  async execute(interaction) {
    if (!hasBauManagerPermission(interaction.member)) {
      return safeReply(interaction, {
        content: 'Voce nao tem permissao para ativar o painel de bau.',
        ephemeral: true,
      });
    }

    if (!interaction.channel?.isTextBased?.()) {
      return safeReply(interaction, {
        content: 'Use este comando em um canal de texto.',
        ephemeral: true,
      });
    }

    await safeDeferReply(interaction, { ephemeral: true });

    const chestKey = interaction.options.getString('tipo') || 'membros';
    const message = await interaction.channel.send(buildBauPanelPayload(interaction.guild.id, chestKey));
    registerBauPanel(interaction.guild.id, chestKey, interaction.channel.id, message.id);

    return safeEdit(interaction, {
      content: `Painel de bau ativado em ${message.url}`,
    });
  },
};
