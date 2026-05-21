import type { GuildMember } from 'discord.js';

export function mapMember(member: GuildMember) {
  const roles = member.roles.cache
    .filter((role) => role.id !== member.guild.id)
    .map((role) => ({ id: role.id, name: role.name }));

  return {
    guildId: member.guild.id,
    discordUserId: member.user.id,
    username: member.user.username,
    displayName: member.displayName || member.user.username,
    avatarUrl: member.user.displayAvatarURL({ size: 128, extension: 'png', forceStatic: true }),
    highestRoleId: member.roles.highest?.id || null,
    highestRoleName: member.roles.highest?.name || null,
    roles,
    joinedAt: member.joinedAt?.toISOString() || null,
    status: 'active' as const,
    lastSeenAt: new Date().toISOString()
  };
}
