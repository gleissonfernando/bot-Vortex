const { Events, EmbedBuilder } = require("discord.js");
const { sendVortexLog } = require("../utils/notifications");

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member) {
        const { guild, user } = member;
        const client = guild.client;

        // 1. Log de Saída no Canal de Logs
        await sendVortexLog(client, {
            title: "Saída de Membro",
            description: `**Usuário:** <@${user.id}>\n**Tag:** \`${user.tag}\`\n**ID:** \`${user.id}\`\n\nO usuário deixou o servidor.`,
            color: "#ED4245",
            type: "SAÍDA"
        });

        // 2. Mensagem de Despedida via DM
        const leaveEmbed = new EmbedBuilder()
            .setTitle(`👋 Até logo, ${user.username}`)
            .setColor("#ED4245")
            .setDescription(`Vimos que você saiu do servidor **${guild.name}**.\n\nCaso tenha sido por engano ou queira voltar no futuro, as portas estarão sempre abertas.\n\nAgradecemos o tempo que passou conosco!`)
            .setThumbnail(guild.iconURL({ dynamic: true }) || user.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: "Vortex Management System • Despedida" })
            .setTimestamp();

        try {
            await user.send({ embeds: [leaveEmbed] });
        } catch (err) {
            console.log(`[VORTEX] Não foi possível enviar DM de saída para ${user.tag} (DMs fechadas).`);
        }
    }
};
