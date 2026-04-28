const { SlashCommandBuilder } = require('discord.js');
const {
  getUserProfile,
  updateProfileLink,
  updateProfileLevel,
  buildProfileEmbed,
} = require('../../utils/profileManager');
const { hasVortexLevel } = require('../../utils/permissions');

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
    const requesterProfile = getUserProfile(interaction.guild.id, interaction.user.id);
    const canManageProfiles = hasVortexLevel(interaction.member, ['admin', 'medio']);

    if (!requesterProfile && !canManageProfiles) {
      return interaction.editReply({
        content: '❌ Voce precisa ter cadastro no /perfil ou ter sido aprovado no /set para ver perfis.',
      });
    }

    if ((link || nivel) && target.id !== interaction.user.id && !canManageProfiles) {
      return interaction.editReply({
        content: '❌ Voce so pode atualizar o seu proprio perfil.',
      });
    }

    if (!canManageProfiles && requesterProfile?.callChannelId && interaction.channelId !== requesterProfile.callChannelId) {
      return interaction.editReply({
        content: `❌ Use o /perfil no seu canal cadastrado: <#${requesterProfile.callChannelId}>.`,
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
    if (!profile && !canManageProfiles) {
      return interaction.editReply({
        content: '❌ Este usuario ainda nao possui perfil cadastrado.',
      });
    }

    const embed = buildProfileEmbed({
      guild: interaction.guild,
      user: target,
      member,
      profile,
    });

    return interaction.editReply({ embeds: [embed] });
  },
};
