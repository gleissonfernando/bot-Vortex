const fs = require('fs');
const path = require('path');
const config = require('../config/config');

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

function isUserAuthorizedById(userId) {
    if (!userId) return false;
    const authorizedIds = normalizeIds(config.authorizedUserIds);
    return authorizedIds.includes(String(userId));
}

function getPanelStaffRoleIds() {
    try {
        const panelConfigPath = path.join(__dirname, '../commands/config.json');
        if (!fs.existsSync(panelConfigPath)) return [];
        const raw = fs.readFileSync(panelConfigPath, 'utf8');
        const panelConfig = JSON.parse(raw);
        return normalizeIds(panelConfig.STAFF_ROLES || []);
    } catch {
        return [];
    }
}

function isRegisteredUser(interaction) {
    if (!interaction || !interaction.user) return false;

    const userId = interaction.user.id;
    if (isUserAuthorizedById(userId)) return true;

    const registeredRoleIds = normalizeIds(config.registeredRoleIds);
    if (memberHasAnyRole(interaction.member, registeredRoleIds)) return true;

    // Também considera os cargos cadastrados no /painel (commands/config.json -> STAFF_ROLES)
    const panelStaffRoleIds = getPanelStaffRoleIds();
    return memberHasAnyRole(interaction.member, panelStaffRoleIds);
}

function isGerencia(interaction) {
    if (!interaction || !interaction.user) return false;

    const userId = interaction.user.id;
    if (isUserAuthorizedById(userId)) return true;

    const gerenciaRoleIds = normalizeIds(config.gerenciaRoleIds);
    if (memberHasAnyRole(interaction.member, gerenciaRoleIds)) return true;

    // Agora também considera os cargos cadastrados no /painel para permissões de gerência
    const panelStaffRoleIds = getPanelStaffRoleIds();
    return memberHasAnyRole(interaction.member, panelStaffRoleIds);
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
    denyNotRegistered
};
