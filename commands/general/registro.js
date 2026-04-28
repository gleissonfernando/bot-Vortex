const { SlashCommandBuilder } = require('discord.js');
const { buildUserRegistroEmbed } = require('../../utils/pontoReport');
const { sendVortexLog } = require('../../utils/notifications');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('registro')
    .setDescription('Mostra o registro de ponto de um usuário.')
    .addUserOption(option =>
      option
        .setName('usuario')
        .setDescription('Use @ para consultar outro usuário')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const target = interaction.options.getUser('usuario') || interaction.user;
    const embed = await buildUserRegistroEmbed(interaction.guild, target);

    sendVortexLog(interaction.client, {
      title: 'Registro de Ponto Consultado',
      description: [
        `**Comando:** /registro`,
        `**Usado por:** <@${interaction.user.id}> (${interaction.user.id})`,
        `**Usuário consultado:** <@${target.id}> (${target.id})`,
        `**Canal:** ${interaction.channel ? `<#${interaction.channel.id}>` : 'N/A'}`,
      ].join('\n'),
      color: '#7000FF',
      type: 'PONTO',
      userId: interaction.user.id,
    }).catch(() => {});

    return interaction.editReply({ embeds: [embed] });
  },
};
