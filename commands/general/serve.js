const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUserPoint, getEffectiveTotalMs, formatDuration, formatDate } = require('../../utils/pontoManager');
const { safeDeferReply, safeEdit } = require('../../utils/safeReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serve')
    .setDescription('Mostra os dados de servidor de um usuário.')
    .addUserOption(option =>
      option
        .setName('usuario')
        .setDescription('Usuário para consultar')
        .setRequired(false)),

  async execute(interaction) {
    await safeDeferReply(interaction, { ephemeral: true });

    const target = interaction.options.getUser('usuario') || interaction.user;
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const data = await getUserPoint(interaction.guild.id, target.id);

    const embed = new EmbedBuilder()
      .setColor('#00D9FF')
      .setTitle('Dados do Servidor')
      .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields(
        { name: 'Discord', value: `<@${target.id}>`, inline: true },
        { name: 'Discord ID', value: `\`${target.id}\``, inline: true },
        { name: 'Entrou no Discord', value: member?.joinedAt ? formatDate(member.joinedAt) : 'N/A', inline: false },
        { name: 'Total em ponto', value: formatDuration(getEffectiveTotalMs(data)), inline: true },
        { name: 'Status do ponto', value: data.activePointStartedAt ? 'Aberto' : 'Fechado', inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'Vortex - Dados do Servidor' });

    return safeEdit(interaction, { embeds: [embed] });
  },
};
