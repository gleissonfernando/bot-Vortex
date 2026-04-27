const { Events, EmbedBuilder } = require('discord.js');
const { ALERT_DM_USER_IDS, sendUpdateLog } = require('../utils/notifications');
const { notifyBotUpdate } = require('../src/services/updateNotifier');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`🚀 VORTEX | Bot Online! Logado como ${client.user.tag}`);

        await notifyBotUpdate(client);
        
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

        // 2. Notificação via DM para os administradores de alerta
        try {
            const dmEmbed = new EmbedBuilder()
                .setTitle('🚀 VORTEX | SISTEMA LIGADO')
                .setColor('#57F287')
                .setDescription('O bot da **Vortex** acabou de ser iniciado e já está pronto para uso.')
                .addFields(
                    { name: 'Status', value: '🟢 Online', inline: true },
                    { name: 'Horário', value: new Date().toLocaleString('pt-BR'), inline: true }
                )
                .setFooter({ text: 'Vortex Management System' })
                .setTimestamp();

            await Promise.allSettled(
                ALERT_DM_USER_IDS.map(async (userId) => {
                    const user = await client.users.fetch(userId).catch(() => null);
                    if (user) await user.send({ embeds: [dmEmbed] }).catch(() => {});
                })
            );
            console.log('✅ DMs de inicialização enviadas para administradores de alerta');
        } catch (error) {
            console.error('Erro ao enviar DM de inicialização:', error);
        }
    },
};
