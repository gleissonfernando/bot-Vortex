const { Events } = require('discord.js');
const { sendUpdateLog } = require('../utils/notifications');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`🚀 Bot Online! Logado como ${client.user.tag}`);
        
        // Log de Inicialização no Canal de Logs
        try {
            await sendUpdateLog(
                client, 
                'Bot Ligado', 
                'O bot da **Size** foi iniciado com sucesso e está operacional.', 
                '#57F287'
            );
        } catch (error) {
            console.error('Erro ao enviar log de inicialização:', error);
        }
    },
};
