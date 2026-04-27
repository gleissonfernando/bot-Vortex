const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ausencia')
    .setDescription('Abre o formulario para solicitar ausencia.'),

  async execute(interaction) {
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
          .setPlaceholder('Dias: 30/04/2026 ou 3 | Horas: 12h')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );

    return interaction.showModal(modal);
  },
};
