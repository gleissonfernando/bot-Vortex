const fs = require('fs');
const path = require('path');
const { ActivityType, EmbedBuilder } = require('discord.js');

const DATA_PATH = path.join(__dirname, '..', 'commands', 'liveLinks.json');
const ALERT_CHANNEL_ID = '1202251715865489459';
const activeStreams = new Set();

function loadLiveLinks() {
  try {
    if (!fs.existsSync(DATA_PATH)) return {};
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveLiveLinks(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

function getGuildConfig(guildId) {
  const data = loadLiveLinks();
  return data[String(guildId)] || {};
}

function getLiveLink(guildId, userId) {
  const guildConfig = getGuildConfig(guildId);
  return guildConfig[String(userId)]?.url || null;
}

function setLiveLink(guildId, userId, url, updatedBy) {
  const data = loadLiveLinks();
  const guildKey = String(guildId);
  const userKey = String(userId);
  if (!data[guildKey]) data[guildKey] = {};

  data[guildKey][userKey] = {
    url,
    updatedBy: String(updatedBy),
    updatedAt: new Date().toISOString(),
  };
  saveLiveLinks(data);
  return data[guildKey][userKey];
}

function removeLiveLink(guildId, userId) {
  const data = loadLiveLinks();
  const guildKey = String(guildId);
  const userKey = String(userId);
  if (!data[guildKey]?.[userKey]) return false;

  delete data[guildKey][userKey];
  if (Object.keys(data[guildKey]).length === 0) delete data[guildKey];
  saveLiveLinks(data);
  return true;
}

function isValidLiveUrl(value) {
  return /^https?:\/\/\S+\.\S+/i.test(String(value || '').trim());
}

function getStreamingActivity(presence) {
  return presence?.activities?.find((activity) => activity.type === ActivityType.Streaming) || null;
}

function getStreamPlace(activity, fallback = 'Live') {
  return [
    activity?.name,
    activity?.details,
    activity?.state,
  ].filter(Boolean).join(' | ') || fallback;
}

function buildLivePanelEmbed(interaction, link) {
  return new EmbedBuilder()
    .setColor('#9146FF')
    .setAuthor({
      name: 'VORTEX | Alerta de Live',
      iconURL: interaction.client.user.displayAvatarURL(),
    })
    .setTitle('Painel de live')
    .setDescription('Configure o link da sua live para o bot avisar automaticamente quando você começar a transmitir.')
    .addFields(
      { name: 'Usuário', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Canal de alerta', value: `<#${ALERT_CHANNEL_ID}>`, inline: true },
      { name: 'Link cadastrado', value: link || '`Nenhum link cadastrado`', inline: false },
    )
    .setFooter({ text: 'Vortex Live Alerts' })
    .setTimestamp();
}

function buildLiveAlertEmbed({ member, user, activity, link, place }) {
  const displayName = member?.displayName || user.username;
  const streamPlace = place || getStreamPlace(activity);
  const activityUrl = activity?.url && activity.url !== link ? activity.url : null;

  const embed = new EmbedBuilder()
    .setColor('#9146FF')
    .setAuthor({
      name: 'VORTEX | Live iniciada',
      iconURL: user.displayAvatarURL(),
    })
    .setTitle(`${displayName} está em live`)
    .setDescription([
      `<@${user.id}> começou uma transmissão.`,
      '',
      `**Link:** ${link}`,
      `**Onde:** ${streamPlace}`,
      activityUrl ? `**Detectado pelo Discord:** ${activityUrl}` : null,
    ].filter(Boolean).join('\n'))
    .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setFooter({ text: 'Vortex Live Alerts' })
    .setTimestamp();

  return embed;
}

async function sendLiveAlert({ guild, user, member, activity = null, place = null }) {
  if (!guild || !user || user.bot) return false;

  const guildId = guild.id;
  const userId = user.id;
  const streamKey = `${guildId}:${userId}`;
  if (activeStreams.has(streamKey)) return false;

  const link = getLiveLink(guildId, userId);
  if (!link) {
    activeStreams.add(streamKey);
    return false;
  }

  const channel = await guild.channels.fetch(ALERT_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.()) {
    console.warn(`[LIVE ALERT] Canal de alerta invalido ou inacessivel: ${ALERT_CHANNEL_ID}`);
    activeStreams.add(streamKey);
    return false;
  }

  const guildMember = member || await guild.members.fetch(userId).catch(() => null);

  await channel.send({
    content: `<@${userId}> está fazendo live: ${link}`,
    embeds: [buildLiveAlertEmbed({
      member: guildMember,
      user,
      activity,
      link,
      place,
    })],
    allowedMentions: { users: [userId] },
  }).catch((error) => {
    console.warn(`[LIVE ALERT] Falha ao enviar alerta de live de ${userId}: ${error.message}`);
    return null;
  });

  activeStreams.add(streamKey);
  return true;
}

async function handlePresenceLiveAlert(oldPresence, newPresence) {
  if (!newPresence?.guild || !newPresence.user || newPresence.user.bot) return;

  const guildId = newPresence.guild.id;
  const userId = newPresence.user.id;
  const streamKey = `${guildId}:${userId}`;
  const oldStreaming = getStreamingActivity(oldPresence);
  const newStreaming = getStreamingActivity(newPresence);

  if (!newStreaming) {
    activeStreams.delete(streamKey);
    return;
  }

  if (oldStreaming) {
    activeStreams.add(streamKey);
    return;
  }

  await sendLiveAlert({
    guild: newPresence.guild,
    user: newPresence.user,
    member: newPresence.member,
    activity: newStreaming,
  });
}

async function handleVoiceLiveAlert(oldState, newState) {
  const guild = newState?.guild;
  const member = newState?.member;
  const user = member?.user;
  if (!guild || !member || !user || user.bot) return;

  const guildId = guild.id;
  const userId = user.id;
  const streamKey = `${guildId}:${userId}`;
  const wasStreaming = Boolean(oldState?.streaming);
  const isStreaming = Boolean(newState?.streaming);

  if (!isStreaming) {
    activeStreams.delete(streamKey);
    return;
  }

  if (wasStreaming) {
    activeStreams.add(streamKey);
    return;
  }

  const voiceChannel = newState.channel;
  await sendLiveAlert({
    guild,
    user,
    member,
    place: voiceChannel ? `<#${voiceChannel.id}>` : 'Call do Discord',
  });
}

module.exports = {
  ALERT_CHANNEL_ID,
  buildLivePanelEmbed,
  getLiveLink,
  handlePresenceLiveAlert,
  handleVoiceLiveAlert,
  isValidLiveUrl,
  removeLiveLink,
  setLiveLink,
};
