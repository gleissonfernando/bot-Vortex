const { Events, EmbedBuilder, AuditLogEvent } = require('discord.js');
const { getLogChannelId, isChannelLogDisabled, isLogChannelIgnored, isSilentLogUser, sendVortexLog } = require('../utils/notifications');
const { logger } = require('../utils/logger');
const { formatDate } = require('../utils/dateTime');
const { isPrimaryGuild, isPrimaryGuildChannel } = require('../utils/guildScope');
const { handleAuditLogEntry } = require('../utils/antiAbuseManager');

const ACTION_DETAILS = {
    GuildUpdate: { title: 'Servidor atualizado', verb: 'alterou configuracoes do servidor', color: '#00D9FF' },
    ChannelCreate: { title: 'Canal criado', verb: 'criou um canal', color: '#57F287' },
    ChannelUpdate: { title: 'Canal atualizado', verb: 'alterou um canal', color: '#00D9FF' },
    ChannelDelete: { title: 'Canal deletado', verb: 'deletou um canal', color: '#FF0055' },
    ChannelOverwriteCreate: { title: 'Permissão criada', verb: 'criou permissão em um canal', color: '#57F287' },
    ChannelOverwriteUpdate: { title: 'Permissão alterada', verb: 'alterou permissão em um canal', color: '#FFA500' },
    ChannelOverwriteDelete: { title: 'Permissão removida', verb: 'removeu permissão de um canal', color: '#FF0055' },
    MemberKick: { title: 'Membro expulso', verb: 'expulsou um membro', color: '#FF8C00' },
    MemberPrune: { title: 'Limpeza de membros', verb: 'removeu membros inativos', color: '#FF8C00' },
    MemberBanAdd: { title: 'Membro banido', verb: 'baniu um membro', color: '#FF0055' },
    MemberBanRemove: { title: 'Banimento removido', verb: 'removeu o banimento de um membro', color: '#57F287' },
    MemberUpdate: { title: 'Membro atualizado', verb: 'alterou dados de um membro', color: '#00D9FF' },
    MemberRoleUpdate: { title: 'Cargos alterados', verb: 'alterou cargos de um membro', color: '#7000FF' },
    MemberMove: { title: 'Membro movido', verb: 'moveu membro em canal de voz', color: '#5865F2' },
    MemberDisconnect: { title: 'Membro desconectado', verb: 'desconectou membro de voz', color: '#FFA500' },
    BotAdd: { title: 'Bot adicionado', verb: 'adicionou um bot', color: '#57F287' },
    RoleCreate: { title: 'Cargo criado', verb: 'criou um cargo', color: '#57F287' },
    RoleUpdate: { title: 'Cargo atualizado', verb: 'alterou um cargo', color: '#00D9FF' },
    RoleDelete: { title: 'Cargo deletado', verb: 'deletou um cargo', color: '#FF0055' },
    InviteCreate: { title: 'Convite criado', verb: 'criou um convite', color: '#57F287' },
    InviteUpdate: { title: 'Convite atualizado', verb: 'alterou um convite', color: '#00D9FF' },
    InviteDelete: { title: 'Convite deletado', verb: 'deletou um convite', color: '#FF0055' },
    WebhookCreate: { title: 'Webhook criado', verb: 'criou um webhook', color: '#57F287' },
    WebhookUpdate: { title: 'Webhook atualizado', verb: 'alterou um webhook', color: '#00D9FF' },
    WebhookDelete: { title: 'Webhook deletado', verb: 'deletou um webhook', color: '#FF0055' },
    EmojiCreate: { title: 'Emoji criado', verb: 'criou um emoji', color: '#57F287' },
    EmojiUpdate: { title: 'Emoji atualizado', verb: 'alterou um emoji', color: '#00D9FF' },
    EmojiDelete: { title: 'Emoji deletado', verb: 'deletou um emoji', color: '#FF0055' },
    MessageDelete: { title: 'Mensagem deletada', verb: 'deletou mensagem', color: '#FFA500' },
    MessageBulkDelete: { title: 'Mensagens deletadas', verb: 'deletou mensagens em massa', color: '#FF8C00' },
    MessagePin: { title: 'Mensagem fixada', verb: 'fixou uma mensagem', color: '#57F287' },
    MessageUnpin: { title: 'Mensagem desafixada', verb: 'desafixou uma mensagem', color: '#FFA500' },
    IntegrationCreate: { title: 'Integração criada', verb: 'criou uma integração', color: '#57F287' },
    IntegrationUpdate: { title: 'Integração atualizada', verb: 'alterou uma integração', color: '#00D9FF' },
    IntegrationDelete: { title: 'Integração deletada', verb: 'deletou uma integração', color: '#FF0055' },
    StageInstanceCreate: { title: 'Palco criado', verb: 'criou um palco', color: '#57F287' },
    StageInstanceUpdate: { title: 'Palco atualizado', verb: 'alterou um palco', color: '#00D9FF' },
    StageInstanceDelete: { title: 'Palco encerrado', verb: 'encerrou um palco', color: '#FF0055' },
    StickerCreate: { title: 'Sticker criado', verb: 'criou um sticker', color: '#57F287' },
    StickerUpdate: { title: 'Sticker atualizado', verb: 'alterou um sticker', color: '#00D9FF' },
    StickerDelete: { title: 'Sticker deletado', verb: 'deletou um sticker', color: '#FF0055' },
    ThreadCreate: { title: 'Topico criado', verb: 'criou um topico', color: '#57F287' },
    ThreadUpdate: { title: 'Topico atualizado', verb: 'alterou um topico', color: '#00D9FF' },
    ThreadDelete: { title: 'Topico deletado', verb: 'deletou um topico', color: '#FF0055' },
    AutoModerationRuleCreate: { title: 'AutoMod criado', verb: 'criou regra de automoderação', color: '#57F287' },
    AutoModerationRuleUpdate: { title: 'AutoMod atualizado', verb: 'alterou regra de automoderação', color: '#00D9FF' },
    AutoModerationRuleDelete: { title: 'AutoMod deletado', verb: 'deletou regra de automoderação', color: '#FF0055' },
    AutoModerationBlockMessage: { title: 'Mensagem bloqueada', verb: 'bloqueou mensagem pelo AutoMod', color: '#FFA500' },
    AutoModerationFlagToChannel: { title: 'Mensagem sinalizada', verb: 'sinalizou mensagem pelo AutoMod', color: '#FFA500' },
    AutoModerationUserCommunicationDisabled: { title: 'Usuário silenciado', verb: 'silenciou usuário pelo AutoMod', color: '#FF8C00' },
};

