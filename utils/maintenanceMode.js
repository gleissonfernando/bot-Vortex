const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const MAINTENANCE_COLOR = '#FF0055';

function readMaintenanceConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function getMaintenanceState(config = readMaintenanceConfig()) {
  const enabled = config.MAINTENANCE_MODE === true;
  const sinceMs = Number(config.MAINTENANCE_SINCE || 0);
  return {
    enabled,
    by: enabled && config.MAINTENANCE_BY ? String(config.MAINTENANCE_BY) : null,
    sinceMs: enabled && Number.isFinite(sinceMs) && sinceMs > 0 ? sinceMs : null,
  };
}

function isMaintenanceMode(config = readMaintenanceConfig()) {
  return getMaintenanceState(config).enabled;
}

function buildMaintenanceEmbed(client, config = readMaintenanceConfig()) {
  const state = getMaintenanceState(config);
  const details = [
    'O bot esta em manutencao no momento.',
    '',
    '**Nenhum comando, botao, formulario ou automacao esta disponivel enquanto a manutencao estiver ativa.**',
    'Aguarde a equipe liberar o sistema para tentar novamente.',
    '',
    state.by ? `Ativado por: <@${state.by}>` : null,
    state.sinceMs ? `Ativo desde: <t:${Math.floor(state.sinceMs / 1000)}:R>` : null,
  ].filter(Boolean);

  return new EmbedBuilder()
    .setColor(MAINTENANCE_COLOR)
    .setTitle('VORTEX | Bot em manutencao')
    .setDescription(details.join('\n'))
    .setFooter({ text: 'Vortex Management System - Manutencao' })
    .setThumbnail(client?.user?.displayAvatarURL?.() || null)
    .setTimestamp();
}

function isMaintenanceControlInteraction(interaction, hasMasterAccess = false) {
  if (!hasMasterAccess) return false;

  if (interaction.isChatInputCommand?.()) {
    return interaction.commandName === 'painel';
  }

  if (interaction.isButton?.()) {
    return interaction.customId === 'toggle_maint' || interaction.customId === 'tab_manutencao';
  }

  if (interaction.isStringSelectMenu?.() && interaction.customId === 'select_panel_tool') {
    return interaction.values?.[0] === 'tab_manutencao';
  }

  return false;
}

module.exports = {
  buildMaintenanceEmbed,
  getMaintenanceState,
  isMaintenanceControlInteraction,
  isMaintenanceMode,
  readMaintenanceConfig,
};
