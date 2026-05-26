const { SlashCommandBuilder } = require('discord.js');
const { buildBauPanelPayload, hasBauManagerPermission, registerBauPanel } = require('../../utils/bauManager');
const { safeDeferReply, safeEdit, safeReply } = require('../../utils/safeReply');

async function publishBauPanel(interaction, chestKey) {
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

  const message = await interaction.channel.send(buildBauPanelPayload(interaction.guild.id, chestKey));
  registerBauPanel(interaction.guild.id, chestKey, interaction.channel.id, message.id);

  return safeEdit(interaction, {
    content: `Painel de bau ativado em ${message.url}`,
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bau')
    .setDescription('Cria o painel de bau em Components V2.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('membro')
        .setDescription('Ativa o painel do bau de membros.'))
    .addSubcommand((subcommand) =>
      subcommand
        .setName('membros')
        .setDescription('Ativa o painel do bau de membros.'))
    .addSubcommand((subcommand) =>
      subcommand
        .setName('gerencia')
        .setDescription('Ativa o painel do bau da gerencia.')),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand(false);
    const chestKey = subcommand === 'gerencia' ? 'gerencia' : 'membros';
    return publishBauPanel(interaction, chestKey);
  },
};
