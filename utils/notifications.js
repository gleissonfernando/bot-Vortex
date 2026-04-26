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

async function sendStaffLog(client, title, description, color = '#2F3136') {
    const channelId = getLogChannelId();
    if (!channelId || !client) return;

    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle(`📜 VORTEX LOG | ${String(title).toUpperCase()}`)
            .setColor(color)
            .setDescription(String(description))
            .setTimestamp()
            .setFooter({ text: 'Vortex Management System' });

        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (error) {}
}

async function sendUpdateLog(client, title, description, color = '#3498DB') {
    const channelId = getLogChannelId();
    if (!channelId || !client) return;

    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle(`🔄 VORTEX UPDATE | ${String(title).toUpperCase()}`)
            .setColor(color)
            .setDescription(String(description))
            .setTimestamp()
            .setFooter({ text: 'Vortex System' });
        
        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {}
}

async function notifyError(client, error, context = '') {
    const channelId = getLogChannelId();
    if (!channelId || !client) return;

    const errorMessage = error instanceof Error ? error.message : String(error);

    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle('🚨 VORTEX | ALERTA DE ERRO')
            .setColor('#FF0000')
            .setDescription(`**Contexto:** ${String(context)}\n**Erro:** \`${errorMessage}\``)
            .setTimestamp();

        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {}
}

module.exports = { sendStaffLog, sendUpdateLog, notifyError };
