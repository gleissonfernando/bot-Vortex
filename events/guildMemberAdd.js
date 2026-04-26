const { Events, EmbedBuilder } = require('discord.js');
const config = require('../config/config');
const { sendStaffLog } = require('../utils/notifications');

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        try {
            const guild = member.guild;
            const client = guild.client;
            
            // Adicionar cargo automático (Pendente)
            try {
                const pendingRole = await guild.roles.fetch(config.pendingRoleId).catch(() => null);
                if (pendingRole) {
                    await member.roles.add(pendingRole).catch(() => {});
                }
            } catch (error) {
                console.error(`[VORTEX] Erro ao aplicar cargo pendente:`, error.message);
            }

            // Log de entrada profissional
            await sendStaffLog(
                client,
                '📥 Novo Membro',
                `**Usuário:** <@${member.id}>\n**Tag:** \`${member.user.tag}\`\n**ID:** \`${member.id}\`\n\nO usuário entrou no servidor e recebeu o cargo pendente automaticamente.`,
                '#57F287'
            );

            // Enviar mensagem de Boas-vindas via DM
            try {
                const welcomeEmbed = new EmbedBuilder()
                    .setColor('#7000FF')
                    .setTitle(`✨ Bem-vindo à Vortex, ${member.user.username}!`)
                    .setDescription(`Olá! Ficamos felizes em ter você conosco no servidor **${guild.name}**.\n\nPara iniciar seu processo de recrutamento ou solicitar seu set, utilize o comando \`/set\` em um dos canais autorizados.\n\nBoa sorte!`)
                    .setThumbnail(guild.iconURL({ dynamic: true }) || client.user.displayAvatarURL())
                    .setTimestamp()
                    .setFooter({ text: 'Vortex Management System' });

                await member.send({ embeds: [welcomeEmbed] }).catch(() => {});
            } catch (dmError) {
                // Silencioso se DMs estiverem fechadas
            }
        } catch (error) {
            console.error('[VORTEX] Erro no evento guildMemberAdd:', error.message);
        }
    },
};
