const { SlashCommandBuilder } = require('discord.js');
const {
  getUserProfile,
  updateProfileLink,
  updateProfileLevel,
  buildProfileEmbed,
} = require('../../utils/profileManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('perfil')
    .setDescription('Mostra ou atualiza o perfil de um usuario aprovado no /set.')
    .addUserOption((option) =>
      option
        .setName('usuario')
        .setDescription('Usuario para consultar')
        .setRequired(false))
    .addStringOption((option) =>
      option
        .setName('link')
        .setDescription('Link da foto do perfil para atualizar')
        .setRequired(false))
    .addStringOption((option) =>
      option
        .setName('nivel')
        .setDescription('Numero do nivel em game para atualizar')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const target = interaction.options.getUser('usuario') || interaction.user;
    const link = interaction.options.getString('link');
    const nivel = interaction.options.getString('nivel');

    if ((link || nivel) && target.id !== interaction.user.id) {
      return interaction.editReply({
        content: '❌ Voce so pode atualizar o seu proprio perfil.',
      });
    }

    if (link) {
      const result = await updateProfileLink(interaction.guild, target, link, interaction.user.id);
      if (!result.ok) return interaction.editReply({ content: `❌ ${result.message}` });
    }

    if (nivel) {
      const result = await updateProfileLevel(interaction.guild, target, nivel, interaction.user.id);
      if (!result.ok) return interaction.editReply({ content: `❌ ${result.message}` });
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const profile = getUserProfile(interaction.guild.id, target.id);
    const embed = buildProfileEmbed({
      guild: interaction.guild,
      user: target,
      member,
      profile,
    });

    return interaction.editReply({ embeds: [embed] });
  },
};
