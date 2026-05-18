const { Events, EmbedBuilder } = require('discord.js');
const config = require('../config/config');
const { logger } = require('../utils/logger');
const { logMemberJoin } = require('../utils/guildLogger');
const { sendStaffLog } = require('../utils/notifications');
const { applyPendingHierarchy, getVortexAutoRoles } = require('../utils/vortexHierarchy');

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        try {
            const guild = member.guild;
            const client = guild.client;
            
            // Adicionar cargos automáticos de entrada configurados no /painel.
            try {
                const result = await applyPendingHierarchy(member);
                if (!result.added.length && !result.failed.length && config.pendingRoleId) {
                    const pendingRole = await guild.roles.fetch(config.pendingRoleId).catch(() => null);
                    if (pendingRole) {
                        await member.roles.add(pendingRole).catch(() => {});
                    }
                }
            } catch (error) {
                console.error(`[VORTEX] Erro ao aplicar cargo pendente:`, error.message);
            }

            const autoRoles = getVortexAutoRoles();

            // Log de entrada profissional
            await sendStaffLog(
                client,
                '📥 Novo Membro',
                [
                    `**Usuário:** <@${member.id}>`,
                    `**Tag:** \`${member.user.tag}\``,
                    `**ID:** \`${member.id}\``,
                    '',
                    `**Ação automática:** cargo(s) pendente(s) aplicado(s): ${autoRoles.pending.map((roleId) => `<@&${roleId}>`).join(' ') || '`Nenhum`'}.`,
                    '**Próximo passo:** usuário precisa iniciar o cadastro pelo `/set`.',
                ].join('\n'),
                '#57F287',
                { guildId: guild.id }
            );

            await logMemberJoin(guild, member).catch((error) => {
                logger.error('Erro ao registrar log de entrada:', error);
            });

            // Enviar mensagem de Boas-vindas via DM
            try {
                const welcomeEmbed = new EmbedBuilder()
                    .setColor('#7000FF')
                    .setTitle(`Bem-vindo à Vortex, ${member.user.username}`)
                    .setDescription([
                        `Você entrou no servidor **${guild.name}**.`,
                        '',
                        '**Para liberar seu acesso:**',
                        'Use `/set` em um canal autorizado e preencha as informações solicitadas.',
                        '',
                        '**Depois da aprovação:**',
                        'Seu cadastro ficará salvo no sistema e você poderá usar `/perfil` para consultar ou atualizar seus próprios dados.',
                        '',
                        'Se tiver problema com o cadastro, procure a equipe no servidor.',
                    ].join('\n'))
                    .setThumbnail(guild.iconURL({ dynamic: true }) || client.user.displayAvatarURL())
                    .setTimestamp()
                    .setFooter({ text: 'Vortex Management System - Cadastro' });

                await member.send({
                    embeds: [welcomeEmbed],
                    allowedMentions: { parse: [], users: [], roles: [] },
                }).catch(() => {});
            } catch (dmError) {
                // Silencioso se DMs estiverem fechadas
            }
        } catch (error) {
            console.error('[VORTEX] Erro no evento guildMemberAdd:', error.message);
        }
    },
};
