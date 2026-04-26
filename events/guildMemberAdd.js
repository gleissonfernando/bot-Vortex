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

            // Enviar mensagem de Boas-vindas via DM
            try {
                const welcomeEmbed = new EmbedBuilder()
                    .setColor('#D4AF37')
                    .setTitle(`✨ Bem-vindo à Vortex, ${member.user.username}!`)
                    .setDescription(`Olá! Ficamos felizes em ter você conosco no servidor **${guild.name}**.\n\nPara iniciar seu processo de recrutamento ou solicitar seu set, utilize o comando \`/set\` em um dos canais autorizados.\n\nBoa sorte!`)
                    .setThumbnail(guild.iconURL({ dynamic: true }))
                    .setTimestamp();

                await member.send({ embeds: [welcomeEmbed] });
                logger.info(`Mensagem de boas-vindas enviada via DM para ${member.user.username}`);
            } catch (dmError) {
                logger.warn(`Não foi possível enviar DM para ${member.user.username} (DMs fechadas).`);
            }

        } catch (error) {
            logger.error('Erro no evento guildMemberAdd:', error);
        }
    },
};
