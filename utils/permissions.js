const fs = require('fs');
const path = require('path');
const { safeReply } = require('./safeReply');
const { ensureVortexHierarchyConfig } = require('./vortexHierarchy');
const MASTER_ROLE_IDS = ['1497703127074345040', '1498884908028792942'];
const DEFAULT_MASTER_USER_IDS = ['1426287249020158018'];

function splitEnvIds(value) {
    return String(value || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);
}

function normalizeIds(list) {
    if (!Array.isArray(list)) return [];
    return list.map(String).map(id => id.trim()).filter(Boolean);
}

function memberHasAnyRole(member, roleIds) {
    if (!member || !member.roles || !member.roles.cache) return false;
    const normalized = normalizeIds(roleIds);
    if (normalized.length === 0) return false;
    return normalized.some(roleId => member.roles.cache.has(roleId));
}

function getPanelConfig() {
    try {
        const panelConfigPath = path.join(__dirname, '../commands/config.json');
        if (!fs.existsSync(panelConfigPath)) return {};
        const raw = fs.readFileSync(panelConfigPath, 'utf8');
        return ensureVortexHierarchyConfig(JSON.parse(raw));
    } catch {
        return {};
    }
}

function getVortexRoleIds(levels = []) {
    const panelConfig = getPanelConfig();
    const configured = panelConfig.VORTEX_ACCESS_ROLES || {};
    const legacy = panelConfig.VORTEX_ROLE_LEVELS || {};
    return levels.flatMap(level => normalizeIds([
        ...(configured[level] || []),
        ...(legacy[level] || []),
    ]));
}

function getMasterRoleIds() {
    return [...MASTER_ROLE_IDS];
}

function getMasterUserIds() {
    return normalizeIds([
        ...DEFAULT_MASTER_USER_IDS,
        ...splitEnvIds(process.env.VORTEX_MASTER_USER_IDS),
        ...splitEnvIds(process.env.MASTER_USER_IDS),
        ...splitEnvIds(process.env.AUTHORIZED_USER_IDS),
    ]);
}

function getMemberUserId(member) {
    return String(member?.id || member?.user?.id || member?.userId || '').trim();
}

function isMasterUserId(userId) {
    const id = String(userId || '').trim();
    return Boolean(id && getMasterUserIds().includes(id));
}

function hasMasterAccess(member, userId = '') {
    return isMasterUserId(userId)
        || isMasterUserId(getMemberUserId(member))
        || memberHasAnyRole(member, MASTER_ROLE_IDS);
}

function getAllVortexRoleIds() {
    return getVortexRoleIds(['admin', 'medio', 'membro']);
}

function isPanelPrivateModeEnabled() {
    const panelConfig = getPanelConfig();
    return Boolean(panelConfig.PANEL_PRIVATE_MODE);
}

function hasAnyVortexRole(member) {
    if (hasMasterAccess(member)) return true;
    return memberHasAnyRole(member, getAllVortexRoleIds());
}

function hasVortexAccess(member, levels = []) {
    if (hasMasterAccess(member)) return true;
    if (!member?.roles?.cache) return false;
    if (!Array.isArray(levels) || levels.length === 0) return false;
    return memberHasAnyRole(member, getVortexRoleIds(levels));
}

function hasCommandRole(member, commandName) {
    if (hasMasterAccess(member)) return true;
    if (!member?.roles?.cache || !commandName) return false;
    const panelConfig = getPanelConfig();
    const permissions = panelConfig.COMMAND_ROLE_PERMISSIONS || {};
    const roleIds = normalizeIds(permissions[commandName] || []);
    return memberHasAnyRole(member, roleIds);
}

function hasPanelAccess(member) {
    if (hasMasterAccess(member)) return true;
    if (!member?.roles?.cache) return false;
    if (!isPanelPrivateModeEnabled()) {
        return hasAnyVortexRole(member);
    }

    if (hasVortexAccess(member, ['admin', 'medio'])) return true;
    return hasCommandRole(member, 'painel');
}

function isRegisteredUser(interaction) {
    if (!interaction || !interaction.user) return false;
    return hasMasterAccess(interaction.member, interaction.user.id) || hasAnyVortexRole(interaction.member) || hasVortexAccess(interaction.member, []);
}

function isGerencia(interaction) {
    if (!interaction || !interaction.user) return false;
    return hasMasterAccess(interaction.member, interaction.user.id) || hasVortexAccess(interaction.member, ['admin', 'medio']);
}

async function denyNotRegistered(interaction) {
    return safeReply(interaction, {
        content: '❌ Você não está cadastrado no sistema.',
        ephemeral: true
    });
}

module.exports = {
    isRegisteredUser,
    isGerencia,
    hasAnyVortexRole,
    hasVortexAccess,
    hasCommandRole,
    hasPanelAccess,
    hasMasterAccess,
    isMasterUserId,
    isPanelPrivateModeEnabled,
    getMasterRoleIds,
    getMasterUserIds,
    getVortexRoleIds,
    denyNotRegistered
};
