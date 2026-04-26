const { Events, EmbedBuilder } = require('discord.js');
const { sendUpdateLog } = require('../utils/notifications');

// ID do Proprietário/Gerência para receber DM (Seu ID)
const OWNER_ID = '761011766440230932'; 

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

        // 2. Notificação via DM para o Proprietário
        try {
            const owner = await client.users.fetch(OWNER_ID).catch(() => null);
            if (owner) {
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

                await owner.send({ embeds: [dmEmbed] });
                console.log(`✅ DM de inicialização enviada para ${owner.tag}`);
            }
        } catch (error) {
            console.error('Erro ao enviar DM de inicialização:', error);
        }
    },
};
