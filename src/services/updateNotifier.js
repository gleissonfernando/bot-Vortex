const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { formatDate } = require('../../utils/pontoManager');

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

  const channelId = process.env.UPDATE_LOG_CHANNEL_ID || DEFAULT_UPDATE_LOG_CHANNEL_ID;
  const roleId = process.env.UPDATE_NOTIFY_ROLE_ID || DEFAULT_UPDATE_NOTIFY_ROLE_ID;

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) {
      console.error(`[VORTEX] Canal de atualização não encontrado ou inválido: ${channelId}`);
      return false;
    }

    const botMember = channel.guild?.members?.me || await channel.guild?.members.fetchMe?.().catch(() => null);
    let canAttachFiles = true;
    if (botMember) {
      const permissions = channel.permissionsFor(botMember);
      if (
        !permissions?.has(PermissionFlagsBits.ViewChannel) ||
        !permissions?.has(PermissionFlagsBits.SendMessages)
      ) {
        console.error(`[VORTEX] Sem permissão para enviar mensagem no canal de atualização: ${channelId}`);
        return false;
      }
      canAttachFiles = permissions.has(PermissionFlagsBits.AttachFiles);
      if (!canAttachFiles) {
        console.error(`[VORTEX] Sem permissão de anexar arquivos no canal ${channelId}. Enviando notificação sem banner/TXT.`);
      }
    }

    const now = new Date();
    const hasBanner = fs.existsSync(VORTEX_BANNER_PATH);
    const hasSummary = fs.existsSync(UPDATE_SUMMARY_PATH);
    const embed = new EmbedBuilder()
      .setColor('#57F287')
      .setAuthor({
        name: 'Sistema Vortex | Atualização',
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
        `**Data/Hora real:** ${formatDate(now)}`,
        '',
        '✅ Todos os sistemas foram carregados corretamente.',
      ].join('\n'))
      .setFooter({ text: 'Vortex Management System - Update Notifier' })
      .setTimestamp(now);

    const files = [];
    if (canAttachFiles && hasBanner) {
      embed.setImage(`attachment://${VORTEX_BANNER_NAME}`);
      files.push(new AttachmentBuilder(VORTEX_BANNER_PATH, { name: VORTEX_BANNER_NAME }));
    } else if (!hasBanner) {
      console.error(`[VORTEX] Banner não encontrado em: ${VORTEX_BANNER_PATH}`);
    }

    if (canAttachFiles && hasSummary) {
      files.push(new AttachmentBuilder(UPDATE_SUMMARY_PATH, { name: 'vortex-update-summary.txt' }));
    } else if (!hasSummary) {
      console.error(`[VORTEX] TXT de resumo não encontrado em: ${UPDATE_SUMMARY_PATH}`);
    }

    await channel.send({
      content: `<@&${roleId}>`,
      embeds: [embed],
      files: files.length ? files : undefined,
      allowedMentions: { roles: [roleId] },
    });

    sentThisBoot = true;
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
