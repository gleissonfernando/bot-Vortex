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
const { safeReply } = require('../../utils/safeReply');
const { buildThemedPanelPayload } = require('../../utils/panelTheme');

function buildAbsenceModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('modal_ausencia_request')
    .setTitle('Vortex | Solicitar Ausência');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Motivo da ausência')
        .setPlaceholder('Explique o motivo de forma clara para a administração avaliar.')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(900)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('start_date')
        .setLabel('Dia que começa a ausência')
        .setPlaceholder('Exemplo: 12/01 ou 12/01/2026')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('return_date')
        .setLabel('Dia que retorna')
        .setPlaceholder('Exemplo: 15/01 ou 15/01/2026')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    )
  );

  return modal;
}

function buildAbsencePanel(interaction = null) {
  const iconURL = interaction?.guild?.iconURL?.({ dynamic: true, size: 256 })
    || interaction?.client?.user?.displayAvatarURL?.()
    || null;

  const embed = new EmbedBuilder()
    .setColor('#7000FF')
    .setAuthor({ name: 'VORTEX • Controle de Ausência', iconURL: iconURL || undefined })
    .setTitle('🌪️ Painel de Ausência')
    .setDescription([
      '**Solicite sua ausência ou retire uma ausência ativa.**',
      '',
      'A administração vai analisar sua solicitação antes de aprovar.',
    ].join('\n'))
    .addFields(
      {
        name: '📝 Solicitar ausência',
        value: [
          'Preencha o formulário com motivo, início e retorno.',
          'Seu nome e Discord ID serão detectados automaticamente.',
        ].join('\n'),
        inline: false,
      },
      {
        name: '📅 Formato da data',
        value: [
          'Use `12/01` ou `12/01/2026`.',
          'Não informe horário.',
        ].join('\n'),
        inline: false,
      },
      {
        name: '↩️ Retirar ausência',
        value: [
          'Se voltou antes do prazo, use o botão abaixo para remover sua ausência.',
        ].join('\n'),
        inline: false,
      }
    )
    .setFooter({ text: 'Vortex • Sistema de Ausência' })
    .setTimestamp();

  if (iconURL) embed.setThumbnail(iconURL);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ausencia_request')
      .setLabel('Solicitar ausência')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('ausencia_remove')
      .setLabel('Retirar minha ausência')
      .setEmoji('↩️')
      .setStyle(ButtonStyle.Secondary)
  );

  return buildThemedPanelPayload('ausencia', embed, { components: [row] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ausencia')
    .setDescription('Abre o painel para solicitar ou retirar ausência.'),

  async execute(interaction) {
    return safeReply(interaction, buildAbsencePanel(interaction));
  },

  buildAbsenceModal,
};
