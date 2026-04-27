const path = require('path');
const { AttachmentBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const DEFAULT_UPDATE_LOG_CHANNEL_ID = '14977767502333912041';
const DEFAULT_UPDATE_NOTIFY_ROLE_ID = '1201235607549124639';
const VORTEX_BANNER_PATH = path.join(__dirname, '..', '..', 'foto', 'IMG_4234.png');
const VORTEX_BANNER_NAME = 'IMG_4234.png';
const UPDATE_SUMMARY_PATH = path.join(__dirname, '..', '..', 'logs', 'vortex-update-summary.txt');

let sentThisBoot = false;

function getEnvLabel() {
  return process.env.BOT_ENV || 'production';
}

function getVersion() {
  return process.env.BOT_VERSION || '1.0.0';
}

async function notifyBotUpdate(client) {
  if (sentThisBoot) return false;
  sentThisBoot = true;

  const channelId = process.env.UPDATE_LOG_CHANNEL_ID || DEFAULT_UPDATE_LOG_CHANNEL_ID;
  const roleId = process.env.UPDATE_NOTIFY_ROLE_ID || DEFAULT_UPDATE_NOTIFY_ROLE_ID;

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) {
      console.error(`[VORTEX] Canal de atualização não encontrado ou inválido: ${channelId}`);
      return false;
    }

    const botMember = channel.guild?.members?.me || await channel.guild?.members.fetchMe?.().catch(() => null);
    if (botMember) {
      const permissions = channel.permissionsFor(botMember);
      if (
        !permissions?.has(PermissionFlagsBits.ViewChannel) ||
        !permissions?.has(PermissionFlagsBits.SendMessages) ||
        !permissions?.has(PermissionFlagsBits.AttachFiles)
      ) {
        console.error(`[VORTEX] Sem permissão para enviar mensagem/anexos no canal de atualização: ${channelId}`);
        return false;
      }
    }

    const now = new Date();
    const embed = new EmbedBuilder()
      .setColor('#57F287')
      .setAuthor({
        name: 'VORTEX | Sistema Atualizado',
        iconURL: client.user.displayAvatarURL(),
      })
      .setTitle('Bot Atualizado')
      .setDescription([
        'O bot foi iniciado com sucesso após uma atualização.',
        '',
        '**Status:** Online',
        `**Bot:** ${client.user.tag}`,
        `**Ambiente:** ${getEnvLabel()}`,
        `**Versão:** ${getVersion()}`,
        `**Data/Hora:** ${now.toLocaleString('pt-BR')}`,
        '',
        '✅ Todos os sistemas foram carregados corretamente.',
      ].join('\n'))
      .setImage(`attachment://${VORTEX_BANNER_NAME}`)
      .setFooter({ text: 'Vortex Management System - Update Notifier' })
      .setTimestamp(now);

    const files = [
      new AttachmentBuilder(VORTEX_BANNER_PATH, { name: VORTEX_BANNER_NAME }),
      new AttachmentBuilder(UPDATE_SUMMARY_PATH, { name: 'vortex-update-summary.txt' }),
    ];

    await channel.send({
      content: `<@&${roleId}>`,
      embeds: [embed],
      files,
      allowedMentions: { roles: [roleId] },
    });

    console.log(`[VORTEX] Notificação de atualização enviada no canal ${channelId}`);
    return true;
  } catch (error) {
    console.error('[VORTEX] Falha ao enviar notificação de atualização:', error);
    return false;
  }
}

module.exports = {
  notifyBotUpdate,
};
