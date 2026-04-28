const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

function buildAbsenceModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('modal_ausencia_request')
    .setTitle('Vortex | Solicitar Ausencia');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('name')
        .setLabel('NOME')
        .setPlaceholder('Seu nome')
        .setValue(interaction.member?.displayName || interaction.user.username)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('discord_id')
        .setLabel('ID DO DISCORD')
        .setPlaceholder('Seu ID do Discord')
        .setValue(interaction.user.id)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('MOTIVO')
        .setPlaceholder('Explique o motivo da ausencia')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(900)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('period')
        .setLabel('PERIODO')
        .setPlaceholder('Horas: 12:00 ou 12h | Data: 12/01 ou 12/01/2026')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    )
  );

  return modal;
}

function buildAbsencePanel() {
  const embed = new EmbedBuilder()
    .setColor('#7000FF')
    .setAuthor({ name: 'VORTEX | Sistema de Ausencia' })
    .setTitle('Painel de Ausencia')
    .setDescription([
      'Escolha uma acao abaixo.',
      '',
      '**Periodo aceito na solicitacao**',
      '`12:00` para 12 horas.',
      '`12h` para 12 horas.',
      '`12/01` para dia e mes.',
      '`12/01/2026` para data completa.',
    ].join('\n'))
    .setFooter({ text: 'Vortex - Sistema de Ausencia' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ausencia_request')
      .setLabel('Solicitar ausencia')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('ausencia_remove')
      .setLabel('Retirar ausencia')
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row], ephemeral: true };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ausencia')
    .setDescription('Abre o painel para solicitar ou retirar ausencia.'),

  async execute(interaction) {
    return interaction.reply(buildAbsencePanel());
  },

  buildAbsenceModal,
};
