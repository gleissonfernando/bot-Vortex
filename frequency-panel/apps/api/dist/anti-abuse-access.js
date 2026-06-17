export const ANTI_ABUSE_MANAGER_IDS = new Set([
    '289227932432334869',
    '1426287249020158018'
]);
export function canManageAntiAbuse(user) {
    return Boolean(user?.discordId && ANTI_ABUSE_MANAGER_IDS.has(String(user.discordId)));
}
export function configPatchAccess(user, keys) {
    if (!keys.length)
        return 'empty';
    const modifiesAntiAbuse = keys.includes('ANTI_ABUSE');
    const modifiesOtherConfig = keys.some((key) => key !== 'ANTI_ABUSE');
    if (modifiesAntiAbuse && !canManageAntiAbuse(user))
        return 'anti-abuse-forbidden';
    if (modifiesOtherConfig && !['admin', 'manager'].includes(String(user?.role || ''))) {
        return 'manager-forbidden';
    }
    return 'allowed';
}
