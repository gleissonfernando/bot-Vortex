const { ActivityType, EmbedBuilder } = require('discord.js');

const FALLBACK_ALERT_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '1202251715865489459';
const FIVEM_ALERT_CHANNEL_ID = process.env.FIVEM_GTA_ALERT_CHANNEL_ID || '1498895777790038116';
const activeFiveMPlayers = new Map();

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isFiveMActivity(activity) {
  if (!activity || activity.type !== ActivityType.Playing) return false;
  const haystack = [
    activity.name,
    activity.details,
    activity.state,
    activity.assets?.largeText,
    activity.assets?.smallText,
  ].map(normalizeText).join(' ');

  return /\bfivem\b/.test(haystack)
    || /\bgta\s*v?\b/.test(haystack)
    || /grand theft auto/.test(haystack);
}

function getFiveMActivity(presence) {
  return presence?.activities?.find(isFiveMActivity) || null;
}

function cleanCityName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[|:>\-\s]+|[|:>\-\s]+$/g, '')
    .slice(0, 90)
    .trim();
}

function extractCityName(activity) {
  const candidates = [
    activity?.state,
    activity?.details,
    activity?.assets?.largeText,
    activity?.assets?.smallText,
  ].filter(Boolean).map(String);

  for (const candidate of candidates) {
    const match = candidate.match(/(?:cidade|city|servidor|server|cidade\/servidor)\s*[:|\-]\s*([^|•\n\r]+)/i);
    if (match?.[1]) return cleanCityName(match[1]);
  }

  for (const candidate of candidates) {
    const cleaned = cleanCityName(
      candidate
        .replace(/FiveM/gi, '')
        .replace(/Grand Theft Auto V/gi, '')
        .replace(/\bGTA\s*V?\b/gi, '')
        .replace(/playing/gi, '')
    );
    if (cleaned && cleaned.length >= 3) return cleaned;
  }

  return 'Nao informado pelo Discord';
}

function buildActivityKey(activity) {
  return [
    activity?.name,
    activity?.details,
    activity?.state,
    activity?.assets?.largeText,
    activity?.assets?.smallText,
  ].filter(Boolean).join('|').slice(0, 250);
}

async function resolveFiveMAlertChannel(guild) {
  if (FIVEM_ALERT_CHANNEL_ID) {
    const configured = await guild.channels.fetch(FIVEM_ALERT_CHANNEL_ID).catch(() => null);
    if (configured?.isTextBased?.()) return configured;
  }

  const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
  const byName = channels.find((channel) => {
    if (!channel?.isTextBased?.()) return false;
    const name = normalizeText(channel.name).replace(/[^a-z0-9]/g, '');
    return name === 'fivemgta' || name === 'gtafivem' || (name.includes('fivem') && name.includes('gta'));
  });
  if (byName) return byName;

  return guild.channels.fetch(FALLBACK_ALERT_CHANNEL_ID).catch(() => null);
}

function buildFiveMEmbed({ member, user, activity, cityName }) {
  const displayName = member?.displayName || user.username;
  const details = [activity?.details, activity?.state].filter(Boolean).join('\n') || 'Sem detalhes extras.';

  return new EmbedBuilder()
    .setColor('#2ECC71')
    .setTitle(`${displayName} entrou no FiveM/GTA`)
    .setDescription([
      `<@${user.id}> começou a jogar **${activity?.name || 'FiveM/GTA'}**.`,
      '',
      `**Cidade/servidor:** ${cityName}`,
      `**Atividade:** ${details}`,
    ].join('\n'))
    .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setFooter({ text: 'Vortex FiveM/GTA Activity Alerts' })
    .setTimestamp();
}

async function handleFiveMActivityAlert(oldPresence, newPresence) {
  if (!newPresence?.guild || !newPresence.user || newPresence.user.bot) return;

  const guild = newPresence.guild;
  const user = newPresence.user;
  const member = newPresence.member;
  const key = `${guild.id}:${user.id}`;
  const oldActivity = getFiveMActivity(oldPresence);
  const newActivity = getFiveMActivity(newPresence);

  if (!newActivity) {
    activeFiveMPlayers.delete(key);
    return;
  }

  const activityKey = buildActivityKey(newActivity);
  if (oldActivity && activeFiveMPlayers.get(key) === activityKey) return;
  if (activeFiveMPlayers.get(key) === activityKey) return;

  const channel = await resolveFiveMAlertChannel(guild);
  if (!channel?.isTextBased?.()) {
    console.warn('[FIVEM ALERT] Canal de alerta FiveM/GTA nao encontrado.');
    activeFiveMPlayers.set(key, activityKey);
    return;
  }

  const cityName = extractCityName(newActivity);
  await channel.send({
    content: `<@${user.id}> começou a jogar FiveM/GTA - cidade: **${cityName}**`,
    embeds: [buildFiveMEmbed({ member, user, activity: newActivity, cityName })],
    allowedMentions: { users: [user.id] },
  }).catch((error) => {
    console.warn(`[FIVEM ALERT] Falha ao enviar alerta de ${user.id}: ${error.message}`);
    return null;
  });

  activeFiveMPlayers.set(key, activityKey);
}

module.exports = {
  handleFiveMActivityAlert,
};
