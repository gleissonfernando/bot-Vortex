const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { buildThemedPanelPayload } = require('./panelTheme');

const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function ensureMirrorMessageConfig(config = loadConfig()) {
  if (!Array.isArray(config.MIRROR_MESSAGE_CHANNEL_IDS)) {
    config.MIRROR_MESSAGE_CHANNEL_IDS = [];
  }
  config.MIRROR_MESSAGE_CHANNEL_IDS = [...new Set(
    config.MIRROR_MESSAGE_CHANNEL_IDS
      .filter(Boolean)
      .map(String)
  )];
  return config.MIRROR_MESSAGE_CHANNEL_IDS;
}

function getMirrorMessageChannelIds(config = loadConfig()) {
  return ensureMirrorMessageConfig(config);
}

function isMirrorMessageChannel(channelId, config = loadConfig()) {
  return getMirrorMessageChannelIds(config).includes(String(channelId));
}

function setMirrorMessageChannelEnabled(channelId, enabled) {
  const config = loadConfig();
  const ids = new Set(ensureMirrorMessageConfig(config));
  const id = String(channelId);
  if (enabled) ids.add(id);
  else ids.delete(id);
  config.MIRROR_MESSAGE_CHANNEL_IDS = [...ids];
  saveConfig(config);
  return config.MIRROR_MESSAGE_CHANNEL_IDS;
}

function toggleMirrorMessageChannel(channelId) {
  const enabled = !isMirrorMessageChannel(channelId);
  const channelIds = setMirrorMessageChannelEnabled(channelId, enabled);
  return { enabled, channelIds };
}

function buildAttachmentLines(message) {
  return [...message.attachments.values()].map((attachment, index) => {
    const name = attachment.name || `Anexo ${index + 1}`;
    return `[${name}](${attachment.url})`;
  });
}

function getFirstImageAttachment(message) {
  return [...message.attachments.values()].find((attachment) => {
    const type = String(attachment.contentType || '').toLowerCase();
    const name = String(attachment.name || '').toLowerCase();
    return type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(name);
  });
}

async function handleMirrorMessage(message) {
  if (!message?.guild || !message.channel || message.author?.bot) return false;
  if (!isMirrorMessageChannel(message.channelId)) return false;

  const content = String(message.content || '').trim();
  const attachmentLines = buildAttachmentLines(message);
  if (!content && attachmentLines.length === 0) return false;

  const description = content || '*Mensagem sem texto.*';
  const image = getFirstImageAttachment(message);

  const embed = new EmbedBuilder()
    .setColor('#005DFF')
    .setAuthor({ name: 'VORTEX | AVISO' })
    .setDescription(description.slice(0, 3900))
    .setFooter({ text: 'Vortex • Mensagem do servidor' })
    .setTimestamp(message.createdAt || new Date());

  if (message.guild.iconURL()) {
    embed.setThumbnail(message.guild.iconURL({ size: 128 }));
  }

  if (attachmentLines.length) {
    embed.addFields({
      name: 'Anexos',
      value: attachmentLines.slice(0, 8).join('\n').slice(0, 1024),
      inline: false,
    });
  }

  try {
    await message.delete();
  } catch (error) {
    console.warn(`[MIRROR MESSAGE] Nao consegui apagar mensagem ${message.id}: ${error.message}`);
    return false;
  }

  await message.channel.send(buildThemedPanelPayload('mirrorMessages', embed, {
    bannerUrl: image?.url,
    allowedMentions: { parse: [] },
  }));
  return true;
}

module.exports = {
  ensureMirrorMessageConfig,
  getMirrorMessageChannelIds,
  isMirrorMessageChannel,
  setMirrorMessageChannelEnabled,
  toggleMirrorMessageChannel,
  handleMirrorMessage,
};
