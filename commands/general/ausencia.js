const {
  SlashCommandBuilder,
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const VORTEX_PANEL_IMAGE = path.join(__dirname, '..', '..', 'foto', 'IMG_4234.png');
const VORTEX_PANEL_IMAGE_NAME = 'IMG_4234.png';

function buildAbsenceModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('modal_ausencia_request')
    .setTitle('Vortex | Solicitar Ausência');

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
        .setPlaceholder('Explique o motivo da ausência')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(900)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('start_date')
        .setLabel('DIA QUE VAI PARA AUSENCIA')
        .setPlaceholder('Exemplo: 12/01 ou 12/01/2026')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('return_date')
        .setLabel('DIA QUE VOLTA')
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
    .setAuthor({ name: '🌪️ VORTEX • Sistema de Ausência', iconURL: iconURL || undefined })
    .setTitle('Painel de Ausência')
    .setDescription([
      'Use este painel para solicitar afastamento temporário ou retirar uma ausência ativa.',
      '',
      'Ao solicitar, o sistema registra o motivo, o dia de início e o dia de retorno, depois abre um canal para a administração aprovar ou recusar.',
    ].join('\n'))
    .addFields(
      {
        name: 'Como solicitar',
        value: [
          '`1.` Clique em **Solicitar ausência**.',
          '`2.` Informe nome, ID, motivo, dia que vai para ausência e dia que volta.',
          '`3.` Aguarde a aprovação da administração para receber o cargo de ausência.',
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Datas aceitas',
        value: [
          '`12/01` para dia e mês',
          '`12/01/2026` para data completa',
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Retorno',
        value: [
          'A ausência vale do início do dia informado até o fim do dia de retorno.',
          'Não existe mais ausência por hora.',
          'Use **Retirar ausência** quando voltar antes do prazo.',
          'A gerência pode alterar o retorno pelo `/painel`.',
        ].join('\n'),
        inline: true,
      }
    )
    .setFooter({ text: 'Vortex • Sistema de Ausência' })
    .setTimestamp();

  if (iconURL) embed.setThumbnail(iconURL);

  const files = [];
  if (fs.existsSync(VORTEX_PANEL_IMAGE)) {
    embed.setImage(`attachment://${VORTEX_PANEL_IMAGE_NAME}`);
    files.push(new AttachmentBuilder(VORTEX_PANEL_IMAGE, { name: VORTEX_PANEL_IMAGE_NAME }));
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ausencia_request')
      .setLabel('Solicitar ausência')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('ausencia_remove')
      .setLabel('Retirar ausência')
      .setEmoji('↩️')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row], files };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ausencia')
    .setDescription('Abre o painel para solicitar ou retirar ausência.'),

  async execute(interaction) {
    return interaction.reply(buildAbsencePanel(interaction));
  },

  buildAbsenceModal,
};
