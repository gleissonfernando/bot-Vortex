const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const {
  getUserProfile,
  updateProfileLink,
  updateProfileLevel,
  buildProfileEmbed,
} = require('../../utils/profileManager');
const { hasVortexLevel } = require('../../utils/permissions');

async function sendMissingProfileDm(user, guild) {
  const embed = new EmbedBuilder()
    .setColor('#ED4245')
    .setTitle('Cadastro pendente')
    .setDescription([
      `Você ainda não possui cadastro aprovado no **${guild.name}**.`,
      '',
      'Solicite seu set usando `/set` para liberar seu perfil.',
      'Depois que o set for aprovado, seus dados poderão ser consultados pelo `/perfil`.',
    ].join('\n'))
    .setFooter({ text: 'Vortex - Sistema de Set' })
    .setTimestamp();

  return user.send({ embeds: [embed] }).then(() => true).catch(() => false);
}

function isMissingProfileResult(result) {
  return String(result?.message || '').toLowerCase().includes('perfil aprovado');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('perfil')
    .setDescription('Mostra ou atualiza o perfil de um usuário aprovado no /set.')
    .addUserOption((option) =>
      option
        .setName('usuario')
        .setDescription('Usuário para consultar')
        .setRequired(false))
    .addStringOption((option) =>
      option
        .setName('link')
        .setDescription('Link da mídia do perfil para atualizar')
        .setRequired(false))
    .addAttachmentOption((option) =>
      option
        .setName('foto')
        .setDescription('Upload direto da mídia do perfil')
        .setRequired(false))
    .addStringOption((option) =>
      option
        .setName('nivel')
        .setDescription('Número do nível em game para atualizar')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const target = interaction.options.getUser('usuario') || interaction.user;
    const link = interaction.options.getString('link');
    const photo = interaction.options.getAttachment('foto');
    const nivel = interaction.options.getString('nivel');
    const requesterProfile = getUserProfile(interaction.guild.id, interaction.user.id);
    const canManageProfiles = hasVortexLevel(interaction.member, ['admin', 'medio']);

    if (!requesterProfile && !canManageProfiles) {
      return interaction.editReply({
        content: '❌ Você precisa ter cadastro no /perfil ou ter sido aprovado no /set para ver perfis.',
      });
    }

    if ((link || photo || nivel) && target.id !== interaction.user.id && !canManageProfiles) {
      return interaction.editReply({
        content: '❌ Você só pode atualizar o seu próprio perfil.',
      });
    }

    if (!canManageProfiles && requesterProfile?.callChannelId && interaction.channelId !== requesterProfile.callChannelId) {
      return interaction.editReply({
        content: `❌ Use o /perfil no seu canal cadastrado: <#${requesterProfile.callChannelId}>.`,
      });
    }

    if (link || photo) {
      const isImageUpload = Boolean(photo?.contentType?.startsWith('image/'));
      const isVideoUpload = Boolean(photo?.contentType?.startsWith('video/'));
      if (photo && !isImageUpload && !isVideoUpload) {
        return interaction.editReply({ content: '❌ O upload precisa ser uma imagem ou vídeo.' });
      }
      const imageUrl = photo?.url || link;
      const result = await updateProfileLink(
        interaction.guild,
        target,
        imageUrl,
        interaction.user.id,
        isVideoUpload ? 'video' : 'image'
      );
      if (!result.ok) {
        if (isMissingProfileResult(result)) {
          await sendMissingProfileDm(target, interaction.guild);
          return interaction.editReply({ content: '❌ Usuário não possui cadastro.' });
        }
        return interaction.editReply({ content: `❌ ${result.message}` });
      }
    }

    if (nivel) {
      const result = await updateProfileLevel(interaction.guild, target, nivel, interaction.user.id);
      if (!result.ok) {
        if (isMissingProfileResult(result)) {
          await sendMissingProfileDm(target, interaction.guild);
          return interaction.editReply({ content: '❌ Usuário não possui cadastro.' });
        }
        return interaction.editReply({ content: `❌ ${result.message}` });
      }
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const profile = getUserProfile(interaction.guild.id, target.id);
    if (!profile) {
      await sendMissingProfileDm(target, interaction.guild);
      return interaction.editReply({
        content: '❌ Usuário não possui cadastro.',
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