const CHANGE_LABELS = {
    name: 'Nome',
    nick: 'Apelido',
    avatar_hash: 'Avatar',
    splash_hash: 'Splash',
    banner_hash: 'Banner',
    owner_id: 'Dono',
    region: 'Regiao',
    preferred_locale: 'Idioma',
    afk_channel_id: 'Canal AFK',
    afk_timeout: 'Tempo AFK',
    mfa_level: 'Nivel MFA',
    verification_level: 'Nível de verificação',
    explicit_content_filter: 'Filtro de conteudo',
    default_message_notifications: 'Notificacoes padrao',
    vanity_url_code: 'URL personalizada',
    widget_enabled: 'Widget ativado',
    widget_channel_id: 'Canal do widget',
    system_channel_id: 'Canal do sistema',
    rules_channel_id: 'Canal de regras',
    public_updates_channel_id: 'Canal de updates',
    topic: 'Topico',
    bitrate: 'Bitrate',
    user_limit: 'Limite de usuários',
    nsfw: 'NSFW',
    rate_limit_per_user: 'Slowmode',
    parent_id: 'Categoria',
    permission_overwrites: 'Permissoes do canal',
    position: 'Posicao',
    type: 'Tipo',
    permissions: 'Permissoes',
    color: 'Cor',
    hoist: 'Separado na lista',
    mentionable: 'Mencionavel',
    communication_disabled_until: 'Timeout ate',
    deaf: 'Ensurdecido',
    mute: 'Mutado',
    roles: 'Cargos',
    $add: 'Adicionado',
    $remove: 'Removido',
};

