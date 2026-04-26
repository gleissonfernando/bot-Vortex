const { Events } = require('discord.js');
const { logger } = require('../utils/logger');
const config = require('../config/config');
const { sendStaffLog } = require('../utils/notifications');

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        try {
            const guild = member.guild;
            logger.info(`Novo membro: ${member.user.username} entrou em ${guild.name}`);

            // Adicionar cargo automático (Pendente)
            try {
                const pendingRole = await guild.roles.fetch(config.pendingRoleId);
                if (pendingRole) {
                    await member.roles.add(pendingRole);
                    logger.info(`Cargo pendente (${config.pendingRoleId}) aplicado a ${member.user.username}`);
                }
            } catch (error) {
                logger.error(`Erro ao aplicar cargo pendente:`, error);
            }

            // Log de entrada
            await sendStaffLog(
                guild.client,
                '📥 Novo Membro',
                `O usuário <@${member.id}> (\`${member.user.tag}\`) entrou no servidor e recebeu o cargo pendente.`,
                '#57F287'
            );

        } catch (error) {
            logger.error('Erro no evento guildMemberAdd:', error);
        }
    },
};
