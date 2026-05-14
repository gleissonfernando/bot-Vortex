const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const {
  getUserProfile,
  registerApprovedProfile,
  updateProfileLink,
  updateProfileLevel,
  buildProfileEmbed,
} = require('../../utils/profileManager');
const { getApprovedSetChannelRecord, getApprovedSetChannelRecordByUser } = require('../../utils/approvedSetChannels');
const { hasVortexLevel } = require('../../utils/permissions');
const { safeDeferReply, safeEdit } = require('../../utils/safeReply');

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

async function ensureProfileFromApprovedSet(guild, user, record) {
  const existingProfile = getUserProfile(guild.id, user.id);
  if (existingProfile) return existingProfile;
  if (!record?.channelId || String(record.userId) !== String(user.id)) return null;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return null;

  return registerApprovedProfile(guild, member, {
    nomeGame: record.nomeGame || member.displayName || user.username,
    idGame: record.idGame || user.id,
    nivelGame: record.nivelGame || null,
    callChannelId: record.channelId,
    approvedBy: record.createdBy || null,
  }).catch(() => null);
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
    await safeDeferReply(interaction, { ephemeral: true });

    const target = interaction.options.getUser('usuario') || interaction.user;
    const link = interaction.options.getString('link');
    const photo = interaction.options.getAttachment('foto');
    const nivel = interaction.options.getString('nivel');
    const approvedSetChannelRecord = getApprovedSetChannelRecord(interaction.guild.id, interaction.channelId);
    const requesterApprovedRecord = getApprovedSetChannelRecordByUser(interaction.guild.id, interaction.user.id);
    const targetApprovedRecord = getApprovedSetChannelRecordByUser(interaction.guild.id, target.id);
    let requesterProfile = await ensureProfileFromApprovedSet(
      interaction.guild,
      interaction.user,
      requesterApprovedRecord || (approvedSetChannelRecord?.userId === interaction.user.id ? approvedSetChannelRecord : null)
    );
    const canManageProfiles = hasVortexLevel(interaction.member, ['admin']);
    const isApprovedSetChannelOwner = approvedSetChannelRecord?.userId === interaction.user.id;

    if (!requesterProfile && !isApprovedSetChannelOwner && !canManageProfiles) {
      return safeEdit(interaction, {
        content: '❌ Você precisa ter cadastro no /perfil ou estar no seu canal criado pelo /set para usar este comando.',
      });
    }

    if (target.id !== interaction.user.id && !canManageProfiles) {
      return safeEdit(interaction, {
        content: '❌ Você só pode consultar ou atualizar o seu próprio perfil.',
      });
    }

    if (link || photo) {
      await ensureProfileFromApprovedSet(interaction.guild, target, targetApprovedRecord);
      const isImageUpload = Boolean(photo?.contentType?.startsWith('image/'));
      const isVideoUpload = Boolean(photo?.contentType?.startsWith('video/'));
      if (photo && !isImageUpload && !isVideoUpload) {
        return safeEdit(interaction, { content: '❌ O upload precisa ser uma imagem ou vídeo.' });
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
          return safeEdit(interaction, { content: '❌ Usuário não possui cadastro.' });
        }
        return safeEdit(interaction, { content: `❌ ${result.message}` });
      }
    }

    if (nivel) {
      await ensureProfileFromApprovedSet(interaction.guild, target, targetApprovedRecord);
      const result = await updateProfileLevel(interaction.guild, target, nivel, interaction.user.id);
      if (!result.ok) {
        if (isMissingProfileResult(result)) {
          await sendMissingProfileDm(target, interaction.guild);
          return safeEdit(interaction, { content: '❌ Usuário não possui cadastro.' });
        }
        return safeEdit(interaction, { content: `❌ ${result.message}` });
      }
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const profile = getUserProfile(interaction.guild.id, target.id)
      || await ensureProfileFromApprovedSet(interaction.guild, target, targetApprovedRecord);
    if (!profile) {
      await sendMissingProfileDm(target, interaction.guild);
      return safeEdit(interaction, {
        content: '❌ Usuário não possui cadastro.',
      });
    }

    const embed = buildProfileEmbed({
      guild: interaction.guild,
      user: target,
      member,
      profile,
    });

    return safeEdit(interaction, { embeds: [embed] });
  },
};
