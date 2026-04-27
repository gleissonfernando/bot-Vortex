const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const VORTEX_BANNER_PATH = path.join(__dirname, '..', 'foto', 'IMG_4234.png');
const VORTEX_BANNER_NAME = 'IMG_4234.png';
const FIXED_LOG_CHANNEL = '1497685822525149337';
const SUPERIOR_ID = '1497703127074345040';
const ALERT_DM_USER_IDS = [
    '1426287249020158018',
    '289227932432334869',
    '761011766440230932',
];

function getLogChannelId() {
    return FIXED_LOG_CHANNEL;
}

function readConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return {};
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8') || '{}');
    } catch {
        return {};
    }
}

function isChannelLogDisabled() {
    return readConfig().DISABLE_CHANNEL_LOGS === true;
}

function isDmLogDisabled() {
    return readConfig().DISABLE_DM_LOGS === true;
}

function syncStoredLogChannel() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return;

        const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        if (data.LOG_CHANNEL === FIXED_LOG_CHANNEL) return;

        data.LOG_CHANNEL = FIXED_LOG_CHANNEL;
        fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    } catch (error) {
        // Falha de sincronização nao pode impedir o envio dos logs.
    }
}

async function sendVortexLog(client, { title, description, color = '#7000FF', type = 'LOG', userId = null }) {
    if (!client) return false;

    syncStoredLogChannel();
    const channelId = getLogChannelId();
    const channelLogsDisabled = isChannelLogDisabled();
    const dmLogsDisabled = isDmLogDisabled();
    const iconURL = client.user?.displayAvatarURL?.() || null;

    const author = { name: `VORTEX | ${type}` };
    if (iconURL) author.iconURL = iconURL;

    const embed = new EmbedBuilder()
        .setAuthor(author)
        .setTitle(`LOG | ${String(title).toUpperCase()}`)
        .setColor(color)
        .setDescription(String(description || 'Evento registrado.'))
        .setTimestamp()
        .setFooter({ text: 'Vortex Management System - Monitoramento' });

    const files = [];
    if (type === 'UPDATE' && fs.existsSync(VORTEX_BANNER_PATH)) {
        embed.setImage(`attachment://${VORTEX_BANNER_NAME}`);
        files.push(new AttachmentBuilder(VORTEX_BANNER_PATH, { name: VORTEX_BANNER_NAME }));
    }

    if (!channelLogsDisabled) {
        try {
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (channel?.isTextBased?.()) {
                await channel.send({
                    embeds: [embed],
                    files: files.length ? files : undefined,
                }).catch(() => channel.send({ embeds: [embed] }).catch(() => {}));
            }
        } catch (error) {}
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
        : String(reason || 'Motivo nao informado');

    const description = [
        '**Status:** alerta de queda/erro critico',
        `**Contexto:** ${context}`,
        `**Horario:** ${new Date().toLocaleString('pt-BR')}`,
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
    sendVortexLog,
    sendAlertDm,
    sendStaffLog,
    sendUpdateLog,
    notifyError,
    notifyBotDown,
    notifyDmFailure,
};
