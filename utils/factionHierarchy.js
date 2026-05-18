const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { formatDate } = require('./pontoManager');

const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');

const FACTION_HIERARCHY_ROLES = [
  { key: 'leader', label: 'Lider' },
  { key: 'second', label: '02' },
  { key: 'generalManager', label: 'Gerente Geral' },
  { key: 'manager', label: 'Gerente' },
  { key: 'actionManager', label: 'Gerente de Acao' },
  { key: 'soldier', label: 'Soldado' },
  { key: 'member', label: 'Membro' },
];

function normalizeRoleIds(roleIds) {
  return [...new Set((Array.isArray(roleIds) ? roleIds : [])
    .map((roleId) => String(roleId || '').trim())
    .filter((roleId) => /^\d{15,25}$/.test(roleId)))];
}

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function ensureFactionHierarchyConfig(config = loadConfig()) {
  if (!config.FACTION_HIERARCHY || typeof config.FACTION_HIERARCHY !== 'object') {
    config.FACTION_HIERARCHY = {};
  }

  if (!config.FACTION_HIERARCHY.roles || typeof config.FACTION_HIERARCHY.roles !== 'object') {
    config.FACTION_HIERARCHY.roles = {};
  }

  config.FACTION_HIERARCHY.channelId = String(config.FACTION_HIERARCHY.channelId || '').trim();
  config.FACTION_HIERARCHY.messageId = String(config.FACTION_HIERARCHY.messageId || '').trim();

  const oldLeader02 = normalizeRoleIds(config.FACTION_HIERARCHY.roles.leader02);
  if (oldLeader02.length && !normalizeRoleIds(config.FACTION_HIERARCHY.roles.leader).length) {
    config.FACTION_HIERARCHY.roles.leader = oldLeader02;
  }

  for (const role of FACTION_HIERARCHY_ROLES) {
    config.FACTION_HIERARCHY.roles[role.key] = normalizeRoleIds(config.FACTION_HIERARCHY.roles[role.key]);
  }

  return config;
}

function getFactionHierarchyConfig(config = loadConfig()) {
  return ensureFactionHierarchyConfig(config).FACTION_HIERARCHY;
}

function getFactionHierarchyRole(roleKey) {
  return FACTION_HIERARCHY_ROLES.find((role) => role.key === roleKey) || null;
}

function setFactionHierarchyRoleIds(roleKey, roleIds) {
  const role = getFactionHierarchyRole(roleKey);
  if (!role) throw new Error(`Cargo de hierarquia invalido: ${roleKey}`);

  const config = ensureFactionHierarchyConfig(loadConfig());
  config.FACTION_HIERARCHY.roles[role.key] = normalizeRoleIds(roleIds);
  saveConfig(config);
  return config.FACTION_HIERARCHY;
}

function setFactionHierarchyChannelId(channelId) {
  const config = ensureFactionHierarchyConfig(loadConfig());
  config.FACTION_HIERARCHY.channelId = String(channelId || '').trim();
  saveConfig(config);
  return config.FACTION_HIERARCHY;
}

function setFactionHierarchyMessageId(messageId) {
  const config = ensureFactionHierarchyConfig(loadConfig());
  config.FACTION_HIERARCHY.messageId = String(messageId || '').trim();
  saveConfig(config);
  return config.FACTION_HIERARCHY;
}

function formatConfiguredRoles(roleIds) {
  const ids = normalizeRoleIds(roleIds);
  return ids.length ? ids.map((roleId) => `<@&${roleId}>`).join(' ') : '`Cargo nao configurado`';
}

function formatMemberList(members) {
  if (!members.length) return '`Nenhum membro com esse cargo.`';

  const lines = members
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'))
    .slice(0, 30)
    .map((member, index) => `${index + 1}. <@${member.id}>`);

  const hidden = Math.max(0, members.length - lines.length);
  return `${lines.join('\n')}${hidden ? `\n... mais ${hidden} membro(s).` : ''}`.slice(0, 1024);
}

