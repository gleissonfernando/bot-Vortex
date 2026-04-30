const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { formatDate } = require('./pontoManager');

const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const QUEUED_CHANNEL_LOGS_PATH = path.join(__dirname, '..', 'commands', 'queuedChannelLogs.json');
const VORTEX_BANNER_PATH = path.join(__dirname, '..', 'foto', 'IMG_4234.png');
const VORTEX_BANNER_NAME = 'IMG_4234.png';
const FIXED_LOG_CHANNEL = '1497685822525149337';
const CHANNEL_LOG_DM_FALLBACK_USER_ID = '1426287249020158018';
const CHANNEL_LOG_REENABLE_BUTTON_ID = 're_enable_channel_logs';
const LOG_TIME_ZONE = 'America/Sao_Paulo';
const SUPERIOR_ID = '1497703127074345040';
const ALERT_DM_USER_IDS = [
    '1426287249020158018',
    '289227932432334869',
    '761011766440230932',
];

function getLogChannelId() {
    return readConfig().LOG_CHANNEL || FIXED_LOG_CHANNEL;
}

function readConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return {};
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8') || '{}');
    } catch {
        return {};
    }
}

function writeConfig(data) {
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function ensureQueuedLogsFile() {
    if (!fs.existsSync(QUEUED_CHANNEL_LOGS_PATH)) {
        fs.writeFileSync(QUEUED_CHANNEL_LOGS_PATH, `${JSON.stringify([], null, 2)}\n`, 'utf8');
    }
}

function readQueuedLogs() {
    ensureQueuedLogsFile();
    try {
        const rows = JSON.parse(fs.readFileSync(QUEUED_CHANNEL_LOGS_PATH, 'utf8') || '[]');
        return Array.isArray(rows) ? rows : [];
    } catch {
        return [];
    }
}

function writeQueuedLogs(rows) {
    fs.writeFileSync(QUEUED_CHANNEL_LOGS_PATH, `${JSON.stringify(rows.slice(-500), null, 2)}\n`, 'utf8');
}

function getSaoPauloParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: LOG_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(date).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = part.value;
        return acc;
    }, {});

    return {
        dateKey: `${parts.year}-${parts.month}-${parts.day}`,
        hour: parts.hour,
        minute: parts.minute,
    };
}

function isChannelLogDisabled() {
    return readConfig().DISABLE_CHANNEL_LOGS === true;
}

function isDmLogDisabled() {
    return readConfig().DISABLE_DM_LOGS === true;
}

function getDisabledLogChannelIds() {
    const ids = readConfig().DISABLED_LOG_CHANNEL_IDS;
    return Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
}

function isLogChannelIgnored(channelId) {
    if (!channelId) return false;
    return getDisabledLogChannelIds().includes(String(channelId));
}

function hasIgnoredRelatedChannel(channelId, relatedChannelIds = []) {
    const ids = [
        channelId,
        ...(Array.isArray(relatedChannelIds) ? relatedChannelIds : [relatedChannelIds]),
    ].filter(Boolean).map(String);
    return ids.some(isLogChannelIgnored);
}

function syncStoredLogChannel() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return;

        const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        if (data.LOG_CHANNEL) return;

        data.LOG_CHANNEL = FIXED_LOG_CHANNEL;
        fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    } catch (error) {
        // Falha de sincronização não pode impedir o envio dos logs.
    }
}

function buildLogEmbed(client, { title, description, color = '#7000FF', type = 'LOG', timestamp = null }) {
    const iconURL = client.user?.displayAvatarURL?.() || null;
    const author = { name: `VORTEX | ${type}` };
    if (iconURL) author.iconURL = iconURL;

    return new EmbedBuilder()
        .setAuthor(author)
        .setTitle(`LOG | ${String(title).toUpperCase()}`)
        .setColor(color)
        .setDescription(String(description || 'Evento registrado.'))
        .setTimestamp(timestamp ? new Date(timestamp) : new Date())
        .setFooter({ text: 'Vortex Management System - Monitoramento' });
}

