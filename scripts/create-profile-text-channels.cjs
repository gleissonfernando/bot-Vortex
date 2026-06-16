#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
} = require('discord.js');

const DEFAULT_CATEGORY_ID = process.env.APPROVED_SET_CATEGORY_ID || '1515044135470497912';
const DEFAULT_GUILD_ID = process.env.DISCORD_GUILD_ID || process.env.VITE_DISCORD_GUILD_ID || '1201193356810780773';
const STAFF_ROLE_ID = '1497703127074345040';
const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const PROFILES_PATH = path.join(__dirname, '..', 'commands', 'perfis.json');
const APPROVED_SET_CHANNELS_PATH = path.join(__dirname, '..', 'commands', 'approvedSetChannels.json');
const REPORT_PATH = path.join(__dirname, '..', 'commands', 'profileTextChannels.json');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const categoryId = readArgValue('--category') || DEFAULT_CATEGORY_ID;
const guildId = readArgValue('--guild') || DEFAULT_GUILD_ID;

function readArgValue(name) {
  const prefix = `${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : null;
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function sanitizeChannelName(value) {
  return String(value || 'usuario')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'usuario';
}

function stripGameIdFromName(value) {
  return String(value || '')
    .replace(/\s*\|\s*\d{1,25}\s*$/g, '')
    .trim();
}

function buildChannelPayload(profile = {}) {
  const rawName = String(profile.nomeGame || profile.displayName || profile.userName || profile.discordTag || 'usuario').trim();
  const displayName = stripGameIdFromName(rawName) || rawName || 'usuario';
  const displayLevel = String(profile.nivelGame || '').trim();
  const channelNameParts = [sanitizeChannelName(displayName)];

  if (displayLevel) {
    channelNameParts.push(sanitizeChannelName(displayLevel));
  }

  return {
    displayName,
    displayLevel,
    channelName: channelNameParts.join('-').slice(0, 100),
    topic: [
      displayName,
      displayLevel ? `Nivel ${displayLevel}` : 'Nivel N/A',
      `Canal privado de perfil Vortex`,
      `user:${profile.userId}`,
    ].filter(Boolean).join(' | '),
  };
}

function getManagementRoleIds() {
  const config = readJson(CONFIG_PATH, {});
  const levels = config.VORTEX_ACCESS_ROLES || {};
  return [
    STAFF_ROLE_ID,
    ...(Array.isArray(levels.admin) ? levels.admin : []),
    ...(Array.isArray(levels.medio) ? levels.medio : []),
  ].map(String).filter(Boolean).filter((roleId, index, list) => list.indexOf(roleId) === index);
}

function loadProfilesForGuild(profilesData, currentGuildId) {
  const guildProfiles = profilesData[String(currentGuildId)] || {};
  return Object.values(guildProfiles)
    .filter((profile) => profile && typeof profile === 'object')
    .filter((profile) => /^\d{15,25}$/.test(String(profile.userId || '')))
    .filter((profile) => profile.approvedAt || profile.registeredManually || profile.nomeGame || profile.idGame);
}

function rememberApprovedChannel({ profilesData, approvedChannels, report, guildId, categoryId: currentCategoryId, profile, channel, source }) {
  const userId = String(profile.userId);
  const now = new Date().toISOString();
  if (!approvedChannels[guildId]) approvedChannels[guildId] = {};
  const previous = approvedChannels[guildId][userId] || {};
  approvedChannels[guildId][userId] = {
    ...previous,
    channelId: channel.id,
    userId,
    nomeGame: profile.nomeGame || profile.displayName || previous.nomeGame || null,
    nivelGame: profile.nivelGame || previous.nivelGame || null,
    updatedAt: now,
  };

  if (profilesData[guildId]?.[userId]) {
    profilesData[guildId][userId].callChannelId = channel.id;
    profilesData[guildId][userId].updatedAt = now;
  }

  if (!report[guildId]) report[guildId] = {};
  if (!report[guildId][currentCategoryId]) report[guildId][currentCategoryId] = {};
  report[guildId][currentCategoryId][userId] = {
    channelId: channel.id,
    userId,
    nomeGame: profile.nomeGame || profile.displayName || null,
    nivelGame: profile.nivelGame || null,
    [source === 'created' ? 'createdAt' : 'foundAt']: now,
    source,
  };
}

function channelBelongsToUser(channel, userId) {
  if (String(channel.topic || '').includes(`user:${userId}`)) return true;
  if (String(channel.topic || '').includes(String(userId))) return true;

  const overwrite = channel.permissionOverwrites?.cache?.get(String(userId));
  return Boolean(overwrite?.allow?.has(PermissionFlagsBits.ViewChannel));
}

function findExistingChannel(channels, userId) {
  return channels.find((channel) => channelBelongsToUser(channel, userId)) || null;
}

function buildGuideEmbed(userId) {
  return new EmbedBuilder()
    .setColor('#7000FF')
    .setTitle('Canal exclusivo de metas')
    .setDescription([
      `<@${userId}>, este canal foi criado exclusivamente para voce.`,
      '',
      'Somente voce e a gerencia conseguem visualizar e acessar este canal.',
      'Fique de olho no seu privado: quando surgir uma mensagem do bot Vortex, responda ou siga a orientacao enviada por la.',
    ].join('\n'))
    .setFooter({ text: 'Vortex - Guia inicial 1/3' })
    .setTimestamp();
}

function buildGuideRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('approved_channel_guide_2')
      .setLabel('Entendi, proximo')
      .setStyle(ButtonStyle.Primary)
  );
}

async function main() {
  const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error('DISCORD_TOKEN/DISCORD_BOT_TOKEN nao configurado no .env.');
  }

  if (!/^\d{15,25}$/.test(String(categoryId))) {
    throw new Error(`Categoria invalida: ${categoryId}`);
  }

  if (!/^\d{15,25}$/.test(String(guildId))) {
    throw new Error(`Servidor invalido: ${guildId}`);
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.Channel],
  });

  await client.login(token);

  try {
    const guild = await client.guilds.fetch(guildId);
    await guild.channels.fetch();
    await guild.roles.fetch().catch(() => null);

    const category = await guild.channels.fetch(categoryId).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) {
      throw new Error(`Categoria ${categoryId} nao encontrada no servidor ${guild.name}.`);
    }

    const profilesData = readJson(PROFILES_PATH, {});
    const approvedChannels = readJson(APPROVED_SET_CHANNELS_PATH, {});
    const profiles = loadProfilesForGuild(profilesData, guild.id);
    const categoryChannels = [...guild.channels.cache.values()]
      .filter((channel) => channel.parentId === categoryId && channel.type === ChannelType.GuildText);
    const roleIds = getManagementRoleIds().filter((roleId) => guild.roles.cache.has(roleId));
    const report = readJson(REPORT_PATH, {});
    if (!report[guild.id]) report[guild.id] = {};
    if (!report[guild.id][categoryId]) report[guild.id][categoryId] = {};

    const results = {
      guildId: guild.id,
      categoryId,
      categoryName: category.name,
      dryRun,
      profiles: profiles.length,
      existing: [],
      created: [],
      skipped: [],
      failed: [],
    };

    for (const profile of profiles) {
      const userId = String(profile.userId);
      const existing = findExistingChannel(categoryChannels, userId);
      if (existing) {
        results.existing.push({ userId, channelId: existing.id, channelName: existing.name });
        if (!dryRun) {
          rememberApprovedChannel({
            profilesData,
            approvedChannels,
            report,
            guildId: guild.id,
            categoryId,
            profile,
            channel: existing,
            source: 'existing',
          });
        }
        continue;
      }

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        results.skipped.push({ userId, reason: 'member_not_found' });
        continue;
      }

      const payload = buildChannelPayload(profile);
      if (dryRun) {
        results.created.push({ userId, channelName: payload.channelName, dryRun: true });
        continue;
      }

      try {
        const channel = await guild.channels.create({
          name: payload.channelName,
          type: ChannelType.GuildText,
          parent: category.id,
          topic: payload.topic,
          permissionOverwrites: [
            {
              id: guild.id,
              deny: [PermissionFlagsBits.ViewChannel],
            },
            {
              id: member.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
              ],
            },
            {
              id: guild.client.user.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ReadMessageHistory,
              ],
            },
            ...roleIds.map((roleId) => ({
              id: roleId,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
              ],
            })),
          ],
          reason: `Backfill de canal privado para perfil cadastrado ${userId}`,
        });

        categoryChannels.push(channel);
        rememberApprovedChannel({
          profilesData,
          approvedChannels,
          report,
          guildId: guild.id,
          categoryId,
          profile,
          channel,
          source: 'created',
        });

        await channel.send({
          content: `<@${member.id}>`,
          embeds: [buildGuideEmbed(member.id)],
          components: [buildGuideRow()],
          allowedMentions: { users: [member.id] },
        }).catch(() => null);

        results.created.push({ userId, channelId: channel.id, channelName: channel.name });
        await new Promise((resolve) => setTimeout(resolve, 900));
      } catch (error) {
        results.failed.push({ userId, reason: error.message });
      }
    }

    if (!dryRun) {
      writeJson(APPROVED_SET_CHANNELS_PATH, approvedChannels);
      writeJson(PROFILES_PATH, profilesData);
      writeJson(REPORT_PATH, report);
    }

    console.log(JSON.stringify(results, null, 2));
  } finally {
    client.destroy();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
