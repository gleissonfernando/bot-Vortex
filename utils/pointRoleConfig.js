const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const DEFAULT_POINT_ALLOWED_ROLE_IDS = ['1212944805055692840', '1201235607549124639', '1201238413676924979'];

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function normalizeRoleIds(roleIds) {
  return [...new Set((Array.isArray(roleIds) ? roleIds : [])
    .map((roleId) => String(roleId || '').trim())
    .filter(Boolean))];
}

function getPointAllowedRoleIds({ persistDefault = true } = {}) {
  const config = readConfig();
  const configured = normalizeRoleIds(config.POINT_ALLOWED_ROLE_IDS);
  if (configured.length) return configured;

  const defaults = DEFAULT_POINT_ALLOWED_ROLE_IDS.slice();
  if (persistDefault) {
    config.POINT_ALLOWED_ROLE_IDS = defaults;
    writeConfig(config);
  }
  return defaults;
}

function setPointAllowedRoleIds(roleIds) {
  const config = readConfig();
  config.POINT_ALLOWED_ROLE_IDS = normalizeRoleIds(roleIds);
  writeConfig(config);
  return config.POINT_ALLOWED_ROLE_IDS;
}

module.exports = {
  CONFIG_PATH,
  DEFAULT_POINT_ALLOWED_ROLE_IDS,
  getPointAllowedRoleIds,
  setPointAllowedRoleIds,
};
