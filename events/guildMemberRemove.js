const { Events } = require('discord.js');
const { logger } = require('../utils/logger');
const { logMemberLeave } = require('../utils/guildLogger');
const { sendStaffLog } = require('../utils/notifications');
const { deleteApprovedSetChannel } = require('../utils/approvedSetChannels');
const { deleteUserProfile } = require('../utils/profileManager');
const { memberHasFactionHierarchyRole, updateFactionHierarchyPanel } = require('../utils/factionHierarchy');
const { isMaintenanceMode } = require('../utils/maintenanceMode');

const SUPPORT_USER_ID = '289227932432334869';

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member) {
        if (isMaintenanceMode()) return;

        try {
            const guild = member.guild;

            logger.info(`Membro saiu: ${member.user.username} do servidor ${guild.name}`);

            await sendStaffLog(
                guild.client,
                'Despedida de Membro',
                [
                    `**Usuário:** <@${member.id}>`,
                    `**Tag:** \`${member.user.tag}\``,
                    `**ID:** \`${member.id}\``,
                    '',
                    'O usuário saiu do servidor. Desejamos boa sorte na caminhada.',
                    `Se qualquer coisa tiver acontecido ou se precisar conversar, entre em contato com <@${SUPPORT_USER_ID}> Duke | henryP1.`,
                ].join('\n'),
                '#ED4245',
                { guildId: guild.id }
            );

            await logMemberLeave(guild, member).catch((error) => {
                logger.error('Erro ao registrar log de saida:', error);
            });

            await deleteApprovedSetChannel(guild, member.id).catch((error) => {
                logger.error('Erro ao remover canal de usuário aprovado:', error);
            });

            await deleteUserProfile(guild, member.id, `Usuário ${member.id} saiu do servidor; perfil e call removidos.`).catch((error) => {
                logger.error('Erro ao remover perfil/call de usuário que saiu:', error);
            });

            if (memberHasFactionHierarchyRole(member)) {
                await updateFactionHierarchyPanel(guild.client, guild.id).catch((error) => {
                    logger.error('Erro ao atualizar hierarquia da fac apos saida de membro:', error);
                });
            }
        } catch (error) {
            logger.error('Erro no evento guildMemberRemove:', error);
        }
    },
};