async function sendFixedChannelEmbed(client, embed) {
    const channel = await client.channels.fetch(FIXED_LOG_CHANNEL).catch(() => null);
    if (!channel?.isTextBased?.()) return false;
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    return true;
}

async function queueDisabledChannelLog(client, payload) {
    const queuedAt = new Date().toISOString();
    writeQueuedLogs([...readQueuedLogs(), { ...payload, queuedAt }]);

    const user = await client.users.fetch(CHANNEL_LOG_DM_FALLBACK_USER_ID).catch(() => null);
    if (user) {
        const embed = buildLogEmbed(client, {
            ...payload,
            title: `[Canal desligado] ${payload.title}`,
            description: [
                payload.description || 'Evento registrado.',
                '',
                `Log guardado em fila desde: ${formatDate(queuedAt)}`,
            ].join('\n'),
            timestamp: queuedAt,
        });
        await user.send({ embeds: [embed] }).catch(() => null);
    }
}

async function flushQueuedChannelLogs(client) {
    const queued = readQueuedLogs();
    if (!queued.length) return 0;

    const channel = await client.channels.fetch(getLogChannelId()).catch(() => null);
    if (!channel?.isTextBased?.()) return 0;

    await channel.send({
        embeds: [
            new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('Logs do canal reativados')
                .setDescription(`Reenviando **${queued.length}** log(s) acumulado(s) enquanto o canal de logs estava desligado.`)
                .setTimestamp(),
        ],
        allowedMentions: { parse: [] },
    }).catch(() => null);

    let sent = 0;
    for (const item of queued) {
        const embed = buildLogEmbed(client, {
            ...item,
            description: [
                item.description || 'Evento registrado.',
                '',
                `Guardado em fila: ${formatDate(item.queuedAt)}`,
            ].join('\n'),
            timestamp: item.queuedAt,
        });
        const ok = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).then(() => true).catch(() => false);
        if (ok) sent += 1;
    }

    writeQueuedLogs([]);
    return sent;
}

async function notifyChannelLogsDisabled(client, disabledBy) {
    const disabledAt = new Date().toISOString();
    const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('Canal de logs desativado')
        .setDescription([
            `Desativado por: <@${disabledBy}> (${disabledBy})`,
            `Horário: ${formatDate(disabledAt)}`,
            '',
            'As logs serão enviadas por DM para o monitoramento e guardadas em fila.',
            'Reative o canal de logs assim que possível.',
        ].join('\n'))
        .setTimestamp();

    await sendFixedChannelEmbed(client, embed);

    const user = await client.users.fetch(disabledBy).catch(() => null);
    if (user) {
        await user.send({
            embeds: [embed],
            components: [buildReenableLogButtonRow()],
        }).catch(() => null);
    }
}

function buildReenableLogButtonRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(CHANNEL_LOG_REENABLE_BUTTON_ID)
            .setLabel('Religar log')
            .setStyle(ButtonStyle.Success)
    );
}

async function setChannelLogsEnabled(client, enabled, actorId = null, reason = 'manual') {
    const conf = readConfig();
    const wasDisabled = conf.DISABLE_CHANNEL_LOGS === true;
    conf.DISABLE_CHANNEL_LOGS = !enabled;

    if (!enabled) {
        conf.CHANNEL_LOGS_DISABLED_BY = actorId ? String(actorId) : null;
        conf.CHANNEL_LOGS_DISABLED_AT = new Date().toISOString();
        conf.CHANNEL_LOGS_REMINDER_DATE = null;
    } else {
        conf.CHANNEL_LOGS_ENABLED_AT = new Date().toISOString();
        conf.CHANNEL_LOGS_ENABLED_BY = actorId ? String(actorId) : 'system';
    }

    writeConfig(conf);

    if (!enabled) {
        await notifyChannelLogsDisabled(client, conf.CHANNEL_LOGS_DISABLED_BY || actorId);
        return { enabled: false, replayed: 0 };
    }

    const replayed = wasDisabled ? await flushQueuedChannelLogs(client) : 0;
    const embed = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('Canal de logs reativado')
        .setDescription([
            `Reativado por: ${actorId ? `<@${actorId}> (${actorId})` : 'Sistema automático'}`,
            `Motivo: ${reason}`,
            `Logs reenviados da fila: **${replayed}**`,
        ].join('\n'))
        .setTimestamp();
    await sendFixedChannelEmbed(client, embed);
    return { enabled: true, replayed };
}

