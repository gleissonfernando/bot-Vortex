const fs = require('fs');
const path = require('path');
const MASTER_ROLE_ID = '1497703127074345040';

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
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function getVortexRoleIds(levels = []) {
    const panelConfig = getPanelConfig();
    const configured = panelConfig.VORTEX_ROLE_LEVELS || {};
    return levels.flatMap(level => normalizeIds(configured[level] || []));
}

function getAllVortexRoleIds() {
    return getVortexRoleIds(['admin', 'medio', 'membro']);
}

function hasAnyVortexRole(member) {
    return memberHasAnyRole(member, getAllVortexRoleIds());
}

function hasVortexLevel(member, levels = []) {
    if (!member?.roles?.cache) return false;
    if (member.roles.cache.has(MASTER_ROLE_ID)) return true;
    if (!Array.isArray(levels) || levels.length === 0) return false;
    return memberHasAnyRole(member, getVortexRoleIds(levels));
}

function isRegisteredUser(interaction) {
    if (!interaction || !interaction.user) return false;
    return hasAnyVortexRole(interaction.member) || hasVortexLevel(interaction.member, []);
}

function isGerencia(interaction) {
    if (!interaction || !interaction.user) return false;
    return hasVortexLevel(interaction.member, ['admin', 'medio']);
}

async function denyNotRegistered(interaction) {
    return interaction.reply({
        content: '❌ Você não está cadastrado no sistema.',
        ephemeral: true
    });
}

module.exports = {
    isRegisteredUser,
    isGerencia,
    hasAnyVortexRole,
    hasVortexLevel,
    denyNotRegistered
};
