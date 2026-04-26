const { EmbedBuilder } = require('discord.js');
const config = require('../config/config');

let discordClient = null;

function setDiscordClient(client) {
    discordClient = client;
}

async function sendLogToDashboard(payload = {}) {
    try {
        if (!discordClient || !discordClient.channels) {
            return false;
        }

        const logsChannelId = config.logsChannelId || '1497380031016599603';
        if (!logsChannelId) return false;

        const channel = await discordClient.channels.fetch(logsChannelId).catch(() => null);
        if (!channel || !channel.isTextBased()) return false;

        const {
            title = 'Log do Sistema',
            description = 'Evento registrado.',
            type = 'info',
            userId,
            userName,
            color = 0x5865F2,
            footer = 'Bot Size',
            imageUrl,
            fields = []
        } = payload;

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`📌 ${title}`)
            .setDescription(description)
            .addFields(
                { name: 'Tipo', value: String(type), inline: true },
                { name: 'Usuário', value: userId ? `<@${userId}>` : (userName || 'N/A'), inline: true }
            )
            .setTimestamp()
            .setFooter({ text: footer });

        if (Array.isArray(fields) && fields.length) {
            embed.addFields(fields.slice(0, 25));
        }

        if (imageUrl) {
            embed.setImage(imageUrl);
        }

        await channel.send({ embeds: [embed] });
        return true;
    } catch (error) {
        return false;
    }
}

module.exports = {
    setDiscordClient,
    sendLogToDashboard
};
