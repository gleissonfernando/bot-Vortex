const { SlashCommandBuilder } = require('discord.js');
const { hasCommandRole, hasVortexLevel } = require('../../utils/permissions');
const { safeDeferReply, safeEdit, safeReply } = require('../../utils/safeReply');
const { upsertSiteUser } = require('../../utils/siteUserManager');

const HIGH_ROLE_NAMES = ['dono', 'diretor', 'lider geral', 'líder geral', 'gerente', 'administrador', 'admin'];

function canRegisterSiteUser(member) {
  if (hasCommandRole(member, 'cadastrar-site')) return true;
  if (hasVortexLevel(member, ['admin', 'medio'])) return true;
  const names = Array.from(member?.roles?.cache?.values?.() || []).map((role) => String(role.name || '').trim().toLowerCase());
  return names.some((name) => HIGH_ROLE_NAMES.includes(name));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cadastrar-site')
    .setDescription('Cadastra um usuario autorizado para acessar o painel web.')
    .addUserOption((option) =>
      option
        .setName('usuario')
        .setDescription('Usuario Discord que podera acessar o painel')
        .setRequired(true))
    .addStringOption((option) =>
      option
        .setName('cargo')
        .setDescription('Cargo do usuario no sistema web')
        .setRequired(true)
        .addChoices(
          { name: 'Administrador', value: 'admin' },
          { name: 'Gerente', value: 'manager' },
          { name: 'Visualizador', value: 'viewer' },
        ))
    .addIntegerOption((option) =>
      option
        .setName('nivel')
        .setDescription('Nivel de permissao de 1 a 100')
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)),

  async execute(interaction) {
    if (!canRegisterSiteUser(interaction.member)) {
      return safeReply(interaction, {
        content: 'Você não possui permissão para cadastrar usuários no sistema.',
        ephemeral: true,
      });
    }

    const user = interaction.options.getUser('usuario', true);
    const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!targetMember) {
      return safeReply(interaction, {
        content: 'Não encontrei esse usuário no servidor. O acesso ao site exige vínculo ativo com este Discord.',
        ephemeral: true,
      });
    }

    await safeDeferReply(interaction, { ephemeral: true });

    const systemRole = interaction.options.getString('cargo', true);
    const permissionLevel = interaction.options.getInteger('nivel', true);
    const discordRoles = Array.from(targetMember.roles.cache.keys()).filter((roleId) => roleId !== interaction.guild.id);

    const saved = await upsertSiteUser({
      guildId: interaction.guild.id,
      discordId: user.id,
      discordName: targetMember.displayName || user.username,
      discordAvatarUrl: user.displayAvatarURL?.({ size: 128, extension: 'png', forceStatic: true }) || null,
      systemRole,
      permissionLevel,
      status: 'active',
      discordRoles,
      registeredBy: interaction.user.id,
      registeredByName: interaction.member?.displayName || interaction.user.username,
    });

    return safeEdit(interaction, {
      content: [
        '✅ Usuário cadastrado para acessar o painel web.',
        `Usuário: <@${user.id}>`,
        `Cargo do sistema: **${saved.system_role}**`,
        `Nível: **${saved.permission_level}**`,
        'Status: **Ativo**',
      ].join('\n'),
    });
  },
};