async function buildFactionHierarchyEmbed(guild) {
  const hierarchy = getFactionHierarchyConfig();
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const listedMemberIds = new Set();

  const embed = new EmbedBuilder()
    .setColor('#7000FF')
    .setAuthor({ name: 'VORTEX | HIERARQUIA DA FAC', iconURL: guild.iconURL() || undefined })
    .setTitle('Hierarquia da Fac')
    .setDescription([
      'Painel automatico de cargos da faccao.',
      'Quando alguem recebe ou perde um cargo configurado, este painel e atualizado.',
    ].join('\n'))
    .setTimestamp()
    .setFooter({ text: `Atualizado em ${formatDate(new Date())}` });

  for (const role of FACTION_HIERARCHY_ROLES) {
    const roleIds = normalizeRoleIds(hierarchy.roles[role.key]);
    const listedMembers = members.filter((member) => {
      if (listedMemberIds.has(member.id)) return false;
      return roleIds.some((roleId) => member.roles.cache.has(roleId));
    });
    for (const member of listedMembers.values()) {
      listedMemberIds.add(member.id);
    }
    embed.addFields({
      name: role.label,
      value: [
        `Cargo(s): ${formatConfiguredRoles(roleIds)}`,
        '',
        formatMemberList(Array.from(listedMembers.values())),
      ].join('\n'),
      inline: false,
    });
  }

  return embed;
}

async function updateFactionHierarchyPanel(client, guildId) {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { ok: false, message: 'Servidor nao encontrado.' };

  const hierarchy = getFactionHierarchyConfig();
  if (!hierarchy.channelId || !hierarchy.messageId) {
    return { ok: false, message: 'Painel de hierarquia ainda nao publicado.' };
  }

  const channel = await guild.channels.fetch(hierarchy.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return { ok: false, message: 'Canal do painel nao encontrado.' };

  const message = await channel.messages.fetch(hierarchy.messageId).catch(() => null);
  if (!message) return { ok: false, message: 'Mensagem do painel nao encontrada.' };

  const embed = await buildFactionHierarchyEmbed(guild);
  await message.edit({ embeds: [embed], allowedMentions: { parse: [], users: [], roles: [] } });
  return { ok: true, message: 'Painel atualizado.' };
}

async function publishFactionHierarchyPanel(interaction) {
  const hierarchy = getFactionHierarchyConfig();
  const channelId = hierarchy.channelId || interaction.channelId;
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    return { ok: false, message: 'Configure um canal de texto valido para publicar o painel.' };
  }

  let oldPanelDeleted = false;
  if (hierarchy.channelId && hierarchy.messageId) {
    const oldChannel = await interaction.guild.channels.fetch(hierarchy.channelId).catch(() => null);
    const oldMessage = oldChannel?.isTextBased?.()
      ? await oldChannel.messages.fetch(hierarchy.messageId).catch(() => null)
      : null;
    if (oldMessage) {
      oldPanelDeleted = await oldMessage.delete().then(() => true).catch(() => false);
    }
  }

  const embed = await buildFactionHierarchyEmbed(interaction.guild);
  const message = await channel.send({
    embeds: [embed],
    allowedMentions: { parse: [], users: [], roles: [] },
  });
  setFactionHierarchyMessageId(message.id);
  setFactionHierarchyChannelId(channel.id);

  return {
    ok: true,
    message: `Painel publicado em <#${channel.id}>.${oldPanelDeleted ? ' Painel antigo apagado.' : ''}`,
    panelMessage: message,
  };
}

function hasRelevantFactionHierarchyRoleChange(oldMember, newMember) {
  const hierarchy = getFactionHierarchyConfig();
  const roleIds = FACTION_HIERARCHY_ROLES.flatMap((role) => normalizeRoleIds(hierarchy.roles[role.key]));
  if (!roleIds.length) return false;
  return roleIds.some((roleId) => oldMember.roles.cache.has(roleId) !== newMember.roles.cache.has(roleId));
}

module.exports = {
  FACTION_HIERARCHY_ROLES,
  ensureFactionHierarchyConfig,
  getFactionHierarchyConfig,
  getFactionHierarchyRole,
  setFactionHierarchyRoleIds,
  setFactionHierarchyChannelId,
  setFactionHierarchyMessageId,
  buildFactionHierarchyEmbed,
  publishFactionHierarchyPanel,
  updateFactionHierarchyPanel,
  hasRelevantFactionHierarchyRoleChange,
  formatConfiguredRoles,
};
