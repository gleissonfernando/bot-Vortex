const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');

const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');

function getLogChannelId() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            if (data.LOG_CHANNEL) return String(data.LOG_CHANNEL);
        }
    } catch (err) {}
    return config.logsChannelId ? String(config.logsChannelId) : null;
}

/**
 * Envia um log profissional estilo VORTEX
 */
async function sendStaffLog(client, title, description, color = '#7000FF') {
    const channelId = getLogChannelId();
    if (!channelId || !client) return;

    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setAuthor({ name: 'VORTEX | LOG SYSTEM', iconURL: client.user.displayAvatarURL() })
            .setTitle(`📜 ${String(title).toUpperCase()}`)
            .setColor(color)
            .setDescription(String(description))
            .setTimestamp()
            .setFooter({ text: 'Vortex Management System • Monitoramento' });

        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (error) {}
}

/**
 * Envia um log de atualização ou status
 */
async function sendUpdateLog(client, title, description, color = '#00D9FF') {
    const channelId = getLogChannelId();
    if (!channelId || !client) return;

    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setAuthor({ name: 'VORTEX | UPDATE', iconURL: client.user.displayAvatarURL() })
            .setTitle(`🔄 ${String(title).toUpperCase()}`)
            .setColor(color)
            .setDescription(String(description))
            .setTimestamp()
            .setFooter({ text: 'Vortex Management System • Status' });
        
        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {}
}

/**
 * Notifica erros críticos no canal de logs
 */
async function notifyError(client, error, context = '') {
    const channelId = getLogChannelId();
    if (!channelId || !client) return;

    const errorMessage = error instanceof Error ? error.message : String(error);

    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setAuthor({ name: 'VORTEX | ALERTA CRÍTICO', iconURL: client.user.displayAvatarURL() })
            .setTitle('🚨 ERRO NO SISTEMA')
            .setColor('#FF0055')
            .setDescription(`**Contexto:** ${String(context)}\n**Erro:** \`\`\`js\n${errorMessage}\n\`\`\``)
            .setTimestamp()
            .setFooter({ text: 'Vortex Security • Alerta de Erro' });

        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {}
}

module.exports = { sendStaffLog, sendUpdateLog, notifyError };