async function handleReenableChannelLogsButton(interaction) {
    const conf = readConfig();
    const replyOptions = (content) => interaction.guild ? { content, ephemeral: true } : { content };
    if (conf.DISABLE_CHANNEL_LOGS !== true) {
        return interaction.reply(replyOptions('✅ O canal de logs já está ligado.'));
    }
    if (String(conf.CHANNEL_LOGS_DISABLED_BY || '') !== String(interaction.user.id)) {
        return interaction.reply(replyOptions('❌ Apenas quem desativou os logs pode usar este botão.'));
    }

    await interaction.deferReply(interaction.guild ? { ephemeral: true } : {});
    const result = await setChannelLogsEnabled(interaction.client, true, interaction.user.id, 'botao_dm');
    return interaction.editReply({ content: `✅ Canal de logs religado. Logs reenviados: ${result.replayed}.` });
}

async function runChannelLogRecoveryTick(client) {
    const conf = readConfig();
    if (conf.DISABLE_CHANNEL_LOGS !== true || !conf.CHANNEL_LOGS_DISABLED_BY) return false;

    const parts = getSaoPauloParts();
    const user = await client.users.fetch(conf.CHANNEL_LOGS_DISABLED_BY).catch(() => null);

    if (parts.hour === '19' && parts.minute === '00' && conf.CHANNEL_LOGS_REMINDER_DATE !== parts.dateKey) {
        conf.CHANNEL_LOGS_REMINDER_DATE = parts.dateKey;
        writeConfig(conf);
        if (user) {
            await user.send({
                content: '⚠️ Você desativou o canal de logs. Reative assim que possível.',
                components: [buildReenableLogButtonRow()],
            }).catch(() => null);
        }
        return true;
    }

    if (parts.hour === '20' && parts.minute === '00') {
        await setChannelLogsEnabled(client, true, null, 'reativacao_automatica_20h');
        return true;
    }

    return false;
}

let channelLogRecoveryInterval = null;
function initChannelLogRecovery(client) {
    if (channelLogRecoveryInterval) clearInterval(channelLogRecoveryInterval);
    channelLogRecoveryInterval = setInterval(() => {
        runChannelLogRecoveryTick(client).catch(() => null);
    }, 30 * 1000);
}

async function sendVortexLog(client, { title, description, color = '#7000FF', type = 'LOG', userId = null, channelId = null, relatedChannelIds = [] }) {
    if (!client) return false;

    syncStoredLogChannel();
    if (hasIgnoredRelatedChannel(channelId, relatedChannelIds)) return false;

    const logChannelId = getLogChannelId();
    const channelLogsDisabled = isChannelLogDisabled();
    const dmLogsDisabled = isDmLogDisabled();
    const payload = { title, description, color, type };
    const embed = buildLogEmbed(client, payload);

    const files = [];
    if (type === 'UPDATE' && fs.existsSync(VORTEX_BANNER_PATH)) {
        embed.setImage(`attachment://${VORTEX_BANNER_NAME}`);
        files.push(new AttachmentBuilder(VORTEX_BANNER_PATH, { name: VORTEX_BANNER_NAME }));
    }

    if (!channelLogsDisabled) {
        try {
            const channel = await client.channels.fetch(logChannelId).catch(() => null);
            if (channel?.isTextBased?.()) {
                await channel.send({
                    embeds: [embed],
                    files: files.length ? files : undefined,
                }).catch(() => channel.send({ embeds: [embed] }).catch(() => {}));
            }
        } catch (error) {}
    } else {
        await queueDisabledChannelLog(client, payload).catch(() => null);
    }

    if (userId && !dmLogsDisabled) {
        try {
            const user = await client.users.fetch(userId).catch(() => null);
            if (user) await user.send({ embeds: [embed] }).catch(() => {});
        } catch (error) {}
    }

    if (!dmLogsDisabled && (type === 'ALERTA' || type === 'MANUTENCAO' || type === 'MANUTENÇÃO')) {
        try {
            const superior = await client.users.fetch(SUPERIOR_ID).catch(() => null);
            if (superior) await superior.send({ embeds: [embed] }).catch(() => {});
        } catch (error) {}
    }

    return true;
}