function getActionName(action) {
    return Object.entries(AuditLogEvent).find(([, value]) => value === action)?.[0] || String(action);
}

function limit(text, size = 900) {
    const value = String(text ?? 'N/A');
    return value.length > size ? `${value.slice(0, size - 3)}...` : value;
}

function code(value) {
    return `\`${limit(String(value ?? 'N/A').replace(/`/g, "'"), 900)}\``;
}

function formatUser(user) {
    if (!user) return 'Desconhecido';
    const label = user.tag || user.username || user.id;
    return user.id ? `<@${user.id}> (${code(label)} | ${code(user.id)})` : code(label);
}

function formatTarget(target) {
    if (!target) return 'N/A';
    if (typeof target === 'string') return code(target);

    const id = target.id ? String(target.id) : null;
    const name = target.tag || target.username || target.name || target.title || id || 'Alvo desconhecido';

    if (target.type !== undefined && id && target.guild) return `<#${id}> (${code(name)} | ${code(id)})`;
    if (target.hexColor || target.permissions || target.managed !== undefined) return `<@&${id}> (${code(name)} | ${code(id)})`;
    if (target.tag || target.username) return `<@${id}> (${code(name)} | ${code(id)})`;
    if (id) return `${code(name)} | ID: ${code(id)}`;
    return code(name);
}

function formatPrimitive(value) {
    if (value === undefined || value === null || value === '') return 'vazio';
    if (value instanceof Date) return formatDate(value);
    if (typeof value === 'boolean') return value ? 'sim' : 'não';
    if (typeof value === 'number') return String(value);
    return String(value);
}

function formatArrayValue(value) {
    if (!Array.isArray(value)) return null;
    if (value.length === 0) return 'nenhum';

    return value.slice(0, 8).map((item) => {
        if (item?.id && item?.name) return `${item.name} (${item.id})`;
        if (item?.id) return item.id;
        return formatPrimitive(item);
    }).join(', ');
}

function formatChangeValue(value) {
    const arrayValue = formatArrayValue(value);
    if (arrayValue) return arrayValue;

    if (value && typeof value === 'object') {
        if (value.id && value.name) return `${value.name} (${value.id})`;
        if (value.id) return String(value.id);
        return limit(JSON.stringify(value), 300);
    }

    return formatPrimitive(value);
}

function formatChanges(changes = []) {
    if (!Array.isArray(changes) || changes.length === 0) {
        return 'Nenhuma alteração detalhada foi enviada pela auditoria do Discord.';
    }

    return changes
        .slice(0, 10)
        .map((change) => {
            const label = CHANGE_LABELS[change.key] || change.key || 'Campo';
            const before = formatChangeValue(change.old);
            const after = formatChangeValue(change.new);
            return `**${label}**\nAntes: ${code(before)}\nDepois: ${code(after)}`;
        })
        .join('\n\n');
}

function formatExtra(extra) {
    if (!extra) return null;

    const details = [];
    if (extra.channel) details.push(`Canal: ${formatTarget(extra.channel)}`);
    if (extra.count !== undefined) details.push(`Quantidade: ${code(extra.count)}`);
    if (extra.deleteMemberDays !== undefined) details.push(`Dias inativos: ${code(extra.deleteMemberDays)}`);
    if (extra.membersRemoved !== undefined) details.push(`Membros removidos: ${code(extra.membersRemoved)}`);
    if (extra.messageId) details.push(`Mensagem ID: ${code(extra.messageId)}`);
    if (extra.roleName) details.push(`Cargo: ${code(extra.roleName)}`);
    if (extra.integrationType) details.push(`Integração: ${code(extra.integrationType)}`);

    return details.length ? details.join('\n') : null;
}

function getRelatedChannelIds(auditLogEntry) {
    const ids = new Set();
    const target = auditLogEntry.target;
    const extra = auditLogEntry.extra;

    if (target?.id && target?.guild && target?.type !== undefined) ids.add(String(target.id));
    if (extra?.channel?.id) ids.add(String(extra.channel.id));
    if (extra?.channelId) ids.add(String(extra.channelId));

    for (const change of auditLogEntry.changes || []) {
        if (['channel_id', 'afk_channel_id', 'widget_channel_id', 'system_channel_id', 'rules_channel_id', 'public_updates_channel_id', 'parent_id'].includes(change.key)) {
            if (change.old) ids.add(String(change.old));
            if (change.new) ids.add(String(change.new));
        }
    }

    return [...ids];
}

