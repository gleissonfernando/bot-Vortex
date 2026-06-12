export const ANTI_ABUSE_MANAGER_IDS = new Set([
  '289227932432334869',
  '1426287249020158018'
]);

export function canManageAntiAbuse(user?: { discordId?: string }) {
  return Boolean(user?.discordId && ANTI_ABUSE_MANAGER_IDS.has(String(user.discordId)));
}

export function configPatchAccess(
  user: { discordId?: string; role?: string } | undefined,
  keys: string[]
) {
  if (!keys.length) return 'empty' as const;

  const modifiesAntiAbuse = keys.includes('ANTI_ABUSE');
  const modifiesOtherConfig = keys.some((key) => key !== 'ANTI_ABUSE');
  if (modifiesAntiAbuse && !canManageAntiAbuse(user)) return 'anti-abuse-forbidden' as const;
  if (modifiesOtherConfig && !['admin', 'manager'].includes(String(user?.role || ''))) {
    return 'manager-forbidden' as const;
  }
  return 'allowed' as const;
}