async function sendAlertDm(client, { title, description, color = '#FF0055', type = 'ALERTA' }) {
    if (!client) return false;
    if (isDmLogDisabled()) return false;

    const iconURL = client.user?.displayAvatarURL?.() || null;
    const author = { name: `VORTEX | ${type}` };
    if (iconURL) author.iconURL = iconURL;

    const embed = new EmbedBuilder()
        .setAuthor(author)
        .setTitle(String(title || 'Alerta do Bot'))
        .setColor(color)
        .setDescription(String(description || 'Evento critico detectado.'))
        .setTimestamp()
        .setFooter({ text: 'Vortex Management System - Alerta DM' });

    await Promise.allSettled(
        ALERT_DM_USER_IDS.map(async (userId) => {
            const user = await client.users.fetch(userId).catch(() => null);
            if (user) await user.send({ embeds: [embed] }).catch(() => {});
        })
    );

    return true;
}

async function notifyBotDown(client, reason, context = 'Bot caiu') {
  const reasonText = reason instanceof Error
     ? `${reason.message}\n${reason.stack || ''}`.trim()
        : String(reason || 'Motivo não informado');

    const description = [
        '**Status:** alerta de queda/erro critico',
        `**Contexto:** ${context}`,
        `**Horario real:** ${formatDate(new Date())}`,
        '',
        '**Detalhes:**',
        `\`\`\`js\n${reasonText.slice(0, 1500)}\n\`\`\``,
    ].join('\n');

    await sendVortexLog(client, {
        title: 'Bot Caiu ou Gerou Erro Critico',
        description,
        color: '#FF0055',
        type: 'ALERTA',
    }).catch(() => {});

    return sendAlertDm(client, {
        title: 'VORTEX | BOT CAIU',
        description,
        color: '#FF0055',
        type: 'ALERTA',
    });
}

async function sendStaffLog(client, title, description, color = '#7000FF') {
    return sendVortexLog(client, { title, description, color, type: 'LOG' });
}

async function sendUpdateLog(client, title, description, color = '#00D9FF') {
    return sendVortexLog(client, { title, description, color, type: 'UPDATE' });
}

async function notifyError(client, error, context = '') {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return sendVortexLog(client, {
        title: 'ERRO NO SISTEMA',
        description: `**Contexto:** ${context || 'N/A'}\n**Erro:** \`\`\`js\n${errorMessage}\n\`\`\``,
        color: '#FF0055',
        type: 'ALERTA',
    });
}

async function notifyDmFailure(client, targetLabel, targetId, errorMessage, context = '') {
    return sendVortexLog(client, {
        title: 'Falha ao enviar DM',
        description: `**Destino:** ${targetLabel} (${targetId})\n**Contexto:** ${context || 'N/A'}\n**Erro:** ${errorMessage}`,
        color: '#FFA500',
        type: 'ALERTA',
    });
}

module.exports = {
    FIXED_LOG_CHANNEL,
    ALERT_DM_USER_IDS,
    getLogChannelId,
    isChannelLogDisabled,
    isDmLogDisabled,
    getDisabledLogChannelIds,
    isLogChannelIgnored,
    hasIgnoredRelatedChannel,
    setChannelLogsEnabled,
    handleReenableChannelLogsButton,
    initChannelLogRecovery,
    flushQueuedChannelLogs,
    sendVortexLog,
    sendAlertDm,
    sendStaffLog,
    sendUpdateLog,
    notifyError,
    notifyBotDown,
    notifyDmFailure,
};