module.exports = {
    name: Events.GuildAuditLogEntryCreate,
    async execute(auditLogEntry, guild) {
        try {
            await handleAuditLogEntry(auditLogEntry, guild).catch((error) => {
                logger.error('Erro ao processar Anti-Abuso no audit log:', error);
            });
            if (!isPrimaryGuild(guild?.id)) return;
            if (isSilentLogUser(auditLogEntry.executor?.id)) return;
            if (getRelatedChannelIds(auditLogEntry).some(isLogChannelIgnored)) return;

            const actionName = getActionName(auditLogEntry.action);
            const action = ACTION_DETAILS[actionName] || {
                title: 'Acao auditada',
                verb: 'executou uma ação auditada',
                color: '#5865F2',
            };
            const executor = auditLogEntry.executor;
            const target = auditLogEntry.target;
            const createdAt = auditLogEntry.createdTimestamp
                ? `<t:${Math.floor(auditLogEntry.createdTimestamp / 1000)}:F>`
                : `<t:${Math.floor(Date.now() / 1000)}:F>`;
            const extra = formatExtra(auditLogEntry.extra);

            const embed = new EmbedBuilder()
                .setColor(action.color)
                .setAuthor({
                    name: 'VORTEX | AUDITORIA',
                    iconURL: guild.client.user?.displayAvatarURL?.() || undefined,
                })
                .setTitle(action.title)
                .setDescription([
                    `${formatUser(executor)} ${action.verb}.`,
                    '',
                    `**Alvo:** ${formatTarget(target)}`,
                    `**Quando:** ${createdAt}`,
                    `**Motivo:** ${auditLogEntry.reason ? limit(auditLogEntry.reason, 800) : 'Nao informado'}`,
                ].join('\n'))
                .addFields(
                    { name: 'O que foi mexido', value: limit(formatChanges(auditLogEntry.changes), 1024), inline: false },
                    { name: 'Contexto', value: limit(extra || 'Sem contexto extra informado pelo Discord.', 1024), inline: false },
                    { name: 'Dados tecnicos', value: [
                        `Evento: ${code(actionName)}`,
                        `Servidor: ${code(`${guild.name} (${guild.id})`)}`,
                        `Executor ID: ${code(executor?.id || 'N/A')}`,
                        `Alvo ID: ${code(target?.id || 'N/A')}`,
                    ].join('\n'), inline: false }
                )
                .setTimestamp()
                .setFooter({ text: 'Vortex Management System - Auditoria detalhada' });

            if (executor?.displayAvatarURL) {
                embed.setThumbnail(executor.displayAvatarURL({ dynamic: true, size: 128 }));
            }

            if (isChannelLogDisabled()) {
                await sendVortexLog(guild.client, {
                    title: action.title,
                    description: [
                        `${formatUser(executor)} ${action.verb}.`,
                        '',
                        `**Alvo:** ${formatTarget(target)}`,
                        `**Quando:** ${createdAt}`,
                        `**Motivo:** ${auditLogEntry.reason ? limit(auditLogEntry.reason, 800) : 'Nao informado'}`,
                        '',
                        `**O que foi mexido**\n${limit(formatChanges(auditLogEntry.changes), 1200)}`,
                        '',
                        `**Contexto**\n${limit(extra || 'Sem contexto extra informado pelo Discord.', 900)}`,
                    ].join('\n').slice(0, 3900),
                    color: action.color,
                    type: 'AUDITORIA',
                    guildId: guild.id,
                }).catch(() => null);
                return;
            }

            const channel = await guild.client.channels.fetch(getLogChannelId()).catch(() => null);
            if (!isPrimaryGuildChannel(channel)) return;
            if (!channel?.isTextBased?.()) return;

            await channel.send({ embeds: [embed] }).catch(() => null);
        } catch (error) {
            logger.error('Erro ao enviar audit log do servidor:', error);
        }
    },
};
