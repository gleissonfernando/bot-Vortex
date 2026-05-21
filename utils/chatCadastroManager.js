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
  const raw = String(content || '').trim();
  if (!raw.includes('|')) {
    const ids = [...raw.matchAll(/\d{15,25}/g)].map((match) => match[0]);
    if (ids.length >= 2) {
      return {
        ok: true,
        userId: ids[0],
        name: null,
        callChannelId: ids[1],
        nivelGame: null,
        photoLink: null,
      };
    }
  }

  const parts = raw
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return {
      ok: false,
      message: 'Use: `@usuario #canal` ou `@usuario | Nome do jogo | #canal | nivel opcional | link opcional`',
    };
  }

  const userId = parseSnowflake(parts[0]);
  const shortFormat = parts.length === 2;
  const callChannelId = parseSnowflake(shortFormat ? parts[1] : parts[2]);
  if (!userId) return { ok: false, message: 'Não encontrei o usuário. Mencione ou cole o ID do usuário.' };
  if (!callChannelId) return { ok: false, message: 'Não encontrei o canal. Mencione ou cole o ID do canal.' };

  return {
    ok: true,
    userId,
    name: shortFormat ? null : parts[1],
    callChannelId,
    nivelGame: shortFormat ? null : parts[3] || null,
    photoLink: shortFormat ? null : parts[4] || null,
  };
}

function buildCadastroHelpText(enabled = true) {
  return [
    enabled ? '✅ Modo cadastro ativado neste canal.' : 'ℹ️ Modo cadastro desativado.',
    '',
    'Envie quantas linhas quiser. Cada usuário deve estar na mesma linha do próprio canal:',
    '',
    '`@usuario #canal-do-usuario`',
    '`@usuario | Nome em game | #canal-do-usuario | nível | link`',
    '',
    'Exemplo:',
    '`@Joao #canal-do-joao`',
    '`@Maria | Maria Vortex | #canal-da-maria | 18`',
    '',
    'Para desligar, envie `...`.',
  ].join('\n');
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
      content: stopped ? buildCadastroHelpText(false) : 'ℹ️ O modo cadastro já estava desligado para você neste canal.',
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
      content: session ? buildCadastroHelpText(true) : buildCadastroHelpText(false),
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
    .setTitle('Modo cadastro ativado')
    .setDescription(buildCadastroHelpText(true));

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
    await message.delete().catch(() => null);
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

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  await message.delete().catch(() => null);

  const successes = [];
  const failures = [];

  for (const line of lines) {
    const parsed = parseCadastroLine(line);
    if (!parsed.ok) {
      failures.push(`${line} - ${parsed.message}`);
      continue;
    }

    const target = await message.client.users.fetch(parsed.userId).catch(() => null);
    if (!target) {
      failures.push(`${line} - usuário não encontrado`);
      continue;
    }
    const member = await message.guild.members.fetch(parsed.userId).catch(() => null);

    const channel = await message.guild.channels.fetch(parsed.callChannelId).catch(() => null);
    if (!isTextChannel(channel)) {
      failures.push(`<@${parsed.userId}> - canal inválido`);
      continue;
    }

    await allowTextChannelAccess(channel, message.guild).catch(() => null);
    const result = await registerManualProfile(message.guild, target, {
      name: parsed.name || member?.displayName || target.username,
      callChannelId: parsed.callChannelId,
      nivelGame: parsed.nivelGame,
      photoLink: parsed.photoLink,
      registeredBy: message.author.id,
    });

    if (!result.ok) {
      failures.push(`<@${parsed.userId}> - ${result.message}`);
      continue;
    }

    successes.push({ userId: parsed.userId, profile: result.profile });

    await target.send({
      content: [
        '✅ Você foi cadastrado no sistema Vortex.',
        `Servidor: ${message.guild.name}`,
        `Cadastrado por: <@${message.author.id}>`,
        `Nome salvo: ${result.profile.nomeGame || result.profile.displayName}`,
        result.profile.callChannelId ? `Canal de texto vinculado: <#${result.profile.callChannelId}>` : null,
        '',
        'Agora você pode usar os recursos liberados para usuários cadastrados.',
      ].filter(Boolean).join('\n'),
      allowedMentions: { users: [message.author.id] },
    }).catch(() => null);
  }

  if (!successes.length) {
    await message.reply({
      content: [
        '❌ Nenhum usuário foi cadastrado.',
        failures.slice(0, 10).join('\n'),
      ].filter(Boolean).join('\n'),
      allowedMentions: { repliedUser: false },
    }).catch(() => null);
    return true;
  }

  return message.reply({
    content: [
      `✅ Cadastro concluído: **${successes.length}** usuário(s).`,
      successes.slice(0, 10).map((item, index) => {
        return `${index + 1}. <@${item.userId}> - ${item.profile.nomeGame || item.profile.displayName} - ${item.profile.callChannelId ? `<#${item.profile.callChannelId}>` : 'N/A'}`;
      }).join('\n'),
      failures.length ? `\n⚠️ Falhas:\n${failures.slice(0, 10).join('\n')}` : null,
    ].filter(Boolean).join('\n'),
    allowedMentions: { users: successes.map((item) => item.userId), repliedUser: false },
  }).then(() => true).catch(() => true);
}

module.exports = {
  executeCadastroCommand,
  handleCadastroMessage,
  parseCadastroLine,
  startCadastroMode,
  stopCadastroMode,
};
