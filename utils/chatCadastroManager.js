const { EmbedBuilder } = require('discord.js');
const { registerManualProfile } = require('./profileManager');
const { allowTextChannelAccess, isTextChannel } = require('./textChannelAccess');
const { hasVortexLevel } = require('./permissions');
const { safeReply } = require('./safeReply');

const activeSessions = new Map();

function getSessionKey(guildId, channelId, userId) {
  return `${guildId}:${channelId}:${userId}`;
}

function parseSnowflake(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/\d{15,25}/);
  return match ? match[0] : '';
}

function parseCadastroLine(content) {
  const parts = String(content || '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 3) {
    return {
      ok: false,
      message: 'Use: `@usuario | Nome do jogo | #canal | nivel opcional | link opcional`',
    };
  }

  const userId = parseSnowflake(parts[0]);
  const callChannelId = parseSnowflake(parts[2]);
  if (!userId) return { ok: false, message: 'Não encontrei o usuário. Mencione ou cole o ID do usuário.' };
  if (!callChannelId) return { ok: false, message: 'Não encontrei o canal. Mencione ou cole o ID do canal.' };

  return {
    ok: true,
    userId,
    name: parts[1],
    callChannelId,
    nivelGame: parts[3] || null,
    photoLink: parts[4] || null,
  };
}

function startCadastroMode({ guildId, channelId, userId }) {
  const key = getSessionKey(guildId, channelId, userId);
  activeSessions.set(key, {
    guildId: String(guildId),
    channelId: String(channelId),
    userId: String(userId),
    startedAt: Date.now(),
  });
  return activeSessions.get(key);
}

function stopCadastroMode({ guildId, channelId, userId }) {
  return activeSessions.delete(getSessionKey(guildId, channelId, userId));
}

function getCadastroSession({ guildId, channelId, userId }) {
  return activeSessions.get(getSessionKey(guildId, channelId, userId)) || null;
}

async function executeCadastroCommand(interaction) {
  if (!hasVortexLevel(interaction.member, ['admin', 'medio'])) {
    return safeReply(interaction, { content: '❌ Apenas Admin/Médio Vortex pode usar o modo cadastro.', ephemeral: true });
  }

  const action = interaction.options.getString('acao') || 'ligar';
  if (action === 'desligar') {
    const stopped = stopCadastroMode({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
    });
    return safeReply(interaction, {
      content: stopped ? '✅ Modo cadastro desligado neste canal.' : 'ℹ️ O modo cadastro já estava desligado para você neste canal.',
      ephemeral: true,
    });
  }

  if (action === 'status') {
    const session = getCadastroSession({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
    });
    return safeReply(interaction, {
      content: session ? '✅ Modo cadastro está ligado para você neste canal.' : 'ℹ️ Modo cadastro está desligado para você neste canal.',
      ephemeral: true,
    });
  }

  startCadastroMode({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
  });

  const embed = new EmbedBuilder()
    .setColor('#00D9FF')
    .setTitle('Modo cadastro ligado')
    .setDescription([
      'Envie uma linha por usuário neste canal.',
      '',
      '`@usuario | Nome do jogo | #canal | nivel opcional | link opcional`',
      '',
      'Para desligar, envie `...`.',
    ].join('\n'));

  return safeReply(interaction, { embeds: [embed], ephemeral: true });
}

async function handleCadastroMessage(message) {
  if (!message?.guild || message.author?.bot) return false;
  const session = getCadastroSession({
    guildId: message.guild.id,
    channelId: message.channelId,
    userId: message.author.id,
  });
  if (!session) return false;

  const content = String(message.content || '').trim();
  if (content === '...') {
    stopCadastroMode({
      guildId: message.guild.id,
      channelId: message.channelId,
      userId: message.author.id,
    });
    await message.reply({ content: '✅ Modo cadastro desligado.', allowedMentions: { repliedUser: false } }).catch(() => null);
    return true;
  }

  if (!hasVortexLevel(message.member, ['admin', 'medio'])) {
    stopCadastroMode({
      guildId: message.guild.id,
      channelId: message.channelId,
      userId: message.author.id,
    });
    await message.reply({ content: '❌ Modo cadastro desligado: você não tem permissão.', allowedMentions: { repliedUser: false } }).catch(() => null);
    return true;
  }

  const parsed = parseCadastroLine(content);
  if (!parsed.ok) {
    await message.reply({ content: `❌ ${parsed.message}`, allowedMentions: { repliedUser: false } }).catch(() => null);
    return true;
  }

  const target = await message.client.users.fetch(parsed.userId).catch(() => null);
  if (!target) {
    await message.reply({ content: '❌ Usuário não encontrado pelo ID informado.', allowedMentions: { repliedUser: false } }).catch(() => null);
    return true;
  }

  const channel = await message.guild.channels.fetch(parsed.callChannelId).catch(() => null);
  if (!isTextChannel(channel)) {
    await message.reply({ content: '❌ O canal informado precisa ser um canal de texto válido.', allowedMentions: { repliedUser: false } }).catch(() => null);
    return true;
  }

  await allowTextChannelAccess(channel, message.guild).catch(() => null);
  const result = await registerManualProfile(message.guild, target, {
    name: parsed.name,
    callChannelId: parsed.callChannelId,
    nivelGame: parsed.nivelGame,
    photoLink: parsed.photoLink,
    registeredBy: message.author.id,
  });

  if (!result.ok) {
    await message.reply({ content: `❌ ${result.message}`, allowedMentions: { repliedUser: false } }).catch(() => null);
    return true;
  }

  await message.reply({
    content: [
      `✅ Perfil cadastrado: <@${parsed.userId}>`,
      `Nome: **${result.profile.nomeGame || result.profile.displayName}**`,
      `Canal: <#${result.profile.callChannelId}>`,
      result.profile.nivelGame ? `Nível: **${result.profile.nivelGame}**` : null,
    ].filter(Boolean).join('\n'),
    allowedMentions: { users: [parsed.userId], repliedUser: false },
  }).catch(() => null);
  return true;
}

module.exports = {
  executeCadastroCommand,
  handleCadastroMessage,
  parseCadastroLine,
  startCadastroMode,
  stopCadastroMode,
};
