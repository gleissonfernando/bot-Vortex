const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');

// IDs atualizados conforme solicitação do usuário
const ERROR_LOG_CHANNEL_ID = '1497685822525149337'; // Canal das Logs (Real-time)
const UPDATE_LOG_CHANNEL_ID = '1497685822525149337'; // Unificando para o canal solicitado
const ERROR_ROLE_ID = '1497405005802635374';
const NOTIFY_USERS = ['289227932432334869', '761011766440230932']; // DMs dos Devs

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('Erro ao ler config.json:', err);
    }
    return { STAFF_CHANNEL_ID: '' };
}

/**
 * Envia um log para o canal de logs principal (Real-time)
 */
async function sendStaffLog(client, title, description, color = '#5865F2', fields = []) {
    try {
        const channel = await client.channels.fetch(ERROR_LOG_CHANNEL_ID).catch(() => null);
        if (channel) {
            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle(title)
                .setDescription(description)
                .setFooter({ text: 'Vortex Log System • Real-time' })
                .setTimestamp();
            
            if (fields.length > 0) embed.addFields(fields);
            
            await channel.send({ embeds: [embed] });
        }
    } catch (err) {
        console.error('Erro ao enviar log de staff:', err);
    }
}

/**
 * Envia um log de atualização para o canal específico de atualizações
 */
async function sendUpdateLog(client, title, description, color = '#3498DB') {
    try {
        const channel = await client.channels.fetch(UPDATE_LOG_CHANNEL_ID).catch(() => null);
        if (channel) {
            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle(`🔄 Atualização: ${title}`)
                .setDescription(description)
                .setFooter({ text: 'Vortex Update System' })
                .setTimestamp();
            
            await channel.send({ embeds: [embed] });
        }
    } catch (err) {
        console.error('Erro ao enviar log de atualização:', err);
    }
}

/**
 * Notifica sobre erros críticos (Cargo e DM)
 */
async function notifyError(client, error, context = '') {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = (error instanceof Error && error.stack) ? error.stack : 'N/A';
    
    console.error(`[ERRO CRÍTICO] ${context}: ${errorMessage}`);

    // 1. Enviar para o canal de log principal com marcação de cargo
    try {
        const channel = await client.channels.fetch(ERROR_LOG_CHANNEL_ID).catch(() => null);
        if (channel) {
            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('🚨 Erro Crítico Detectado')
                .setDescription(`**Contexto:** ${context}\n**Erro:** \`${errorMessage}\``)
                .addFields({ name: 'Stack Trace', value: `\`\`\`js\n${errorStack.slice(0, 1000)}\n\`\`\`` })
                .setTimestamp();
            
            await channel.send({ 
                content: `<@&${ERROR_ROLE_ID}>`, 
                embeds: [embed] 
            });
        }
    } catch (err) {
        console.error('Erro ao enviar notificação de erro no canal:', err);
    }

    // 2. Enviar DM para os desenvolvedores
    for (const userId of NOTIFY_USERS) {
        try {
            const user = await client.users.fetch(userId).catch(() => null);
            if (user) {
                const dmEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('⚠️ Alerta de Erro do Bot')
                    .setDescription(`Ocorreu um erro que requer atenção imediata.\n\n**Contexto:** ${context}\n**Erro:** ${errorMessage}`)
                    .setTimestamp();
                
                await user.send({ embeds: [dmEmbed] });
            }
        } catch (err) {
            console.error(`Erro ao enviar DM para ${userId}:`, err);
        }
    }
}

module.exports = {
    sendStaffLog,
    sendUpdateLog,
    notifyError
};
