const { Events } = require('discord.js');
const { sendUpdateLog } = require('../utils/notifications');
const { syncTextChannelAccess } = require('../utils/textChannelAccess');
const { syncVoiceChannelAccess } = require('../utils/voiceChannelAccess');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`🚀 VORTEX | Bot Online! Logado como ${client.user.tag}`);
        
        // 1. Log de Inicialização no Canal de Logs
        try {
            await sendUpdateLog(
                client, 
                'Bot Vortex Online', 
                'O sistema da **Vortex** foi iniciado com sucesso e todos os módulos estão operacionais.', 
                '#57F287'
            );
        } catch (error) {
            console.error('Erro ao enviar log de inicialização no canal:', error);
        }

        try {
            await Promise.allSettled(
                client.guilds.cache.map((guild) => syncVoiceChannelAccess(guild))
            );
        } catch (error) {
            console.error('Erro ao sincronizar acesso às calls ocultas:', error);
        }

        try {
            await Promise.allSettled(
                client.guilds.cache.map((guild) => syncTextChannelAccess(guild))
            );
        } catch (error) {
            console.error('Erro ao sincronizar acesso aos canais de texto:', error);
        }
    },
};
