const { Events, EmbedBuilder } = require('discord.js');
const { sendVortexLog } = require('../utils/notifications');

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        const { guild, user } = member;
        const client = guild.client;

        // 1. Log de Entrada no Canal de Logs
        await sendVortexLog(client, {
            title: 'Entrada de Membro',
            description: `**Usuário:** <@${user.id}>\n**Tag:** \`${user.tag}\`\n**ID:** \`${user.id}\`\n**Conta criada em:** <t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
            color: '#57F287',
            type: 'ENTRADA'
        });

        // 2. Mensagem de Boas-vindas via DM
        const welcomeEmbed = new EmbedBuilder()
            .setTitle(`✨ Bem-vindo à Vortex, ${user.username}!`)
            .setColor('#7000FF')
            .setDescription(`Olá! Ficamos muito felizes em ter você conosco no servidor **${guild.name}**.\n\n### 🚀 Como começar?\nPara solicitar seu set e iniciar seu recrutamento, utilize o comando \`/set\` no servidor.\n\nQualquer dúvida, procure um membro da nossa equipe de Staff.`)
            .setThumbnail(guild.iconURL({ dynamic: true }) || user.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: 'Vortex Management System • Boas-vindas' })
            .setTimestamp();

        try {
            await user.send({ embeds: [welcomeEmbed] });
        } catch (err) {
            console.log(`[VORTEX] Não foi possível enviar DM de boas-vindas para ${user.tag} (DMs fechadas).`);
        }
    }
};
