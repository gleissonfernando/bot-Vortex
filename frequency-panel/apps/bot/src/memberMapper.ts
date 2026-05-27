import type { GuildMember } from 'discord.js';

export async function mapMember(member: GuildMember) {
  const user = await member.client.users.fetch(member.user.id, { force: true }).catch(() => member.user);
  const roles = member.roles.cache
    .filter((role) => role.id !== member.guild.id)
    .map((role) => ({ id: role.id, name: role.name }));
  const globalName = user.globalName || member.user.globalName || null;

  return {
    guildId: member.guild.id,
    discordUserId: member.user.id,
    username: user.username || member.user.username,
    globalName,
    displayName: member.displayName || globalName || user.username || member.user.username,
    avatarUrl: member.displayAvatarURL({ size: 128, extension: 'png', forceStatic: true }),
    bannerUrl: user.bannerURL({ size: 512, extension: 'png' }),
    highestRoleId: member.roles.highest?.id || null,
    highestRoleName: member.roles.highest?.name || null,
    roles,
    joinedAt: member.joinedAt?.toISOString() || null,
    status: 'active' as const,
    lastSeenAt: new Date().toISOString()
  };
}
