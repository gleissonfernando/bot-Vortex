const GuildLog = require('../models/GuildLog');
const { logger } = require('./logger');
const dashboardClient = require('./dashboardClient');
const { isSupabaseEnabled, supabaseRequest } = require('./supabaseClient');

/**
 * Mapeamento de tipo de log interno → cor do embed no painel
 */
const TYPE_COLORS = {
    member_join:         0x2ECC71,
    member_leave:        0xFF6B6B,
    message_sent:        0x3498DB,
    config_updated:      0x3498DB,
    bot_status_changed:  0x9B59B6,
    maintenance_started: 0xFF0000,
    maintenance_ended:   0x2ECC71,
    error:               0xFF0000,
    warning:             0xFFA500,
    info:                0x5865F2,
    ban:                 0xFF0000,
    kick:                0xFF8C00,
    message_delete:      0xFFA500,
    command:             0x5865F2,
};

function toSupabaseLog(log) {
  return {
    guild_id: log.guildId,
    type: log.type,
    title: log.title,
    description: log.description,
    user_id: log.userId,
    user_name: log.userName,
    user_avatar: log.userAvatar,
    channel_id: log.channelId,
    channel_name: log.channelName,
    message_id: log.messageId,
    metadata: log.metadata || {},
    severity: log.severity,
    ip_address: log.ipAddress,
    user_agent: log.userAgent,
    created_at: log.createdAt,
  };
}

function fromSupabaseLog(row) {
  return {
    id: row.id,
    guildId: row.guild_id,
    type: row.type,
    title: row.title,
    description: row.description,
    userId: row.user_id,
    userName: row.user_name,
    userAvatar: row.user_avatar,
    channelId: row.channel_id,
    channelName: row.channel_name,
    messageId: row.message_id,
    metadata: row.metadata || {},
    severity: row.severity,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  };
}

/**
 * Registrar evento no log do servidor (MongoDB) e replicar para o painel em background.
 */
async function logGuildEvent(guildId, options) {
  try {
    const {
      type = 'info',
      title = 'Evento',
      description = '',
      userId = null,
      userName = null,
      userAvatar = null,
      channelId = null,
      channelName = null,
      messageId = null,
      metadata = {},
      severity = 'low',
      ipAddress = null,
      userAgent = null,
      fields = [],
      imageUrl = null,
    } = options;

    const logEntry = {
      guildId,
      type,
      title,
      description,
      userId,
      userName,
      userAvatar,
      channelId,
      channelName,
      messageId,
      metadata,
      severity,
      ipAddress,
      userAgent,
      createdAt: new Date()
    };

    if (isSupabaseEnabled()) {
      const rows = await supabaseRequest('guild_logs', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: toSupabaseLog(logEntry),
      });
      if (Array.isArray(rows) && rows[0]) Object.assign(logEntry, fromSupabaseLog(rows[0]));
      logger.debug(`Log registrado no Supabase para servidor ${guildId}: ${title}`);
    } else {
      const mongoEntry = new GuildLog(logEntry);
      await mongoEntry.save();
      Object.assign(logEntry, mongoEntry.toObject ? mongoEntry.toObject() : mongoEntry);
      logger.debug(`Log registrado para servidor ${guildId}: ${title}`);
    }

    // 2. Replicar para o painel em background (fire-and-forget)
    dashboardClient.sendLogToDashboard({
      guildId,
      title,
      description,
      type,
      userId:   userId   || undefined,
      userName: userName || undefined,
      color:    TYPE_COLORS[type] || 0x5865F2,
      footer:   'Vortex Management System • Bot',
      imageUrl: imageUrl || undefined,
      fields,
    }).catch(() => {}); // Silencia erros — painel pode estar offline

    return logEntry;

  } catch (error) {
    logger.error(`Erro ao registrar log para servidor ${guildId}:`, error);
    throw error;
  }
}

/**
 * Buscar logs de um servidor com filtros
 */
async function getGuildLogs(guildId, options = {}) {
  try {
    const {
      type = null,
      userId = null,
      limit = 50,
      skip = 0,
      startDate = null,
      endDate = null
    } = options;

    if (isSupabaseEnabled()) {
      const query = {
        select: '*',
        guild_id: `eq.${guildId}`,
        order: 'created_at.desc',
        limit,
        offset: skip,
      };

      if (type) query.type = `eq.${type}`;
      if (userId) query.user_id = `eq.${userId}`;
      if (startDate && endDate) {
        query.and = `(created_at.gte.${new Date(startDate).toISOString()},created_at.lte.${new Date(endDate).toISOString()})`;
      } else if (startDate) {
        query.created_at = `gte.${new Date(startDate).toISOString()}`;
      } else if (endDate) {
        query.created_at = `lte.${new Date(endDate).toISOString()}`;
      }

      const rows = await supabaseRequest('guild_logs', { query });
      const logs = Array.isArray(rows) ? rows.map(fromSupabaseLog) : [];

      return {
        logs,
        total: logs.length,
        limit,
        skip,
        hasMore: logs.length === limit,
      };
    }

    const query = { guildId };

    if (type) query.type = type;
    if (userId) query.userId = userId;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const logs = await GuildLog.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .lean();

    const total = await GuildLog.countDocuments(query);

    return {
      logs,
      total,
      limit,
      skip,
      hasMore: skip + limit < total
    };

  } catch (error) {
    logger.error(`Erro ao buscar logs do servidor ${guildId}:`, error);
    throw error;
  }
}

/**
 * Limpar logs antigos de um servidor
 */
