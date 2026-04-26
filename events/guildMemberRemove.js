const { Events } = require('discord.js');
const { sendStaffLog } = require('../utils/notifications');

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member) {
        try {
            const guild = member.guild;
            const client = guild.client;

            // Log de saída profissional
            await sendStaffLog(
                client,
                '🚪 Membro Saiu',
                `**Usuário:** <@${member.id}>\n**Tag:** \`${member.user.tag}\`\n**ID:** \`${member.id}\`\n\nO usuário saiu do servidor.`,
                '#ED4245'
            );
        } catch (error) {
            console.error('[VORTEX] Erro no evento guildMemberRemove:', error.message);
        }
    },
};
