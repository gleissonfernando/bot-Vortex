const fs = require('fs');
const path = require('path');

const PANEL_CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const DEFAULT_PENDING_ROLE_ID = '1449514118292967578';
const DEFAULT_APPROVED_ROLE_ID = '1201235607549124639';
const DEFAULT_AUTO_ROLE_SYNC_ENABLED = false;

function normalizeRoleIds(roleIds) {
  return [...new Set((Array.isArray(roleIds) ? roleIds : [])
    .map((roleId) => String(roleId || '').trim())
    .filter((roleId) => /^\d{15,25}$/.test(roleId)))];
}

function readPanelConfig() {
  try {
    if (!fs.existsSync(PANEL_CONFIG_PATH)) return {};
    return JSON.parse(fs.readFileSync(PANEL_CONFIG_PATH, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function writePanelConfig(config) {
  fs.writeFileSync(PANEL_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function parseBooleanFlag(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'sim', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'nao', 'off', 'disabled'].includes(normalized)) return false;
  }
  return fallback;
}

function ensureVortexHierarchyConfig(config = readPanelConfig()) {
  config.VORTEX_AUTO_ROLE_SYNC_ENABLED = parseBooleanFlag(
    config.VORTEX_AUTO_ROLE_SYNC_ENABLED,
    DEFAULT_AUTO_ROLE_SYNC_ENABLED
  );

  if (!config.VORTEX_AUTO_ROLES || typeof config.VORTEX_AUTO_ROLES !== 'object') {
    config.VORTEX_AUTO_ROLES = {};
  }

  if (!Array.isArray(config.VORTEX_AUTO_ROLES.pending)) {
    config.VORTEX_AUTO_ROLES.pending = config.VORTEX_AUTO_ROLES.pending
      ? [String(config.VORTEX_AUTO_ROLES.pending)]
      : [DEFAULT_PENDING_ROLE_ID];
  }

  if (!Array.isArray(config.VORTEX_AUTO_ROLES.approved)) {
    config.VORTEX_AUTO_ROLES.approved = config.VORTEX_AUTO_ROLES.approved
      ? [String(config.VORTEX_AUTO_ROLES.approved)]
      : [DEFAULT_APPROVED_ROLE_ID];
  }

  config.VORTEX_AUTO_ROLES.pending = normalizeRoleIds(config.VORTEX_AUTO_ROLES.pending);
  config.VORTEX_AUTO_ROLES.approved = normalizeRoleIds(config.VORTEX_AUTO_ROLES.approved);

  if (!config.VORTEX_ACCESS_ROLES || typeof config.VORTEX_ACCESS_ROLES !== 'object') {
    config.VORTEX_ACCESS_ROLES = { admin: [], medio: [], membro: [] };
  }
  for (const level of ['admin', 'medio', 'membro']) {
    config.VORTEX_ACCESS_ROLES[level] = normalizeRoleIds(config.VORTEX_ACCESS_ROLES[level]);
  }

  config.VORTEX_ACCESS_ROLES.membro = normalizeRoleIds([
    ...config.VORTEX_ACCESS_ROLES.membro,
    ...config.VORTEX_AUTO_ROLES.approved,
  ]);

  return config;
}

function isVortexAutoRoleSyncEnabled(config = readPanelConfig()) {
  if (process.env.VORTEX_AUTO_ROLE_SYNC_ENABLED !== undefined) {
    return parseBooleanFlag(process.env.VORTEX_AUTO_ROLE_SYNC_ENABLED, DEFAULT_AUTO_ROLE_SYNC_ENABLED);
  }

  return parseBooleanFlag(config.VORTEX_AUTO_ROLE_SYNC_ENABLED, DEFAULT_AUTO_ROLE_SYNC_ENABLED);
}

function getVortexAutoRoles(config = readPanelConfig()) {
  const ensured = ensureVortexHierarchyConfig(config);
  return {
    pending: ensured.VORTEX_AUTO_ROLES.pending,
    approved: ensured.VORTEX_AUTO_ROLES.approved,
  };
}

function setVortexAutoRoles(type, roleIds) {
  if (!['pending', 'approved'].includes(type)) {
    throw new Error(`Tipo de cargo automatico invalido: ${type}`);
  }

  const config = ensureVortexHierarchyConfig(readPanelConfig());
  config.VORTEX_AUTO_ROLES[type] = normalizeRoleIds(roleIds);
  ensureVortexHierarchyConfig(config);
  writePanelConfig(config);
  return config.VORTEX_AUTO_ROLES[type];
}

function setVortexAutoRoleSyncEnabled(enabled) {
  const config = ensureVortexHierarchyConfig(readPanelConfig());
  config.VORTEX_AUTO_ROLE_SYNC_ENABLED = parseBooleanFlag(enabled, DEFAULT_AUTO_ROLE_SYNC_ENABLED);
  writePanelConfig(config);
  return config.VORTEX_AUTO_ROLE_SYNC_ENABLED;
}

function skippedAddResult() {
  return { added: [], failed: [], skipped: true, reason: 'auto_role_sync_disabled' };
}

function skippedRemoveResult() {
  return { removed: [], failed: [], skipped: true, reason: 'auto_role_sync_disabled' };
}

async function addRoles(member, roleIds, reason) {
  const added = [];
  const failed = [];

  for (const roleId of normalizeRoleIds(roleIds)) {
    if (member.roles.cache.has(roleId)) continue;
    await member.roles.add(roleId, reason)
      .then(() => added.push(roleId))
      .catch(() => failed.push(roleId));
  }

  return { added, failed };
}

async function removeRoles(member, roleIds, reason) {
  const removed = [];
  const failed = [];

  for (const roleId of normalizeRoleIds(roleIds)) {
    if (!member.roles.cache.has(roleId)) continue;
    await member.roles.remove(roleId, reason)
      .then(() => removed.push(roleId))
      .catch(() => failed.push(roleId));
  }

  return { removed, failed };
}

async function applyPendingHierarchy(member, reason = 'Hierarquia Vortex: entrada no servidor') {
  const config = ensureVortexHierarchyConfig(readPanelConfig());
  const roles = getVortexAutoRoles(config);
  if (!isVortexAutoRoleSyncEnabled(config)) return skippedAddResult();
  return addRoles(member, roles.pending, reason);
}

async function applyApprovedHierarchy(member, reason = 'Hierarquia Vortex: set aprovado') {
  const config = ensureVortexHierarchyConfig(readPanelConfig());
  const roles = getVortexAutoRoles(config);
  if (!isVortexAutoRoleSyncEnabled(config)) {
    return {
      removedPending: skippedRemoveResult(),
      addedApproved: skippedAddResult(),
      skipped: true,
      reason: 'auto_role_sync_disabled',
    };
  }
  const removedPending = await removeRoles(member, roles.pending, reason);
  const addedApproved = await addRoles(member, roles.approved, reason);
  return { removedPending, addedApproved };
}

async function resetToPendingHierarchy(member, reason = 'Hierarquia Vortex: cadastro removido') {
  const config = ensureVortexHierarchyConfig(readPanelConfig());
  const roles = getVortexAutoRoles(config);
  if (!isVortexAutoRoleSyncEnabled(config)) {
    return {
      removedApproved: skippedRemoveResult(),
      addedPending: skippedAddResult(),
      skipped: true,
      reason: 'auto_role_sync_disabled',
    };
  }
  const removedApproved = await removeRoles(member, roles.approved, reason);
  const addedPending = await addRoles(member, roles.pending, reason);
  return { removedApproved, addedPending };
}

module.exports = {
  DEFAULT_AUTO_ROLE_SYNC_ENABLED,
  DEFAULT_APPROVED_ROLE_ID,
  DEFAULT_PENDING_ROLE_ID,
  ensureVortexHierarchyConfig,
  getVortexAutoRoles,
  isVortexAutoRoleSyncEnabled,
  setVortexAutoRoles,
  setVortexAutoRoleSyncEnabled,
  applyPendingHierarchy,
  applyApprovedHierarchy,
  resetToPendingHierarchy,
};
