const { Events, EmbedBuilder } = require('discord.js');
const config = require('../config/config');
const { logger } = require('../utils/logger');
const { logMemberJoin } = require('../utils/guildLogger');
const { sendStaffLog } = require('../utils/notifications');
const { getUserProfile } = require('../utils/profileManager');
const { applyApprovedHierarchy, applyPendingHierarchy, getVortexAutoRoles } = require('../utils/vortexHierarchy');
const { memberHasFactionHierarchyRole, updateFactionHierarchyPanel } = require('../utils/factionHierarchy');

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        try {
            const guild = member.guild;
            const client = guild.client;
            const existingProfile = getUserProfile(guild.id, member.id);
            let hierarchyText = '';

            try {
                if (existingProfile) {
                    const result = await applyApprovedHierarchy(member, 'Hierarquia Vortex: membro entrou com perfil aprovado');
                    const added = result.addedApproved.added.map((roleId) => `<@&${roleId}>`).join(' ') || '`Ja estava sincronizado`';
                    const failed = result.addedApproved.failed.map((roleId) => `<@&${roleId}>`).join(' ');
                    hierarchyText = `cadastro aprovado encontrado; cargo(s) aprovado(s): ${added}${failed ? `; falhou em: ${failed}` : ''}.`;
                } else {
                    const result = await applyPendingHierarchy(member);
                    if (!result.added.length && !result.failed.length && config.pendingRoleId) {
                        const pendingRole = await guild.roles.fetch(config.pendingRoleId).catch(() => null);
                        if (pendingRole) {
                            await member.roles.add(pendingRole).catch(() => {});
                        }
                    }
                    const added = result.added.map((roleId) => `<@&${roleId}>`).join(' ') || '`Ja estava sincronizado`';
                    const failed = result.failed.map((roleId) => `<@&${roleId}>`).join(' ');
                    hierarchyText = `cargo(s) pendente(s): ${added}${failed ? `; falhou em: ${failed}` : ''}.`;
                }
            } catch (error) {
                console.error('[VORTEX] Erro ao aplicar hierarquia automatica:', error.message);
                hierarchyText = `falha ao sincronizar cargos automaticamente: \`${error.message}\`.`;
            }

            const autoRoles = getVortexAutoRoles();

            await sendStaffLog(
                client,
                'Novo Membro',
                [
                    `**Usuario:** <@${member.id}>`,
                    `**Tag:** \`${member.user.tag}\``,
                    `**ID:** \`${member.id}\``,
                    '',
                    `**Acao automatica:** ${hierarchyText}`,
                    existingProfile
                        ? `**Perfil:** cadastro aprovado salvo no sistema. Cargo(s) aprovado(s) configurado(s): ${autoRoles.approved.map((roleId) => `<@&${roleId}>`).join(' ') || '`Nenhum`'}.`
                        : `**Proximo passo:** usuario precisa iniciar o cadastro pelo \`/set\`. Cargo(s) pendente(s) configurado(s): ${autoRoles.pending.map((roleId) => `<@&${roleId}>`).join(' ') || '`Nenhum`'}.`,
                ].join('\n'),
                '#57F287',
                { guildId: guild.id }
            );

            await logMemberJoin(guild, member).catch((error) => {
                logger.error('Erro ao registrar log de entrada:', error);
            });

            if (memberHasFactionHierarchyRole(member)) {
                await updateFactionHierarchyPanel(client, guild.id).catch((error) => {
                    logger.error('Erro ao atualizar hierarquia da fac apos entrada de membro:', error);
                });
            }

            try {
                const welcomeEmbed = new EmbedBuilder()
                    .setColor('#7000FF')
                    .setTitle(`Bem-vindo a Vortex, ${member.user.username}`)
                    .setDescription([
                        `Voce entrou no servidor **${guild.name}**.`,
                        '',
                        existingProfile ? '**Seu cadastro aprovado foi encontrado:**' : '**Para liberar seu acesso:**',
                        existingProfile
                            ? 'Seus cargos serao sincronizados automaticamente pelo sistema.'
                            : 'Use `/set` em um canal autorizado e preencha as informacoes solicitadas.',
                        '',
                        '**Depois da aprovacao:**',
                        'Seu cadastro fica salvo no sistema e voce pode usar `/perfil` para consultar ou atualizar seus dados.',
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
            } catch {
                // DM fechada ou indisponivel.
            }
        } catch (error) {
            console.error('[VORTEX] Erro no evento guildMemberAdd:', error.message);
        }
    },
};