async function clearOldLogs(guildId, daysOld = 30) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    if (isSupabaseEnabled()) {
      await supabaseRequest('guild_logs', {
        method: 'DELETE',
        query: {
          guild_id: `eq.${guildId}`,
          created_at: `lt.${cutoffDate.toISOString()}`,
        },
        headers: { Prefer: 'return=minimal' },
      });

      logger.info(`Logs antigos removidos do Supabase para servidor ${guildId}`);
      return 0;
    }

    const result = await GuildLog.deleteMany({
      guildId,
      createdAt: { $lt: cutoffDate }
    });

    logger.info(`${result.deletedCount} logs antigos removidos do servidor ${guildId}`);
    return result.deletedCount;

  } catch (error) {
    logger.error(`Erro ao limpar logs antigos do servidor ${guildId}:`, error);
    throw error;
  }
}

/**
 * Registrar evento de membro entrando
 */
async function logMemberJoin(guild, member) {
  return logGuildEvent(guild.id, {
    type: 'member_join',
    title: `${member.user.username} entrou no servidor`,
    description: `Novo membro: ${member.user.tag} (${member.id})`,
    userId: member.id,
    userName: member.user.username,
    userAvatar: member.user.displayAvatarURL({ dynamic: true }),
    metadata: {
      memberId: member.id,
      memberTag: member.user.tag,
      totalMembers: guild.memberCount
    },
    severity: 'low'
  });
}

/**
 * Registrar evento de membro saindo
 */
async function logMemberLeave(guild, member) {
  return logGuildEvent(guild.id, {
    type: 'member_leave',
    title: `${member.user.username} saiu do servidor`,
    description: `Membro removido: ${member.user.tag} (${member.id})`,
    userId: member.id,
    userName: member.user.username,
    userAvatar: member.user.displayAvatarURL({ dynamic: true }),
    metadata: {
      memberId: member.id,
      memberTag: member.user.tag,
      totalMembers: guild.memberCount
    },
    severity: 'low'
  });
}

/**
 * Registrar evento de configuração atualizada
 */
async function logConfigUpdate(guildId, guildName, updatedBy, changes) {
  return logGuildEvent(guildId, {
    type: 'config_updated',
    title: `Configurações atualizadas`,
    description: `Alterações realizadas por ${updatedBy}`,
    userId: updatedBy,
    metadata: {
      changes,
      guildName
    },
    severity: 'medium'
  });
}

/**
 * Registrar evento de manutenção
 */
async function logMaintenanceStatus(guildId, guildName, status, message) {
  return logGuildEvent(guildId, {
    type: status === 'started' ? 'maintenance_started' : 'maintenance_ended',
    title: `Manutenção ${status === 'started' ? 'iniciada' : 'finalizada'}`,
    description: message,
    metadata: {
      guildName,
      status
    },
    severity: 'high'
  });
}

/**
 * Registrar banimento de membro
 */
async function logBan(guildId, executor, targetUser, reason) {
  return logGuildEvent(guildId, {
    type: 'ban',
    title: `${targetUser.tag} foi banido`,
    description: `Banido por: ${executor.tag} | Motivo: ${reason}`,
    userId: executor.id,
    userName: executor.tag,
    metadata: {
      targetId:   targetUser.id,
      targetTag:  targetUser.tag,
      executorId: executor.id,
      reason,
    },
    severity: 'high',
    fields: [
      { name: 'Usuário Banido', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
      { name: 'Executado por',  value: `${executor.tag} (${executor.id})`,     inline: true },
      { name: 'Motivo',         value: reason,                                  inline: false },
    ],
  });
}

/**
 * Registrar expulsão de membro
 */
async function logKick(guildId, executor, targetUser, reason) {
  return logGuildEvent(guildId, {
    type: 'kick',
    title: `${targetUser.tag} foi expulso`,
    description: `Expulso por: ${executor.tag} | Motivo: ${reason}`,
    userId: executor.id,
    userName: executor.tag,
    metadata: {
      targetId:   targetUser.id,
      targetTag:  targetUser.tag,
      executorId: executor.id,
      reason,
    },
    severity: 'high',
    fields: [
      { name: 'Usuário Expulso', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
      { name: 'Executado por',   value: `${executor.tag} (${executor.id})`,     inline: true },
      { name: 'Motivo',          value: reason,                                  inline: false },
    ],
  });
}

/**
 * Registrar limpeza de mensagens
 */
async function logClear(guildId, executor, channelName, amount) {
  return logGuildEvent(guildId, {
    type: 'message_delete',
    title: `${amount} mensagens limpas em #${channelName}`,
    description: `Executado por: ${executor.tag}`,
    userId: executor.id,
    userName: executor.tag,
    channelName,
    metadata: { amount, channelName },
    severity: 'medium',
    fields: [
      { name: 'Quantidade', value: String(amount),    inline: true },
      { name: 'Canal',      value: `#${channelName}`, inline: true },
    ],
  });
}

/**
 * Registrar erro
 */
async function logError(guildId, errorTitle, errorMessage, metadata = {}) {
  return logGuildEvent(guildId, {
    type: 'error',
    title: errorTitle,
    description: errorMessage,
    metadata,
    severity: 'high'
  });
}

module.exports = {
  logGuildEvent,
  getGuildLogs,
  clearOldLogs,
  logMemberJoin,
  logMemberLeave,
  logConfigUpdate,
  logMaintenanceStatus,
  logBan,
  logKick,
  logClear,
  logError,
};
