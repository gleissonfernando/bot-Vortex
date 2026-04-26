const { Events, EmbedBuilder } = require('discord.js');
const { logger } = require('../utils/logger');
const { getGuildConfig, processMessageVariables } = require('../utils/configManager');
const { logMemberJoin } = require('../utils/guildLogger');
const { sendStaffLog } = require('../utils/notifications');

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        try {
            const guild = member.guild;
            logger.info(`Novo membro: ${member.user.username} entrou em ${guild.name}`);

            // Log em tempo real
            await sendStaffLog(
                guild.client,
                '📥 Novo Membro',
                `O usuário <@${member.id}> (\`${member.user.tag}\`) entrou no servidor.`,
                '#57F287'
            );

            // 1. Buscar configurações do servidor
            const config = await getGuildConfig(guild.id);

            // 2. Verificar se o bot está ativado
            if (!config.botEnabled) {
                logger.warn(`Bot desativado em ${guild.name}`);
                return;
            }

            // 3. Verificar se há canal de boas-vindas
            if (!config.welcomeChannelId) {
                logger.warn(`Canal de boas-vindas não configurado em ${guild.name}`);
                return;
            }

            // 4. Buscar o canal
            let channel;
            try {
                channel = guild.channels.cache.get(config.welcomeChannelId) || 
                          await guild.channels.fetch(config.welcomeChannelId);
            } catch (error) {
                logger.error(`Canal de boas-vindas não encontrado em ${guild.name}:`, error.message);
                return;
            }

            if (!channel) {
                logger.error(`Canal de boas-vindas inválido em ${guild.name}`);
                return;
            }

            // 5. Verificar permissões do bot
            if (!channel.permissionsFor(guild.members.me).has('SendMessages')) {
                logger.error(`Bot sem permissão para enviar mensagens em ${channel.name}`);
                return;
            }

            // 6. Processar mensagem de boas-vindas
            const welcomeMessage = processMessageVariables(
                config.welcomeMessage,
                member.user,
                guild
            );

            // 7. Criar embed de boas-vindas
            const embed = new EmbedBuilder()
                .setTitle(`🎉 Bem-vindo ao ${guild.name}!`)
                .setDescription(welcomeMessage)
                .setColor(0x00ff00) // Verde
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: 'Usuário', value: member.user.username, inline: true },
                    { name: 'ID', value: member.id, inline: true },
                    { name: 'Membros Totais', value: guild.memberCount.toString(), inline: true }
                )
                .setFooter({ text: `Magnatas.gg • ${new Date().toLocaleDateString('pt-BR')}` })
                .setTimestamp();

            // 8. Enviar mensagem
            await channel.send({ embeds: [embed] });
            logger.info(`Mensagem de boas-vindas enviada para ${member.user.username} em ${guild.name}`);

            // 9. Registrar no log do servidor
            try {
                await logMemberJoin(guild, member);
            } catch (logError) {
                logger.error(`Erro ao registrar log de entrada:`, logError.message);
            }

            // 9. Aplicar cargo de verificação se configurado
            if (config.verifyRoleId) {
                try {
                    const role = guild.roles.cache.get(config.verifyRoleId) || 
                                 await guild.roles.fetch(config.verifyRoleId);
                    if (role) {
                        await member.roles.add(role);
                        logger.info(`Cargo de verificação aplicado a ${member.user.username}`);
                    }
                } catch (error) {
                    logger.error(`Erro ao aplicar cargo de verificação:`, error.message);
                }
            }

        } catch (error) {
            logger.error('Erro no evento guildMemberAdd:', error);
        }
    },
};
