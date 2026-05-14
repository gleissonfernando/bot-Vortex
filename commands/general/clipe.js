const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require('discord.js');
const path = require('path');
const { sendVortexLog } = require('../../utils/notifications');
const { safeReply, safeDeferReply, safeEdit } = require('../../utils/safeReply');

const VORTEX_BANNER = path.join(__dirname, '..', '..', 'foto', 'IMG_4234.png');
const VORTEX_BANNER_NAME = 'IMG_4234.png';

function safeFileName(name, fallbackExt = '.mp4') {
  const clean = String(name || '').split('?')[0].split('#')[0].trim();
  const base = path.basename(clean || `clipe${fallbackExt}`);
  if (path.extname(base)) return base;
  return `${base}${fallbackExt}`;
}

function isDirectMediaUrl(value) {
  return /^https?:\/\/.+\.(mp4|webm|mov|m4v|gif)(\?.*)?$/i.test(value)
    || /^https?:\/\/cdn\.discordapp\.com\/attachments\//i.test(value)
    || /^https?:\/\/media\.discordapp\.net\//i.test(value);
}

function parseDiscordMessageLink(value) {
  const match = String(value).match(
    /^https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)$/i
  );
  if (!match) return null;

  return {
    guildId: match[1],
    channelId: match[2],
    messageId: match[3],
  };
}

async function fetchBinary(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Falha ao baixar a mídia (${response.status}).`);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const body = Buffer.from(await response.arrayBuffer());
  return { body, contentType, response };
}

function pickMediaUrlFromMessage(message) {
  const attachment = message.attachments.find((item) => {
    const name = item.name || '';
    const type = item.contentType || '';
    return type.startsWith('video/')
      || type === 'image/gif'
      || /\.(mp4|webm|mov|m4v|gif)(\?.*)?$/i.test(name);
  });

  if (attachment?.url) {
    return attachment.url;
  }

  const embedMedia = message.embeds
    .map((embed) => embed.video?.url || embed.image?.url || embed.thumbnail?.url)
    .find(Boolean);

  return embedMedia || null;
}

async function resolveClipSource(interaction, rawLink) {
  const link = String(rawLink || '').trim();
  if (!link) {
    throw new Error('Informe um link para o clipe.');
  }

  let sourceUrl = link;
  const parsedMessage = parseDiscordMessageLink(link);

  if (parsedMessage) {
    if (parsedMessage.guildId !== interaction.guildId) {
      throw new Error('O link da mensagem precisa ser deste mesmo servidor.');
    }

    const channel = await interaction.guild.channels.fetch(parsedMessage.channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) {
      throw new Error('Nao consegui acessar o canal da mensagem informada.');
    }

    const message = await channel.messages.fetch(parsedMessage.messageId).catch(() => null);
    if (!message) {
      throw new Error('Nao encontrei a mensagem informada.');
    }

    sourceUrl = pickMediaUrlFromMessage(message);
    if (!sourceUrl) {
      throw new Error('A mensagem informada não tem uma mídia de vídeo ou GIF anexada.');
    }
  }

  const downloaded = await fetchBinary(sourceUrl);
  const extMatch = sourceUrl.match(/\.(mp4|webm|mov|m4v|gif)(\?.*)?$/i);
  const contentType = downloaded.contentType;
  const isAllowedContentType = contentType.startsWith('video/')
    || contentType === 'image/gif';

  if (!isAllowedContentType && !extMatch && !isDirectMediaUrl(sourceUrl)) {
    throw new Error('O link informado não aponta para uma mídia de vídeo válida.');
  }

  const fallbackExt = contentType.includes('webm')
    ? '.webm'
    : contentType.includes('mov')
      ? '.mov'
      : contentType.includes('gif')
        ? '.gif'
        : '.mp4';

  return {
    buffer: downloaded.body,
    fileName: safeFileName(sourceUrl, fallbackExt),
    sourceUrl,
    contentType,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clipe')
    .setDescription('Baixa uma mídia de vídeo de um link e envia como clipe.')
    .addStringOption((option) =>
      option
        .setName('link')
        .setDescription('Link direto ou link de mensagem do Discord com video/GIF.')
        .setRequired(true)
        .setMaxLength(500)
    )
    .addStringOption((option) =>
      option
        .setName('legenda')
        .setDescription('Legenda opcional para acompanhar o clipe.')
        .setRequired(false)
        .setMaxLength(500)
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return safeReply(interaction, { content: '❌ Este comando so pode ser usado em servidor.', ephemeral: true });
    }

    const link = interaction.options.getString('link', true);
    const caption = interaction.options.getString('legenda', false)?.trim();

    await safeDeferReply(interaction, { ephemeral: true });

    let clip;
    try {
      clip = await resolveClipSource(interaction, link);
    } catch (error) {
      return safeEdit(interaction, {
        content: `❌ ${error.message || 'Nao consegui processar o link informado.'}`,
      });
    }

    const embed = new EmbedBuilder()
      .setColor('#7000FF')
      .setAuthor({
        name: 'VORTEX | Clipe',
        iconURL: interaction.client.user.displayAvatarURL(),
      })
      .setTitle('Clipe enviado')
      .setDescription([
        caption ? `**Legenda:** ${caption}` : null,
        `**Origem:** ${clip.sourceUrl}`,
        `**Enviado por:** <@${interaction.user.id}>`,
      ].filter(Boolean).join('\n'))
      .setThumbnail(`attachment://${VORTEX_BANNER_NAME}`)
      .setFooter({ text: 'Vortex Management System' })
      .setTimestamp();

    try {
      const attachment = new AttachmentBuilder(clip.buffer, { name: clip.fileName });
      const banner = new AttachmentBuilder(VORTEX_BANNER, { name: VORTEX_BANNER_NAME });

      const replyPayload = {
        embeds: [embed],
        files: [attachment, banner],
      };

      if (caption) {
        replyPayload.content = caption;
      }

      await safeEdit(interaction, replyPayload);

      sendVortexLog(interaction.client, {
        title: 'Clipe Enviado',
        description: [
          `**Usuário:** <@${interaction.user.id}> (${interaction.user.id})`,
          `**Canal:** <#${interaction.channel.id}> (${interaction.channel.id})`,
          `**Origem:** ${clip.sourceUrl}`,
          `**Arquivo:** ${clip.fileName}`,
          caption ? `**Legenda:** ${caption}` : null,
        ].filter(Boolean).join('\n'),
        color: '#7000FF',
        type: 'MIDIA',
        userId: interaction.user.id,
        channelId: interaction.channelId,
      }).catch(() => {});
    } catch (error) {
      console.error('[VORTEX] Erro ao enviar clipe:', error);
      return safeEdit(interaction, {
        content: '❌ Baixei o link, mas não consegui enviar como vídeo. Verifique o tamanho do arquivo ou a permissão de anexar arquivos.',
      });
    }

    return null;
  },
};
