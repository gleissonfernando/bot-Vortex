const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { logger } = require('./logger');

const HIDDEN_CALL_ROLE_ID = process.env.HIDDEN_CALL_ROLE_ID || '1497687531326673190';

function isVoiceChannel(channel) {
  return channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice;
}

async function allowVoiceChannelAccess(channel, guild) {
  if (!channel?.permissionOverwrites?.edit) return false;

  const botId = guild.client.user.id;
  const result = {
    ok: true,
    channelId: channel.id,
    channelName: channel.name,
    errors: [],
  };

  await channel.permissionOverwrites.edit(botId, {
    ViewChannel: true,
    Connect: true,
    ReadMessageHistory: true,
    ManageChannels: true,
  }, { reason: 'Garantir acesso do bot Vortex às calls' }).catch((error) => {
    result.ok = false;
    result.errors.push(`bot:${error.message}`);
  });

  if (HIDDEN_CALL_ROLE_ID) {
    await channel.permissionOverwrites.edit(HIDDEN_CALL_ROLE_ID, {
      ViewChannel: true,
      Connect: true,
      ReadMessageHistory: true,
    }, { reason: 'Garantir acesso do cargo máximo às calls ocultas' }).catch((error) => {
      result.errors.push(`role:${error.message}`);
    });
  }

  if (!result.ok) {
    logger.warn(`Nao foi possivel garantir acesso total à call ${channel.name} (${channel.id}).`, result);
  }

  return result;
}

async function fetchVoiceChannels(guild) {
  const fetched = await guild.channels.fetch().catch(() => null);
  const source = fetched || guild.channels.cache;
  return source
    .filter(isVoiceChannel)
    .sort((a, b) => {
      const parentCompare = String(a.parent?.name || '').localeCompare(String(b.parent?.name || ''));
      if (parentCompare) return parentCompare;
      return (a.rawPosition ?? 0) - (b.rawPosition ?? 0) || String(a.name || '').localeCompare(String(b.name || ''));
    });
}

async function syncVoiceChannelAccess(guild) {
  try {
    const channels = await fetchVoiceChannels(guild);
    if (!channels) return false;

    const summary = {
      ok: true,
      total: channels.size,
      updated: 0,
      failed: 0,
      categoryUpdated: 0,
    };

    for (const channel of channels.values()) {
      const access = await allowVoiceChannelAccess(channel, guild);
      if (access?.ok) summary.updated += 1;
      else summary.failed += 1;

      if (channel.parent?.permissionOverwrites?.edit) {
        await channel.parent.permissionOverwrites.edit(guild.client.user.id, {
          ViewChannel: true,
          ManageChannels: true,
        }, { reason: 'Garantir acesso do bot Vortex à categoria das calls' }).then(() => {
          summary.categoryUpdated += 1;
        }).catch((error) => {
          summary.failed += 1;
          logger.warn(`Nao foi possivel garantir acesso à categoria ${channel.parent.name} (${channel.parent.id}): ${error.message}`);
        });

        if (HIDDEN_CALL_ROLE_ID) {
          await channel.parent.permissionOverwrites.edit(HIDDEN_CALL_ROLE_ID, {
            ViewChannel: true,
          }, { reason: 'Garantir acesso do cargo máximo à categoria das calls ocultas' }).catch(() => null);
        }
      }
    }

    logger.info(`Sincronizacao de calls concluida: ${summary.updated}/${summary.total} call(s), ${summary.failed} falha(s).`);
    return summary;
  } catch (error) {
    logger.error('Erro ao sincronizar acesso às calls:', error);
    return false;
  }
}

module.exports = {
  HIDDEN_CALL_ROLE_ID,
  allowVoiceChannelAccess,
  fetchVoiceChannels,
  isVoiceChannel,
  syncVoiceChannelAccess,
};
