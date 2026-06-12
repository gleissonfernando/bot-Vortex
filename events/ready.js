const { Events } = require('discord.js');
const { sendUpdateLog } = require('../utils/notifications');
const { syncTextChannelAccess } = require('../utils/textChannelAccess');
const { syncVoiceChannelAccess } = require('../utils/voiceChannelAccess');
const { isPrimaryGuild } = require('../utils/guildScope');
const { initFrequencyDashboardSync } = require('../utils/frequencyDashboardSync');
const { initFactionHierarchyAutoRefresh } = require('../utils/factionHierarchy');
const { syncAntiDisconnectLockdown } = require('../utils/antiAbuseManager');

const SYNC_CHANNEL_ACCESS_ON_READY = process.env.SYNC_CHANNEL_ACCESS_ON_READY !== 'false';

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

        if (SYNC_CHANNEL_ACCESS_ON_READY) {
            try {
                await Promise.allSettled(
                    client.guilds.cache
                        .filter((guild) => isPrimaryGuild(guild.id))
                        .map((guild) => syncVoiceChannelAccess(guild))
                );
            } catch (error) {
                console.error('Erro ao sincronizar acesso às calls ocultas:', error);
            }

            try {
                await Promise.allSettled(
                    client.guilds.cache
                        .filter((guild) => isPrimaryGuild(guild.id))
                        .map((guild) => syncTextChannelAccess(guild))
                );
            } catch (error) {
                console.error('Erro ao sincronizar acesso aos canais de texto:', error);
            }
        } else {
            console.log('[VORTEX] Sync inicial de canais desativado para reduzir uso no startup.');
        }

        try {
            await Promise.allSettled(
                client.guilds.cache
                    .filter((guild) => isPrimaryGuild(guild.id))
                    .map((guild) => syncAntiDisconnectLockdown(guild))
            );
        } catch (error) {
            console.error('Erro ao sincronizar trava Anti-Abuso de disconnect:', error);
        }

        initFrequencyDashboardSync(client);
        initFactionHierarchyAutoRefresh(client);
    },
};
