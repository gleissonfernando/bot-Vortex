const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');

// Função para carregar config dinâmica do painel
function getDynamicConfig() {
    try {
        const configPath = path.join(__dirname, '..', 'commands', 'config.json');
        if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
    } catch (err) {}
    return {};
}

/**
 * Envia um log detalhado e visual para o canal de staff (Vortex Style)
 */
async function sendStaffLog(client, title, description, color = '#2F3136', fields = []) {
    try {
        const dynamicConfig = getDynamicConfig();
        // Tenta usar o canal configurado no painel, se não houver, usa o fixo do config.js
        const channelId = dynamicConfig.LOG_CHANNEL || config.logsChannelId;
        
        if (!channelId) {
            console.error('[VORTEX LOG] Nenhum ID de canal de logs configurado.');
            return;
        }

        const channel = await client.channels.fetch(channelId).catch(() => null);
        
        if (!channel) {
            console.error(`[VORTEX LOG] Canal de logs (${channelId}) não encontrado.`);
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle(`📜 VORTEX LOG | ${title.toUpperCase()}`)
            .setColor(color)
            .setDescription(description)
            .setTimestamp()
            .setFooter({ text: 'Vortex Management System', iconURL: client.user.displayAvatarURL() });

        if (fields.length > 0) {
            embed.addFields(fields);
        }

        await channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('Erro ao enviar log para staff:', error);
    }
}

/**
 * Envia um log de atualização para o canal específico de atualizações
 */
async function sendUpdateLog(client, title, description, color = '#3498DB') {
    try {
        const dynamicConfig = getDynamicConfig();
        const channelId = dynamicConfig.LOG_CHANNEL || config.logsChannelId;
        
        if (!channelId) return;

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle(`🔄 VORTEX UPDATE | ${title.toUpperCase()}`)
            .setColor(color)
            .setDescription(description)
            .setTimestamp()
            .setFooter({ text: 'Vortex Update System', iconURL: client.user.displayAvatarURL() });
        
        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error('Erro ao enviar log de atualização:', err);
    }
}

/**
 * Notifica sobre erros críticos (Vortex Style)
 */
async function notifyError(client, error, context = '') {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = (error instanceof Error && error.stack) ? error.stack : 'N/A';
    
    console.error(`[VORTEX ERRO] ${context}: ${errorMessage}`);

    try {
        const dynamicConfig = getDynamicConfig();
        const channelId = dynamicConfig.LOG_CHANNEL || config.logsChannelId;
        
        if (!channelId) return;

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle('🚨 VORTEX | ALERTA DE ERRO')
            .setColor('#FF0000')
            .setDescription(`**Contexto:** ${context}\n**Erro:** \`${errorMessage}\``)
            .addFields({ name: 'Stack Trace', value: `\`\`\`js\n${errorStack.slice(0, 1000)}\n\`\`\`` })
            .setTimestamp()
            .setFooter({ text: 'Vortex Security Alert' });

        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error('Erro ao enviar notificação de erro no canal:', err);
    }
}

module.exports = {
    sendStaffLog,
    sendUpdateLog,
    notifyError
};
