const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const SUPERIOR_ID = '1497703127074345040';

/**
 * Obtém o ID do canal de logs com prioridade absoluta.
 */
function getLogChannelId() {
    const FIXED_LOG_CHANNEL = '1497380031016599603';
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            if (data.LOG_CHANNEL && data.LOG_CHANNEL.length > 5) {
                return String(data.LOG_CHANNEL);
            }
        }
    } catch (err) {}
    return FIXED_LOG_CHANNEL;
}

/**
 * Envia um log profissional e também notifica via DM se solicitado.
 */
async function sendVortexLog(client, { title, description, color = '#7000FF', type = 'LOG', userId = null }) {
    const channelId = getLogChannelId();
    if (!client) return;

    const embed = new EmbedBuilder()
        .setAuthor({ name: `VORTEX | ${type}`, iconURL: client.user.displayAvatarURL() })
        .setTitle(`📜 ${String(title).toUpperCase()}`)
        .setColor(color)
        .setDescription(String(description))
        .setTimestamp()
        .setFooter({ text: 'Vortex Management System • Monitoramento' });

    // 1. Enviar para o Canal de Logs
    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel) {
            await channel.send({ embeds: [embed] }).catch(() => {});
        }
    } catch (err) {}

    // 2. Enviar para a DM do Usuário (se fornecido)
    if (userId) {
        try {
            const user = await client.users.fetch(userId).catch(() => null);
            if (user) {
                await user.send({ embeds: [embed] }).catch(() => {});
            }
        } catch (err) {}
    }

    // 3. Enviar para a DM da Gerência Superior (opcional, mas recomendado para logs críticos)
    if (type === 'ALERTA' || type === 'MANUTENÇÃO') {
        try {
            const superior = await client.users.fetch(SUPERIOR_ID).catch(() => null);
            if (superior) {
                await superior.send({ embeds: [embed] }).catch(() => {});
            }
        } catch (err) {}
    }
}

/**
 * Atalhos para funções específicas
 */
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
        description: `**Contexto:** ${context}\n**Erro:** \`\`\`js\n${errorMessage}\n\`\`\``, 
        color: '#FF0055', 
        type: 'ALERTA' 
    });
}

module.exports = { sendVortexLog, sendStaffLog, sendUpdateLog, notifyError };
