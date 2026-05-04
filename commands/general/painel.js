const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ChannelSelectMenuBuilder, 
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { sendVortexLog, setChannelLogsEnabled } = require('../../utils/notifications');
const { getUserPoint, deleteUserPoint, adjustPointSessionFlexible, closePoint, formatDuration, formatDate } = require('../../utils/pontoManager');
const { updateStatusPanel } = require('../../utils/pontoPanel');
const { buildAllPointsReportPayload } = require('../../utils/pontoReport');
const { getAbsenceConfig, saveAbsenceConfig, getActiveGuildAbsences, updateAbsenceReturn, formatDate: formatAbsenceDate, DEFAULT_ABSENCE_LOG_CHANNEL_ID } = require('../../utils/ausenciaManager');
const {
  getGuildProfiles,
  checkProfileUpdates,
  parseTestPeriod,
  registerManualProfile,
  readProfileConfig,
  toggleProfileBilling,
  addBillingExemptUserId,
  removeUserProfileData,
} = require('../../utils/profileManager');
const { readAutomationConfig, updateAutomationConfig, runPointAutomationCheck, openPointCorrectionForClosedPoint, deletePointCorrectionChannels } = require('../../utils/pointAutomation');
const { hasAnyVortexRole, hasVortexLevel, hasPanelAccess: canUsePanel } = require('../../utils/permissions');
const { getPointAllowedRoleIds, setPointAllowedRoleIds } = require('../../utils/pointRoleConfig');
const { createPointTranscriptAttachment, createPointTranscriptTextAttachment } = require('../../utils/pontoTranscript');
const {
  ALERT_CHANNEL_ID,
  buildLiveTermsUrl,
  checkUserTwitchLinks,
  getGuildLiveLinks,
  hasAcceptedLiveTerms,
  isValidLiveUrl,
  parseTwitchLogin,
  removeLiveLink,
  setLiveLink,
} = require('../../utils/liveAlertManager');

const STATS_PATH = path.join(__dirname, '..', 'stats.json');
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const PANEL_ERROR_LOG_CHANNEL_ID = '1497685822525149337';
const SUPERIOR_IDS = ['1497703127074345040', '1498884908028792942'];
const SUPERIOR_ID = SUPERIOR_IDS[0];
const NOTICE_DM_REENABLE_USER_IDS = ['289227932432334869', '761011766440230932'];
const LOGS_MANAGER_IDS = ['289227932432334869'];
const DEFAULT_POINT_ACTION_CHANNEL_ID = '1498087608390127806';
const DEFAULT_POINT_ADJUST_CATEGORY_ID = '1498087442304073870';
const VORTEX_PANEL_IMAGE = path.join(__dirname, '..', '..', 'foto', 'IMG_4234.png');
const VORTEX_PANEL_IMAGE_NAME = 'IMG_4234.png';
const UPDATES_PATH = path.join(__dirname, '..', '..', 'SISTEMA_ATUALIZACOES.md');
const commandPermissionSelections = new Map();
const pointReadjustSelections = new Map();
const profileRegisterSelections = new Map();
const logChannelSelections = new Map();
const COMMAND_PERMISSION_OPTIONS = [
    { label: '/painel', value: 'painel', description: 'Quem pode usar o painel de controle' },
    { label: '/avisos', value: 'avisos', description: 'Quem pode abrir e enviar avisos' },
    { label: '/set', value: 'set', description: 'Quem pode usar o sistema de set' },
    { label: '/registro', value: 'registro', description: 'Quem pode consultar registro de ponto' },
    { label: '/ponto', value: 'ponto', description: 'Quem pode gerar relatório de ponto' },
    { label: '/ausencia', value: 'ausencia', description: 'Quem pode usar ausência' },
    { label: '/perfil', value: 'perfil', description: 'Quem pode consultar e atualizar perfil' },
    { label: '/ativarponto', value: 'ativarponto', description: 'Quem pode publicar o painel de ponto' },
    { label: 'Remover /live', value: 'live_remove', description: 'Quem pode remover links de live cadastrados' },
];

function loadJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } }
function saveJSON(p, d) { try { fs.writeFileSync(p, JSON.stringify(d, null, 2)); } catch {} }

function hasStaffPermission(member) {
    return hasVortexLevel(member, ['admin', 'medio']);
}

function hasPanelAccess(member) {
    return canUsePanel(member);
}

function hasMasterPermission(member) {
    return Boolean(member?.roles?.cache && SUPERIOR_IDS.some(roleId => member.roles.cache.has(roleId)));
}

function hasLogsManagerPermission(interaction) {
    return LOGS_MANAGER_IDS.includes(String(interaction.user?.id))
        || hasMasterPermission(interaction.member)
        || Boolean(interaction.member?.roles?.cache && LOGS_MANAGER_IDS.some(roleId => interaction.member.roles.cache.has(roleId)));
}

function canAccessPanelTab(member, tab) {
    return true;
}

function ensureRoleLevels(conf) {
    if (!conf.VORTEX_ROLE_LEVELS || typeof conf.VORTEX_ROLE_LEVELS !== 'object') {
        conf.VORTEX_ROLE_LEVELS = { admin: [], medio: [], membro: [] };
    }
    for (const level of ['admin', 'medio', 'membro']) {
        if (!Array.isArray(conf.VORTEX_ROLE_LEVELS[level])) conf.VORTEX_ROLE_LEVELS[level] = [];
    }
    return conf.VORTEX_ROLE_LEVELS;
}

function ensureCommandPermissions(conf) {
    if (!conf.COMMAND_ROLE_PERMISSIONS || typeof conf.COMMAND_ROLE_PERMISSIONS !== 'object') {
        conf.COMMAND_ROLE_PERMISSIONS = {};
    }
    for (const option of COMMAND_PERMISSION_OPTIONS) {
        if (!Array.isArray(conf.COMMAND_ROLE_PERMISSIONS[option.value])) {
            conf.COMMAND_ROLE_PERMISSIONS[option.value] = [];
        }
    }
    return conf.COMMAND_ROLE_PERMISSIONS;
}

function getSelectionKey(interaction) {
    return `${interaction.guildId}:${interaction.user.id}`;
}

function formatRoleList(roleIds, emptyText = '`Nenhum`') {
    const ids = Array.isArray(roleIds) ? roleIds.filter(Boolean).map(String) : [];
    return ids.length ? ids.map(id => `<@&${id}>`).join(' ') : emptyText;
}

function formatChannelList(channelIds, emptyText = '`Nenhum canal desativado`') {
    const ids = Array.isArray(channelIds) ? channelIds.filter(Boolean).map(String) : [];
    return ids.length ? ids.map(id => `<#${id}>`).join('\n').slice(0, 1024) : emptyText;
}

async function safeReply(interaction, options) {
    if (interaction.replied || interaction.deferred) {
        return interaction.followUp(options).catch(() => null);
    }
    return interaction.reply(options).catch(() => null);
}

function isUnknownInteractionError(error) {
    return error?.code === 10062 || error?.rawError?.code === 10062;
}

async function safeUpdate(interaction, options) {
    const { ephemeral, ...updateOptions } = options;
    if (interaction.replied || interaction.deferred) {
        try {
            return await interaction.editReply(options);
        } catch (error) {
            try {
                return await interaction.followUp(options);
            } catch {
                throw error;
            }
        }
    }
    try {
        return await interaction.update(updateOptions);
    } catch (error) {
        if (isUnknownInteractionError(error)) return null;
        try {
            return await interaction.reply(options);
        } catch (replyError) {
            if (isUnknownInteractionError(replyError)) return null;
            throw error;
        }
    }
}

async function reportPanelError(client, error, context = 'Painel') {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    const channel = await client.channels.fetch(PANEL_ERROR_LOG_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased?.()) return false;

    return channel.send({
        embeds: [
            new EmbedBuilder()
                .setColor('#FF0055')
                .setTitle('Erro/Bug no /painel')
                .setDescription([
                    `**Contexto:** ${context}`,
                    '```js',
                    String(message).slice(0, 3500),
                    '```',
                ].join('\n'))
                .setTimestamp(),
        ],
        allowedMentions: { parse: [] },
    }).catch(() => false);
}

function withPanelImage(options) {
    return {
        ...options,
        files: [{ attachment: VORTEX_PANEL_IMAGE, name: VORTEX_PANEL_IMAGE_NAME }],
    };
}

function readUpdatesSummary() {
    try {
        if (!fs.existsSync(UPDATES_PATH)) return 'Nenhum arquivo de atualizacoes encontrado.';
        return fs.readFileSync(UPDATES_PATH, 'utf8').trim().slice(0, 3500);
    } catch {
        return 'Nao foi possivel ler o arquivo de atualizacoes.';
    }
}

function profileValue(value, fallback = 'N/A') {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text || fallback;
}

function truncateCell(value, size) {
    const text = profileValue(value);
    return text.length > size ? `${text.slice(0, Math.max(0, size - 3))}...` : text;
}

function padCell(value, size) {
    return truncateCell(value, size).padEnd(size, ' ');
}

function buildProfileTable(title, profiles) {
    const rows = profiles.map((profile, index) => {
        const status = profile.registeredManually ? 'Manual' : 'Set';
        const channel = profile.callChannelId ? `#${profile.callChannelId}` : 'Sem canal';
        return [
            padCell(String(index + 1), 4),
            padCell(profile.nomeGame || profile.displayName || 'Sem nome', 24),
            padCell(profile.discordTag || profile.userId, 28),
            padCell(profile.idGame || profile.registro || 'N/A', 18),
            padCell(profile.numeroGame || 'N/A', 10),
            padCell(profile.nivelGame || 'N/A', 8),
            padCell(status, 8),
            padCell(channel, 24),
            padCell(profile.lastProfileUpdateAt ? formatDate(profile.lastProfileUpdateAt) : 'N/A', 22),
        ].join(' | ');
    });

    const header = [
        padCell('N.', 4),
        padCell('Nome em game', 24),
        padCell('Discord', 28),
        padCell('ID game', 18),
        padCell('Numero', 10),
        padCell('Nivel', 8),
        padCell('Origem', 8),
        padCell('Call/Canal', 24),
        padCell('Ultima atualizacao', 22),
    ].join(' | ');

    const separator = '-'.repeat(header.length);
    return [
        title,
        separator,
        header,
        separator,
        rows.length ? rows.join('\n') : 'Nenhum usuario nesta categoria.',
    ].join('\n');
}

function buildRegisteredProfilesReport(guild, profiles) {
    const sortedProfiles = Object.values(profiles)
        .sort((a, b) => String(a.nomeGame || a.displayName || '').localeCompare(String(b.nomeGame || b.displayName || ''), 'pt-BR'));
    const setProfiles = sortedProfiles.filter((profile) => !profile.registeredManually);
    const manualProfiles = sortedProfiles.filter((profile) => profile.registeredManually);
    const missingChannelProfiles = sortedProfiles.filter((profile) => !profile.callChannelId);

    return [
        `RELATORIO DE USUARIOS CADASTRADOS - ${guild.name}`,
        '='.repeat(72),
        `Total cadastrado: ${sortedProfiles.length}`,
        `Aprovados no /set: ${setProfiles.length}`,
        `Cadastro manual: ${manualProfiles.length}`,
        `Sem call/canal vinculado: ${missingChannelProfiles.length}`,
        `Gerado em: ${formatDate(new Date())}`,
        '',
        buildProfileTable('CADASTROS APROVADOS NO /SET', setProfiles),
        '',
        buildProfileTable('CADASTROS MANUAIS', manualProfiles),
        '',
        missingChannelProfiles.length
            ? buildProfileTable('ATENCAO - CADASTROS SEM CALL/CANAL', missingChannelProfiles)
            : 'ATENCAO - CADASTROS SEM CALL/CANAL\nNenhum cadastro sem call/canal vinculado.',
    ].join('\n');
}

function formatLiveLinksList(links) {
    if (!links.length) return 'Nenhum canal de live cadastrado.';
    return links.slice(0, 10).map((link, index) => {
        const twitchLogin = link.twitchLogin || parseTwitchLogin(link.url);
        const platform = twitchLogin ? `Twitch: ${twitchLogin}` : (link.platform || 'outro');
        const createdBy = link.createdBy ? ` por <@${link.createdBy}>` : '';
        const url = String(link.url || '').length > 140 ? `${String(link.url).slice(0, 137)}...` : link.url;
        return `${index + 1}. ${url}\n   ${platform}${createdBy}`;
    }).join('\n') + (links.length > 10 ? `\n... mais ${links.length - 10} cadastro(s).` : '');
}

async function getRealtimeGuildStats(guild) {
    const fallbackMembers = guild.memberCount || guild.members.cache.size || 0;
    const members = await guild.members.fetch().catch(() => null);
    const channels = await guild.channels.fetch().catch(() => null);
    const roles = await guild.roles.fetch().catch(() => null);

    const memberCollection = members || guild.members.cache;
    const totalMembers = members?.size || fallbackMembers;
    const botCount = memberCollection?.filter?.((member) => member.user?.bot).size || 0;
    const humanCount = Math.max(totalMembers - botCount, 0);

    return {
        totalMembers,
        humanCount,
        botCount,
        channelCount: channels?.size || guild.channels.cache.size || 0,
        roleCount: roles?.size || guild.roles.cache.size || 0,
        source: members ? 'API Discord' : 'Cache Discord',
    };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('VORTEX MANAGEMENT SYSTEM - Painel de Controle'),

  async execute(interaction) {
    return renderDashboard(interaction, 'tab_stats');
  },

  async handleButton(interaction) {
    const customId = interaction.customId;
    const conf = loadJSON(CONFIG_PATH);

    if (!hasPanelAccess(interaction.member)) {
      return safeReply(interaction, { content: '❌ Você precisa estar cadastrado no /painel para usar estes botões.', ephemeral: true });
    }

    if (customId.startsWith('tab_')) {
      return renderDashboard(interaction, customId, true);
    }

    if (customId === 'config_set' || customId === 'config_avisos' || customId === 'config_logs') {
      return renderDashboard(interaction, customId, true);
    }

    if (!hasStaffPermission(interaction.member) && !hasLogsManagerPermission(interaction)) return safeReply(interaction, { content: '❌ Sem permissão para usar esta ação.', ephemeral: true });

    if ((customId === 'tab_manutencao' || ['toggle_maint', 'test_notice'].includes(customId)) && !hasMasterPermission(interaction.member)) {
      return safeReply(interaction, { content: `❌ Somente os cargos ${SUPERIOR_IDS.map(roleId => `<@&${roleId}>`).join(' ')} podem usar a manutenção.`, ephemeral: true });
    }

    if (customId === 'show_all_points') {
      await interaction.deferReply({ ephemeral: true });
      const payload = await buildAllPointsReportPayload(interaction.guild);

      sendVortexLog(interaction.client, {
          title: 'Relatorio Completo de Pontos Gerado',
          description: `O relatório completo de pontos foi gerado por <@${interaction.user.id}> (${interaction.user.id}).`,
          color: '#7000FF',
          type: 'PONTO',
          userId: interaction.user.id
      }).catch(() => {});

      return interaction.editReply(payload);
    }

    if (customId === 'show_user_point_sheet') {
      await interaction.deferReply({ ephemeral: true });
      const userId = pointReadjustSelections.get(getSelectionKey(interaction));
      if (!userId) return interaction.editReply({ content: '❌ Selecione um usuário primeiro.' });

      const target = await interaction.client.users.fetch(userId).catch(() => null);
      if (!target) return interaction.editReply({ content: '❌ Não consegui encontrar esse usuário.' });

      const data = await getUserPoint(interaction.guild.id, userId).catch(() => null);
      if (!data || (!data.activePointStartedAt && !Array.isArray(data.sessions))) {
        return interaction.editReply({ content: `❌ <@${userId}> ainda não possui ponto registrado.` });
      }

      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      const files = [
        createPointTranscriptAttachment({ guild: interaction.guild, target, member, data }),
        createPointTranscriptTextAttachment({ guild: interaction.guild, target, member, data }),
      ];

      sendVortexLog(interaction.client, {
        title: 'Folha de Ponto Gerada',
        description: `A folha/transcript de <@${userId}> (${userId}) foi gerada por <@${interaction.user.id}> (${interaction.user.id}).`,
        color: '#7000FF',
        type: 'PONTO',
        userId: interaction.user.id,
      }).catch(() => {});

      return interaction.editReply({
        content: `✅ Folha/transcript de <@${userId}> gerada em arquivo.`,
        files,
        allowedMentions: { users: [userId] },
      });
    }

    if (customId === 'toggle_point_monitor') {
      const current = readAutomationConfig();
      const next = updateAutomationConfig({ POINT_MONITOR_ENABLED: !current.pointMonitorEnabled });
      return renderDashboard(interaction, 'tab_pontos', true);
    }

    if (customId === 'toggle_offline_charge') {
      const current = readAutomationConfig();
      const next = updateAutomationConfig({ POINT_OFFLINE_CHARGE_ENABLED: !current.offlineChargeEnabled });
      return renderDashboard(interaction, 'tab_pontos', true);
    }

    if (customId === 'run_point_automation') {
      await interaction.deferReply({ ephemeral: true });
      await runPointAutomationCheck(interaction.client, { force: true });
      return interaction.editReply({ content: '✅ Verificação de ponto, perfil e cobranças executada agora.' });
    }

    if (customId === 'close_selected_point') {
      await interaction.deferReply({ ephemeral: true });
      const userId = pointReadjustSelections.get(getSelectionKey(interaction));
      if (!userId) return interaction.editReply({ content: '❌ Selecione um usuário primeiro.' });
      const pointData = loadJSON(path.join(__dirname, '..', 'pontos.json'))[interaction.guild.id]?.[userId];
      if (!pointData?.activePointStartedAt) {
        return interaction.editReply({ content: `❌ <@${userId}> não está com ponto aberto.` });
      }
      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_close_point_${userId}`)
          .setLabel('Confirmar fechamento')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('cancel_close_point')
          .setLabel('Cancelar')
          .setStyle(ButtonStyle.Secondary)
      );
      return interaction.editReply({
        content: [
          '⚠️ Confirme o fechamento manual do ponto.',
          `Usuário: <@${userId}>`,
          `Aberto desde: ${formatDate(pointData.activePointStartedAt)}`,
          '',
          'Ao confirmar, o ponto será fechado agora, o usuário receberá DM e será aberto um canal de correção de ponto.',
        ].join('\n'),
        components: [confirmRow],
      });
    }

    if (customId === 'delete_point_correction_channel') {
      await interaction.deferReply({ ephemeral: true });
      const userId = pointReadjustSelections.get(getSelectionKey(interaction));
      if (!userId) return interaction.editReply({ content: '❌ Selecione um usuário primeiro.' });
      const deleted = await deletePointCorrectionChannels(interaction.client, interaction.guild, userId, interaction.user.id);

      sendVortexLog(interaction.client, {
        title: 'Call de ajuste de ponto deletada',
        description: [
          `Usuário: <@${userId}> (${userId})`,
          `Gerente: <@${interaction.user.id}>`,
          `Canais deletados: ${deleted.length ? deleted.map((id) => `#${id}`).join(', ') : 'nenhum'}`,
        ].join('\n'),
        color: '#ED4245',
        type: 'PONTO',
        userId: interaction.user.id,
      }).catch(() => {});

      return interaction.editReply({
        content: deleted.length
          ? `✅ Call/canal de ajuste de <@${userId}> deletado. Total: ${deleted.length}.`
          : `⚠️ Nenhuma call/canal de ajuste encontrada para <@${userId}>.`,
      });
    }

    if (customId === 'clear_point_no_billing') {
      await interaction.deferReply({ ephemeral: true });
      const userId = pointReadjustSelections.get(getSelectionKey(interaction));
      if (!userId) return interaction.editReply({ content: '❌ Selecione um usuário primeiro.' });

      const existed = await deleteUserPoint(interaction.guild.id, userId);
      const exempt = addBillingExemptUserId(userId, interaction.user.id);
      if (!exempt.ok) return interaction.editReply({ content: `❌ ${exempt.message}` });

      await updateStatusPanel(interaction.client, interaction.guild.id);
      sendVortexLog(interaction.client, {
        title: 'Ponto deletado e cobrança bloqueada',
        description: [
          `Usuário: <@${userId}> (${userId})`,
          `Gerente: <@${interaction.user.id}>`,
          `Registro de ponto existia: ${existed ? 'sim' : 'não'}`,
          'O usuário foi colocado na lista de isenção de cobranças automáticas.',
        ].join('\n'),
        color: '#FF0055',
        type: 'PONTO',
        userId: interaction.user.id,
      }).catch(() => {});

      return interaction.editReply({
        content: [
          existed
            ? `✅ Dados de ponto de <@${userId}> deletados.`
            : `⚠️ Nenhum dado de ponto encontrado para <@${userId}>.`,
          '✅ Cobranças automáticas bloqueadas para esse usuário.',
        ].join('\n'),
      });
    }

    if (customId === 'cancel_close_point') {
      return safeReply(interaction, { content: '✅ Fechamento manual cancelado.', ephemeral: true });
    }

    if (customId.startsWith('confirm_close_point_')) {
      await interaction.deferReply({ ephemeral: true });
      const userId = customId.replace('confirm_close_point_', '');
      const pointBeforeClose = loadJSON(path.join(__dirname, '..', 'pontos.json'))[interaction.guild.id]?.[userId] || {};
      const targetUser = await interaction.client.users.fetch(userId).catch(() => null);
      const result = await closePoint(interaction.guild.id, userId);
      if (result.action === 'already_closed') {
        return interaction.editReply({ content: `❌ <@${userId}> não está com ponto aberto.` });
      }
      await updateStatusPanel(interaction.client, interaction.guild.id).catch(() => null);
      if (targetUser) {
        await targetUser.send({
          content: [
            '⚠️ Seu ponto foi fechado manualmente pela gerência.',
            `Fechado por: <@${interaction.user.id}>`,
            `Horário registrado: ${formatDate(result.data.lastPointCloseAt)}`,
            `Tempo contabilizado: ${formatDuration(result.durationMs)}`,
            '',
            'Se esse horário estiver errado, solicite a correção de ponto pelo painel de ponto ou fale com a gerência.',
          ].join('\n'),
          allowedMentions: { users: [interaction.user.id] },
        }).catch(() => null);
      }
      const correctionChannel = await openPointCorrectionForClosedPoint(interaction.client, interaction.guild, {
        ...pointBeforeClose,
        userId,
      }, {
        reason: 'Fechamento manual pela gerência',
        closedAt: result.data.lastPointCloseAt,
        durationMs: result.durationMs,
        closedBy: interaction.user.id,
      }).catch(() => null);
      sendVortexLog(interaction.client, {
        title: 'Ponto fechado pela gerência',
        description: [
          `Usuário: <@${userId}> (${userId})`,
          `Gerente: <@${interaction.user.id}>`,
          `Fechado em: ${formatDate(result.data.lastPointCloseAt)}`,
          `Tempo contabilizado: ${formatDuration(result.durationMs)}`,
        ].join('\n'),
        color: '#ED4245',
        type: 'PONTO',
        userId: interaction.user.id,
      }).catch(() => {});
      return interaction.editReply({
        content: [
          `✅ Ponto de <@${userId}> fechado. Tempo: ${formatDuration(result.durationMs)}.`,
          correctionChannel ? `Canal de correção: <#${correctionChannel.id}>` : 'Canal de correção: não criado.',
        ].join('\n'),
      });
    }
    
    if (customId === 'toggle_maint') {
      conf.MAINTENANCE_MODE = !conf.MAINTENANCE_MODE;
      conf.MAINTENANCE_BY = String(interaction.user.id);
      conf.MAINTENANCE_SINCE = Date.now();
      saveJSON(CONFIG_PATH, conf);
      
      sendVortexLog(interaction.client, {
          title: 'Modo Manutenção Alterado',
          description: `O modo manutenção foi **${conf.MAINTENANCE_MODE ? 'ATIVADO' : 'DESATIVADO'}** por <@${interaction.user.id}>.`,
          color: conf.MAINTENANCE_MODE ? '#FF0055' : '#57F287',
          type: 'MANUTENÇÃO',
          userId: interaction.user.id
      }).catch(() => {});

      return renderDashboard(interaction, 'tab_manutencao', true);
    }

    if (customId === 'toggle_channel_logs') {
      if (!hasLogsManagerPermission(interaction)) {
        return safeReply(interaction, { content: '❌ Apenas o responsável pelos logs pode alterar essa configuração.', ephemeral: true });
      }
      await setChannelLogsEnabled(
        interaction.client,
        conf.DISABLE_CHANNEL_LOGS === true,
        interaction.user.id,
        'painel_logs'
      ).catch((error) => reportPanelError(interaction.client, error, 'Alterar logs de canal'));

      return renderDashboard(interaction, 'config_logs', true);
    }

    if (customId === 'toggle_dm_logs') {
      if (!hasLogsManagerPermission(interaction)) {
        return safeReply(interaction, { content: '❌ Apenas o responsável pelos logs pode alterar essa configuração.', ephemeral: true });
      }
      conf.DISABLE_DM_LOGS = !conf.DISABLE_DM_LOGS;
      saveJSON(CONFIG_PATH, conf);

      sendVortexLog(interaction.client, {
          title: 'Logs por DM Alterados',
          description: `Envio de logs por DM foi **${conf.DISABLE_DM_LOGS ? 'DESLIGADO' : 'LIGADO'}** por <@${interaction.user.id}>.\n\nA DM de boas-vindas continua ativa.`,
          color: conf.DISABLE_DM_LOGS ? '#FFA500' : '#57F287',
          type: 'CONFIGURAÇÃO',
          userId: interaction.user.id
      }).catch(() => {});

      return renderDashboard(interaction, 'config_logs', true);
    }

    if (customId === 'toggle_activity_logs') {
      if (!hasLogsManagerPermission(interaction)) {
        return safeReply(interaction, { content: '❌ Apenas o responsável pelos logs pode alterar essa configuração.', ephemeral: true });
      }
      conf.DISABLE_ACTIVITY_LOGS = !conf.DISABLE_ACTIVITY_LOGS;
      saveJSON(CONFIG_PATH, conf);

      sendVortexLog(interaction.client, {
          title: 'Logs de Atividades Alterados',
          description: `Logs de atividades FiveM/GTA foram **${conf.DISABLE_ACTIVITY_LOGS ? 'DESLIGADOS' : 'LIGADOS'}** por <@${interaction.user.id}>.`,
          color: conf.DISABLE_ACTIVITY_LOGS ? '#FFA500' : '#57F287',
          type: 'CONFIGURAÇÃO',
          userId: interaction.user.id
      }).catch(() => {});

      return renderDashboard(interaction, 'config_logs', true);
    }

    if (customId === 'toggle_notice_dms') {
      if (!hasLogsManagerPermission(interaction)) {
        return safeReply(interaction, { content: '❌ Apenas o responsável pelos logs pode alterar essa configuração.', ephemeral: true });
      }
      const currentlyDisabled = conf.DISABLE_NOTICE_DMS === true;
      if (currentlyDisabled && !NOTICE_DM_REENABLE_USER_IDS.includes(interaction.user.id)) {
        return safeReply(interaction, {
          content: '❌ O modo de avisos por DM está desativado. Somente Henri | Duke pode reativar.',
          ephemeral: true
        });
      }

      conf.DISABLE_NOTICE_DMS = !currentlyDisabled;
      saveJSON(CONFIG_PATH, conf);

      sendVortexLog(interaction.client, {
          title: 'Avisos por DM Alterados',
          description: `Envio global de avisos por DM foi **${conf.DISABLE_NOTICE_DMS ? 'DESLIGADO' : 'LIGADO'}** por <@${interaction.user.id}>.`,
          color: conf.DISABLE_NOTICE_DMS ? '#FFA500' : '#57F287',
          type: 'CONFIGURAÇÃO',
          userId: interaction.user.id
      }).catch(() => {});

      return renderDashboard(interaction, 'config_logs', true);
    }

    if (customId === 'toggle_panel_private_mode') {
      if (!hasVortexLevel(interaction.member, ['admin', 'medio'])) {
        return safeReply(interaction, { content: '❌ Seu nível não libera esta configuração.', ephemeral: true });
      }
      conf.PANEL_PRIVATE_MODE = !conf.PANEL_PRIVATE_MODE;
      saveJSON(CONFIG_PATH, conf);

      sendVortexLog(interaction.client, {
          title: 'Modo Privado do /painel Alterado',
          description: `O modo privado do /painel foi **${conf.PANEL_PRIVATE_MODE ? 'ATIVADO' : 'DESATIVADO'}** por <@${interaction.user.id}>.`,
          color: conf.PANEL_PRIVATE_MODE ? '#FF0055' : '#57F287',
          type: 'CONFIGURAÇÃO',
          userId: interaction.user.id
      }).catch(() => {});

      return renderDashboard(interaction, 'tab_config', true);
    }

    if (customId === 'toggle_selected_log_channel') {
      if (!hasLogsManagerPermission(interaction)) {
        return safeReply(interaction, { content: '❌ Apenas o responsável pelos logs pode alterar essa configuração.', ephemeral: true });
      }

      const channelId = logChannelSelections.get(getSelectionKey(interaction));
      if (!channelId) {
        return safeReply(interaction, { content: '❌ Selecione um canal ou call primeiro.', ephemeral: true });
      }

      const disabled = Array.isArray(conf.DISABLED_LOG_CHANNEL_IDS)
        ? conf.DISABLED_LOG_CHANNEL_IDS.map(String)
        : [];
      const alreadyDisabled = disabled.includes(channelId);
      conf.DISABLED_LOG_CHANNEL_IDS = alreadyDisabled
        ? disabled.filter((id) => id !== channelId)
        : [...disabled, channelId];
      saveJSON(CONFIG_PATH, conf);

      sendVortexLog(interaction.client, {
          title: alreadyDisabled ? 'Logs de Canal Reativados' : 'Logs de Canal Desativados',
          description: `Logs de auditoria relacionados a <#${channelId}> foram **${alreadyDisabled ? 'REATIVADOS' : 'DESATIVADOS'}** por <@${interaction.user.id}>.`,
          color: alreadyDisabled ? '#57F287' : '#FFA500',
          type: 'CONFIGURAÇÃO',
          userId: interaction.user.id
      }).catch(() => {});

      return renderDashboard(interaction, 'config_logs', true);
    }

    if (customId === 'toggle_absence_end_message') {
      const absenceConfig = getAbsenceConfig();
      const nextConfig = saveAbsenceConfig({
        DISABLE_ABSENCE_END_MESSAGE: !absenceConfig.disableEndMessage,
      });

      sendVortexLog(interaction.client, {
          title: 'Mensagem de Ausência Alterada',
          description: `Mensagem de fim de ausência foi **${nextConfig.disableEndMessage ? 'DESLIGADA' : 'LIGADA'}** por <@${interaction.user.id}>.`,
          color: nextConfig.disableEndMessage ? '#FFA500' : '#57F287',
          type: 'AUSÊNCIA',
          userId: interaction.user.id
      }).catch(() => {});

      return renderDashboard(interaction, 'tab_ausencias', true);
    }

    if (customId === 'test_notice') {
        const maintEmbed = new EmbedBuilder()
            .setTitle('⚠️ VORTEX | MANUTENÇÃO')
            .setColor('#FF0055')
            .setDescription('O bot está em manutenção no momento. Tente novamente mais tarde.')
            .setTimestamp();
        
        const maintBtn = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('Chamar Suporte').setStyle(ButtonStyle.Link).setURL('https://discord.gg/vortex')
        );

        return safeReply(interaction, { embeds: [maintEmbed], components: [maintBtn], ephemeral: true });
    }

    if (customId === 'live_stream_add_link') {
        const modal = new ModalBuilder()
            .setCustomId('modal_live_stream_add')
            .setTitle('Cadastrar Live Stream');

        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('live_url')
                .setLabel('LINK DO CANAL DA LIVE')
                .setPlaceholder('https://twitch.tv/seucanal')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(300)
        ));

        return interaction.showModal(modal);
    }

    if (customId === 'live_stream_check_now') {
        await interaction.deferReply({ ephemeral: true });
        const result = await checkUserTwitchLinks(interaction.client, interaction.guild.id, null, {
            sendIfOnline: true,
        }).catch((error) => ({
            ok: false,
            message: `Erro ao consultar Twitch: ${error.message}`,
            termsAccepted: getGuildLiveLinks(interaction.guild.id).length > 0,
            hasCredentials: false,
            totalLinks: getGuildLiveLinks(interaction.guild.id).length,
            twitchLinks: 0,
            online: [],
            offline: [],
            sent: 0,
        }));

        return interaction.editReply({
            content: [
                result.ok ? '✅ Verificação concluída.' : '❌ Verificação não concluída.',
                `Resultado: ${result.message}`,
                `Termos aceitos: ${result.termsAccepted ? 'sim' : 'não'}`,
                `Links cadastrados: ${result.totalLinks}`,
                `Links Twitch: ${result.twitchLinks}`,
                `Alertas enviados agora: ${result.sent || 0}`,
            ].join('\n'),
        });
    }

    if (customId === 'live_stream_clear_links') {
        const removed = removeLiveLink(interaction.guild.id);

        sendVortexLog(interaction.client, {
            title: 'Links de Live Stream Removidos',
            description: `Todos os links de live stream foram removidos por <@${interaction.user.id}>.\nHavia links para remover: ${removed ? 'sim' : 'não'}.`,
            color: '#FF0055',
            type: 'LIVE',
            userId: interaction.user.id
        }).catch(() => {});

        return renderDashboard(interaction, 'tab_live_stream', true);
    }

    if (customId === 'clear_point_user' || customId === 'correct_point_close') {
        const selectedUserId = pointReadjustSelections.get(getSelectionKey(interaction));
        const modal = new ModalBuilder()
            .setCustomId(customId === 'clear_point_user' ? 'modal_clear_point_user' : 'modal_correct_point_close')
            .setTitle(customId === 'clear_point_user' ? 'Deletar Dados de Ponto' : 'Reajustar Ponto');

        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('user_id')
                .setLabel('ID DO USUÁRIO')
                .setPlaceholder('Selecione no painel ou cole o ID Discord')
                .setValue(selectedUserId || '')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
        ));

        if (customId === 'correct_point_close') {
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('point_date')
                        .setLabel('DATA DO PONTO')
                        .setPlaceholder('Ex: 23, 23/04, 23/04/2026 ou 23 até 24')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('time_range')
                        .setLabel('HORÁRIO DO PONTO')
                        .setPlaceholder('Ex: 23 às 02, 23:00 até 02:00 ou 12 às 23')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('reason')
                        .setLabel('MOTIVO DO AJUSTE')
                        .setPlaceholder('Explique por que o ponto foi ajustado')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                        .setMaxLength(900)
                )
            );
        }

        return interaction.showModal(modal);
    }

    if (customId === 'set_absence_role') {
        const absenceConfig = getAbsenceConfig();
        const modal = new ModalBuilder()
            .setCustomId('modal_absence_role')
            .setTitle('Configurar Cargo de Ausência');

        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('role_id')
                .setLabel('ID DO CARGO DE AUSÊNCIA')
                .setPlaceholder('Cole o ID do cargo')
                .setValue(absenceConfig.roleId)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
        ));

        return interaction.showModal(modal);
    }

    if (customId === 'change_absence_return') {
        const modal = new ModalBuilder()
            .setCustomId('modal_absence_return')
            .setTitle('Alterar Retorno de Ausência');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('user_id')
                    .setLabel('ID DO USUÁRIO')
                    .setPlaceholder('Cole o ID Discord do usuário')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('return_period')
                    .setLabel('NOVO RETORNO')
                    .setPlaceholder('Data: 30/04 ou 30/04/2026 | Dias: 3 | Horas: 12:00')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );

        return interaction.showModal(modal);
    }

    if (customId === 'profile_test') {
        const modal = new ModalBuilder()
            .setCustomId('modal_profile_test')
            .setTitle('Teste de Perfil');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('user_id')
                    .setLabel('ID DO USUARIO')
                    .setPlaceholder('Cole o ID Discord do usuário')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('amount')
                    .setLabel('QUANTIDADE')
                    .setPlaceholder('Ex: 5')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('unit')
                    .setLabel('MINUTOS, HORAS OU DIAS')
                    .setPlaceholder('minutos, horas ou dias')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );

        return interaction.showModal(modal);
    }

    if (customId === 'profile_register') {
        const selected = profileRegisterSelections.get(getSelectionKey(interaction)) || {};
        const modal = new ModalBuilder()
            .setCustomId('modal_profile_register')
            .setTitle('Cadastrar Perfil');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('user_id')
                    .setLabel('ID DO USUARIO')
                    .setPlaceholder('Selecione no painel ou cole o ID Discord')
                    .setValue(selected.userId || '')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('name')
                    .setLabel('NOME DO USUARIO')
                    .setPlaceholder('Nome para salvar no perfil')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('call_channel_id')
                    .setLabel('ID DA CALL/CANAL')
                    .setPlaceholder('Selecione no painel ou cole o ID do canal')
                    .setValue(selected.channelId || '')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('nivel_game')
                    .setLabel('NÍVEL EM GAME')
                    .setPlaceholder('Ex: 12')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('photo_link')
                    .setLabel('LINK DA FOTO')
                    .setPlaceholder('Cole o link da mídia, print ou vídeo')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
            )
        );

        return interaction.showModal(modal);
    }

    if (customId === 'profile_delete_no_billing') {
        await interaction.deferReply({ ephemeral: true });
        const selected = profileRegisterSelections.get(getSelectionKey(interaction)) || {};
        const userId = selected.userId;
        if (!userId) return interaction.editReply({ content: '❌ Selecione um usuário primeiro.' });

        const removed = removeUserProfileData(interaction.guild.id, userId);
        const exempt = addBillingExemptUserId(userId, interaction.user.id);
        if (!exempt.ok) return interaction.editReply({ content: `❌ ${exempt.message}` });

        sendVortexLog(interaction.client, {
            title: 'Perfil deletado e cobrança bloqueada',
            description: [
                `Usuário: <@${userId}> (${userId})`,
                `Gerente: <@${interaction.user.id}>`,
                `Perfil existia: ${removed.deleted ? 'sim' : 'não'}`,
                'O usuário foi colocado na lista de isenção de cobranças automáticas.',
            ].join('\n'),
            color: '#FF0055',
            type: 'PERFIL',
            userId: interaction.user.id
        }).catch(() => {});

        return interaction.editReply({
            content: [
                removed.deleted
                    ? `✅ Dados de perfil de <@${userId}> apagados.`
                    : `⚠️ Nenhum perfil salvo encontrado para <@${userId}>.`,
                '✅ Cobranças automáticas bloqueadas para esse usuário.',
            ].join('\n'),
        });
    }

    if (customId === 'profile_toggle_billing') {
        const next = toggleProfileBilling();
        sendVortexLog(interaction.client, {
            title: 'Cobranca de Perfil Alterada',
            description: `Cobrança por DM do perfil foi **${next.billingDmEnabled ? 'LIGADA' : 'DESLIGADA'}** por <@${interaction.user.id}>.\nData/hora real: ${formatDate(new Date())}`,
            color: next.billingDmEnabled ? '#57F287' : '#FFA500',
            type: 'PERFIL',
            userId: interaction.user.id
        }).catch(() => {});
        return renderDashboard(interaction, 'tab_perfil', true);
    }

    if (customId === 'profile_list_registered') {
        await interaction.deferReply({ ephemeral: true });
        const profiles = getGuildProfiles(interaction.guild.id);
        const report = buildRegisteredProfilesReport(interaction.guild, profiles);
        const file = new AttachmentBuilder(Buffer.from(report, 'utf8'), {
            name: `usuarios-cadastrados-${interaction.guild.id}.txt`,
        });
        return interaction.editReply({
            content: `✅ Relatório gerado com **${Object.keys(profiles).length}** usuários cadastrados.`,
            files: [file],
        });
    }

  },

  async handleSelectMenu(interaction) {
    if (!hasPanelAccess(interaction.member)) return safeReply(interaction, { content: '❌ Você precisa estar cadastrado no /painel para usar esta seleção.', ephemeral: true });
    if (!hasStaffPermission(interaction.member) && !hasLogsManagerPermission(interaction)) return safeReply(interaction, { content: '❌ Sem permissão.', ephemeral: true });
    
    const data = loadJSON(CONFIG_PATH);
    if (interaction.customId === 'select_log') {
        if (!hasLogsManagerPermission(interaction)) return safeReply(interaction, { content: '❌ Apenas o responsável pelos logs pode alterar o canal de logs.', ephemeral: true });
        data.LOG_CHANNEL = String(interaction.values[0]);
        saveJSON(CONFIG_PATH, data);
        
        sendVortexLog(interaction.client, {
            title: 'Canal de Logs Alterado',
            description: `O canal de logs foi alterado para <#${data.LOG_CHANNEL}> por <@${interaction.user.id}>.`,
            color: '#00D9FF',
            type: 'CONFIGURAÇÃO',
            userId: interaction.user.id
        }).catch(() => {});

        return renderDashboard(interaction, 'config_logs', true);
    }

    if (interaction.customId === 'select_disabled_log_channel') {
        if (!hasLogsManagerPermission(interaction)) return safeReply(interaction, { content: '❌ Apenas o responsável pelos logs pode desativar logs de canais.', ephemeral: true });
        logChannelSelections.set(getSelectionKey(interaction), String(interaction.values[0]));
        return renderDashboard(interaction, 'config_logs', true);
    }

    if (interaction.customId === 'select_notice_mention_role') {
        if (!hasVortexLevel(interaction.member, ['admin', 'medio'])) return safeReply(interaction, { content: '❌ Seu nível não libera configuração de avisos.', ephemeral: true });
        data.NOTICE_MENTION_ROLE_ID = String(interaction.values[0]);
        saveJSON(CONFIG_PATH, data);

        sendVortexLog(interaction.client, {
            title: 'Cargo de Menção dos Avisos Alterado',
            description: `O cargo extra mencionado em avisos foi alterado para <@&${data.NOTICE_MENTION_ROLE_ID}> por <@${interaction.user.id}>.`,
            color: '#00D9FF',
            type: 'CONFIGURAÇÃO',
            userId: interaction.user.id
        }).catch(() => {});

        return renderDashboard(interaction, 'tab_config', true);
    }

    if (interaction.customId === 'select_point_action_channel') {
        if (!hasVortexLevel(interaction.member, ['admin'])) return safeReply(interaction, { content: '❌ Apenas Admin Vortex pode configurar ponto.', ephemeral: true });
        data.POINT_ACTION_CHANNEL_ID = String(interaction.values[0]);
        saveJSON(CONFIG_PATH, data);

        sendVortexLog(interaction.client, {
            title: 'Canal de Bater Ponto Alterado',
            description: `O canal onde os botoes do ponto funcionam foi alterado para <#${data.POINT_ACTION_CHANNEL_ID}> por <@${interaction.user.id}>.`,
            color: '#00D9FF',
            type: 'CONFIGURAÇÃO',
            userId: interaction.user.id
        }).catch(() => {});

        return renderDashboard(interaction, 'tab_manutencao', true);
    }

    if (interaction.customId === 'select_point_adjust_category') {
        if (!hasVortexLevel(interaction.member, ['admin'])) return safeReply(interaction, { content: '❌ Apenas Admin Vortex pode configurar ponto.', ephemeral: true });
        data.POINT_ADJUST_CATEGORY_ID = String(interaction.values[0]);
        saveJSON(CONFIG_PATH, data);

        sendVortexLog(interaction.client, {
            title: 'Categoria de Ajuste de Ponto Alterada',
            description: `A categoria dos pedidos de ajuste de ponto foi alterada para <#${data.POINT_ADJUST_CATEGORY_ID}> por <@${interaction.user.id}>.`,
            color: '#00D9FF',
            type: 'CONFIGURAÇÃO',
            userId: interaction.user.id
        }).catch(() => {});

        return renderDashboard(interaction, 'tab_manutencao', true);
    }

    if (interaction.customId === 'select_point_adjust_role') {
        if (!hasVortexLevel(interaction.member, ['admin'])) return safeReply(interaction, { content: '❌ Apenas Admin Vortex pode configurar ajuste de ponto.', ephemeral: true });
        data.POINT_ADJUST_STAFF_ROLES = interaction.values.map(String);
        saveJSON(CONFIG_PATH, data);

        sendVortexLog(interaction.client, {
            title: 'Cargo de Ajuste de Ponto Alterado',
            description: `Cargos extras para analisar ajuste de ponto: ${data.POINT_ADJUST_STAFF_ROLES.map(id => `<@&${id}>`).join(' ') || 'nenhum'} por <@${interaction.user.id}>.`,
            color: '#00D9FF',
            type: 'CONFIGURAÇÃO',
            userId: interaction.user.id
        }).catch(() => {});

        return renderDashboard(interaction, 'tab_config', true);
    }

    if (interaction.customId === 'select_point_allowed_roles') {
        if (!hasVortexLevel(interaction.member, ['admin'])) return safeReply(interaction, { content: '❌ Apenas Admin Vortex pode configurar cargos de ponto.', ephemeral: true });
        data.POINT_ALLOWED_ROLE_IDS = setPointAllowedRoleIds(interaction.values);

        sendVortexLog(interaction.client, {
            title: 'Cargos de Ponto Alterados',
            description: `Cargos liberados para bater ponto e ponto automático: ${data.POINT_ALLOWED_ROLE_IDS.map(id => `<@&${id}>`).join(' ') || 'nenhum'} por <@${interaction.user.id}>.`,
            color: '#5865F2',
            type: 'PONTO',
            userId: interaction.user.id
        }).catch(() => {});

        return renderDashboard(interaction, 'tab_pontos', true);
    }

    if (interaction.customId.startsWith('select_vortex_role_')) {
        if (!hasVortexLevel(interaction.member, ['admin'])) return safeReply(interaction, { content: '❌ Apenas Admin Vortex pode alterar Cargos Vortex.', ephemeral: true });
        const level = interaction.customId.replace('select_vortex_role_', '');
        const levels = ensureRoleLevels(data);
        levels[level] = interaction.values.map(String);
        saveJSON(CONFIG_PATH, data);

        sendVortexLog(interaction.client, {
            title: 'Cargo Vortex Alterado',
            description: `Nivel **${level}** atualizado para: ${levels[level].map(id => `<@&${id}>`).join(' ') || 'nenhum'} por <@${interaction.user.id}>.`,
            color: '#5865F2',
            type: 'SEGURANÇA',
            userId: interaction.user.id
        }).catch(() => {});

        return renderDashboard(interaction, 'tab_roles', true);
    }

    if (interaction.customId === 'select_command_permission_target') {
        if (!hasVortexLevel(interaction.member, ['admin', 'medio'])) return safeReply(interaction, { content: '❌ Seu nível não libera esta configuração.', ephemeral: true });
        commandPermissionSelections.set(getSelectionKey(interaction), interaction.values[0]);
        return renderDashboard(interaction, 'tab_commands', true);
    }

    if (interaction.customId === 'select_command_permission_roles') {
        if (!hasVortexLevel(interaction.member, ['admin', 'medio'])) return safeReply(interaction, { content: '❌ Seu nível não libera esta configuração.', ephemeral: true });
        const target = commandPermissionSelections.get(getSelectionKey(interaction));
        if (!target) {
            return safeReply(interaction, { content: '❌ Selecione primeiro qual comando/ação deseja configurar.', ephemeral: true });
        }

        const permissions = ensureCommandPermissions(data);
        permissions[target] = interaction.values.map(String);
        saveJSON(CONFIG_PATH, data);

        sendVortexLog(interaction.client, {
            title: 'Permissao de Comando Alterada',
            description: `Permissao de **${target}** alterada para: ${permissions[target].map(id => `<@&${id}>`).join(' ') || 'todos'} por <@${interaction.user.id}>.`,
            color: '#00D9FF',
            type: 'CONFIGURAÇÃO',
            userId: interaction.user.id
        }).catch(() => {});

        return renderDashboard(interaction, 'tab_commands', true);
    }

    if (interaction.customId === 'select_point_readjust_user' || interaction.customId === 'select_open_point_user') {
        pointReadjustSelections.set(getSelectionKey(interaction), interaction.values[0]);
        return renderDashboard(interaction, 'tab_pontos', true);
    }

    if (interaction.customId === 'select_profile_register_user') {
        const key = getSelectionKey(interaction);
        profileRegisterSelections.set(key, {
            ...(profileRegisterSelections.get(key) || {}),
            userId: interaction.values[0],
        });
        return renderDashboard(interaction, 'tab_perfil', true);
    }

    if (interaction.customId === 'select_profile_register_channel') {
        const key = getSelectionKey(interaction);
        profileRegisterSelections.set(key, {
            ...(profileRegisterSelections.get(key) || {}),
            channelId: interaction.values[0],
        });
        return renderDashboard(interaction, 'tab_perfil', true);
    }
  },

  async handleModal(interaction) {
    if (!hasPanelAccess(interaction.member)) return safeReply(interaction, { content: '❌ Você precisa estar cadastrado no /painel para usar esta ação.', ephemeral: true });
    if (!hasStaffPermission(interaction.member)) return safeReply(interaction, { content: '❌ Sem permissão.', ephemeral: true });
    
    const data = loadJSON(CONFIG_PATH);
    if (interaction.customId === 'modal_live_stream_add') {
        await interaction.deferReply({ ephemeral: true });
        const url = interaction.fields.getTextInputValue('live_url').trim();

        if (!isValidLiveUrl(url)) {
            return interaction.editReply({ content: '❌ Envie um link válido começando com `http://` ou `https://`.' });
        }

        const twitchLogin = parseTwitchLogin(url);
        const liveOwnerId = twitchLogin ? `twitch:${twitchLogin}` : interaction.user.id;
        const link = setLiveLink(interaction.guild.id, liveOwnerId, url, interaction.user.id);
        const termsAccepted = hasAcceptedLiveTerms(interaction.guild.id, liveOwnerId);

        sendVortexLog(interaction.client, {
            title: 'Live Stream Cadastrada',
            description: `Link cadastrado por <@${interaction.user.id}>: ${link.url}`,
            color: '#9146FF',
            type: 'LIVE',
            userId: interaction.user.id
        }).catch(() => {});

        return interaction.editReply({
            content: termsAccepted
                ? `✅ Live Stream cadastrada. Quando o canal ficar online, vou avisar em <#${ALERT_CHANNEL_ID}>.`
                : `✅ Live Stream cadastrada, mas o monitor só libera alertas depois do aceite dos termos: ${buildLiveTermsUrl(interaction.guild.id, interaction.user.id)}`,
        });
    }

    if (interaction.customId === 'modal_clear_point_user') {
        const userId = interaction.fields.getTextInputValue('user_id').trim();
        if (!/^\d{15,25}$/.test(userId)) {
            return safeReply(interaction, { content: '❌ ID de usuário inválido.', ephemeral: true });
        }

        const existed = await deleteUserPoint(interaction.guild.id, userId);
        await updateStatusPanel(interaction.client, interaction.guild.id);

        sendVortexLog(interaction.client, {
            title: 'Dados de Ponto Deletados',
            description: `Os dados de ponto de <@${userId}> (${userId}) foram deletados por <@${interaction.user.id}>.\nRegistro existia: ${existed ? 'sim' : 'não'}.`,
            color: '#FF0055',
            type: 'PONTO',
            userId: interaction.user.id
        }).catch(() => {});

        return safeReply(interaction, {
            content: existed
                ? `✅ Dados de ponto de <@${userId}> deletados.`
                : `⚠️ Nenhum dado de ponto encontrado para <@${userId}>.`,
            ephemeral: true
        });
    }

    if (interaction.customId === 'modal_correct_point_close') {
        const userId = interaction.fields.getTextInputValue('user_id').trim();
        const dateInput = interaction.fields.getTextInputValue('point_date').trim();
        const timeRangeInput = interaction.fields.getTextInputValue('time_range').trim();
        const reason = interaction.fields.getTextInputValue('reason').trim();

        if (!/^\d{15,25}$/.test(userId)) {
            return safeReply(interaction, { content: '❌ ID de usuário inválido.', ephemeral: true });
        }

        const result = await adjustPointSessionFlexible(interaction.guild.id, userId, dateInput, timeRangeInput, interaction.member, reason);
        if (!result.ok) {
            return safeReply(interaction, { content: `❌ ${result.message}`, ephemeral: true });
        }

        await updateStatusPanel(interaction.client, interaction.guild.id);
        const targetUser = await interaction.client.users.fetch(userId).catch(() => null);
        if (targetUser) {
            await targetUser.send({
                content: [
                    '✅ Seu ponto foi ajustado pela gerência.',
                    `Abertura aplicada: ${formatDate(result.startedAt)}`,
                    `Fechamento aplicado: ${formatDate(result.closedAt)}`,
                    `Tempo contabilizado: ${formatDuration(result.durationMs)}`,
                    '',
                    'O sistema foi alterado com a correção informada. Caso ainda exista divergência, fale com a gerência.',
                ].join('\n'),
            }).catch(() => null);
        }

        sendVortexLog(interaction.client, {
            title: 'Ponto Reajustado',
            description: [
                `O ponto de <@${userId}> (${userId}) foi reajustado por <@${interaction.user.id}>.`,
                `Abertura aplicada: ${formatDate(result.startedAt)}`,
                `Fechamento aplicado: ${formatDate(result.closedAt)}`,
                `Tempo contabilizado: ${formatDuration(result.durationMs)}`,
                'O reajuste foi salvo em `commands/pontos.json`.',
            ].join('\n'),
            color: '#FEE75C',
            type: 'PONTO',
            userId: interaction.user.id
        }).catch(() => {});

        return safeReply(interaction, {
            content: [
                '✅ Ponto reajustado.',
                `Usuário: <@${userId}>`,
                `Abertura aplicada: ${formatDate(result.startedAt)}`,
                `Fechamento aplicado: ${formatDate(result.closedAt)}`,
                `Tempo somado: ${formatDuration(result.durationMs)}`,
                'O reajuste foi salvo no JSON.',
            ].join('\n'),
            ephemeral: true
        });
    }

    if (interaction.customId === 'modal_absence_role') {
        const roleId = interaction.fields.getTextInputValue('role_id').trim();
        if (!/^\d{15,25}$/.test(roleId)) {
            return safeReply(interaction, { content: '❌ ID de cargo inválido.', ephemeral: true });
        }

        const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
        if (!role) {
            return safeReply(interaction, { content: '❌ Cargo não encontrado neste servidor.', ephemeral: true });
        }

        saveAbsenceConfig({ ABSENCE_ROLE_ID: roleId });

        sendVortexLog(interaction.client, {
            title: 'Cargo de Ausência Alterado',
            description: `O cargo de ausência foi alterado para <@&${roleId}> por <@${interaction.user.id}>.`,
            color: '#7000FF',
            type: 'AUSÊNCIA',
            userId: interaction.user.id
        }).catch(() => {});

        return safeReply(interaction, { content: `✅ Cargo de ausência alterado para <@&${roleId}>.`, ephemeral: true });
    }

    if (interaction.customId === 'modal_absence_return') {
        const userId = interaction.fields.getTextInputValue('user_id').trim();
        const returnInput = interaction.fields.getTextInputValue('return_period').trim();

        if (!/^\d{15,25}$/.test(userId)) {
            return safeReply(interaction, { content: '❌ ID de usuário inválido.', ephemeral: true });
        }

        const result = await updateAbsenceReturn(interaction.client, interaction.guild, userId, returnInput, interaction.user.id);
        if (!result.ok) {
            return safeReply(interaction, { content: `❌ ${result.message}`, ephemeral: true });
        }

        sendVortexLog(interaction.client, {
            title: 'Retorno de Ausência Alterado',
            description: [
                `**Staff:** <@${interaction.user.id}>`,
                `**Usuário:** <@${userId}> (${userId})`,
                `**Retorno anterior:** ${formatAbsenceDate(result.oldEndsAt)}`,
                `**Novo retorno:** ${formatAbsenceDate(result.absence.endsAt)}`,
                `**DM enviada:** ${result.dmSent ? 'sim' : 'não'}`,
            ].join('\n'),
            color: '#FEE75C',
            type: 'AUSÊNCIA',
            userId: interaction.user.id
        }).catch(() => {});

        return safeReply(interaction, {
            content: [
                '✅ Retorno de ausência alterado.',
                `Usuário: <@${userId}>`,
                `Retorno anterior: ${formatAbsenceDate(result.oldEndsAt)}`,
                `Novo retorno: ${formatAbsenceDate(result.absence.endsAt)}`,
                `DM enviada: **${result.dmSent ? 'sim' : 'não'}**`,
            ].join('\n'),
            ephemeral: true
        });
    }

    if (interaction.customId === 'modal_profile_test') {
        const userId = interaction.fields.getTextInputValue('user_id').trim();
        const amount = interaction.fields.getTextInputValue('amount').trim();
        const unit = interaction.fields.getTextInputValue('unit').trim();

        if (!/^\d{15,25}$/.test(userId)) {
            return safeReply(interaction, { content: '❌ ID de usuário inválido.', ephemeral: true });
        }

        const thresholdMs = parseTestPeriod(amount, unit);
        if (!thresholdMs) {
            return safeReply(interaction, { content: '❌ Período inválido. Use unidade `minutos`, `horas` ou `dias`.', ephemeral: true });
        }

        const results = await checkProfileUpdates(interaction.client, {
            guildId: interaction.guild.id,
            userId,
            thresholdMs,
            force: true,
        });
        const result = results[0];

        return safeReply(interaction, {
            content: [
                '✅ Teste de perfil executado.',
                `Usuário: <@${userId}>`,
                `Período testado: ${amount} ${unit}`,
                `Data/hora real: ${formatDate(new Date())}`,
                `Aviso enviado: ${result?.sent ? 'sim' : 'não'}`,
                result?.reason ? `Motivo: ${result.reason}` : null,
            ].filter(Boolean).join('\n'),
            ephemeral: true,
        });
    }

    if (interaction.customId === 'modal_profile_register') {
        const userId = interaction.fields.getTextInputValue('user_id').trim();
        const name = interaction.fields.getTextInputValue('name').trim();
        const callChannelId = interaction.fields.getTextInputValue('call_channel_id').trim();
        const nivelGame = interaction.fields.getTextInputValue('nivel_game').trim();
        const photoLink = interaction.fields.getTextInputValue('photo_link').trim();

        if (!/^\d{15,25}$/.test(userId)) {
            return safeReply(interaction, { content: '❌ ID de usuário inválido.', ephemeral: true });
        }
        if (callChannelId && !/^\d{15,25}$/.test(callChannelId)) {
            return safeReply(interaction, { content: '❌ ID de canal/call inválido.', ephemeral: true });
        }

        const target = await interaction.client.users.fetch(userId).catch(() => null);
        if (!target) {
            return safeReply(interaction, { content: '❌ Usuário não encontrado.', ephemeral: true });
        }

        const result = await registerManualProfile(interaction.guild, target, {
            name,
            callChannelId: callChannelId || null,
            nivelGame: nivelGame || null,
            photoLink: photoLink || null,
            registeredBy: interaction.user.id,
        });

        if (!result.ok) {
            return safeReply(interaction, { content: `❌ ${result.message}`, ephemeral: true });
        }

        await target.send({
            content: [
                '✅ Você foi cadastrado no sistema Vortex.',
                `Servidor: ${interaction.guild.name}`,
                `Cadastrado por: <@${interaction.user.id}>`,
                `Nome salvo: ${result.profile.nomeGame || result.profile.displayName}`,
                result.profile.callChannelId ? `Call/Canal vinculado: <#${result.profile.callChannelId}>` : null,
                '',
                'Agora você pode usar os recursos liberados para usuários cadastrados, como `/perfil` e os comandos autorizados pela equipe.',
            ].filter(Boolean).join('\n'),
            allowedMentions: { users: [interaction.user.id] },
        }).catch(() => null);

        return safeReply(interaction, {
            content: [
                '✅ Perfil cadastrado no sistema.',
                `Usuário: <@${userId}>`,
                `Nome: ${result.profile.nomeGame || result.profile.displayName}`,
                `Nível: ${result.profile.nivelGame || 'N/A'}`,
                `Call/Canal: ${result.profile.callChannelId ? `<#${result.profile.callChannelId}>` : 'N/A'}`,
                `Mídias salvas: ${Array.isArray(result.profile.photoLinks) ? result.profile.photoLinks.length : 0}`,
                `Data/hora real: ${formatDate(new Date())}`,
            ].join('\n'),
            ephemeral: true,
        });
    }

  }
};

async function renderDashboard(interaction, tab, edit = false) {
  const stats = loadJSON(STATS_PATH);
  const conf = loadJSON(CONFIG_PATH);
  const guild = interaction.guild;
  const client = interaction.client;
  
  const embed = new EmbedBuilder()
    .setTimestamp()
    .setImage(`attachment://${VORTEX_PANEL_IMAGE_NAME}`)
    .setFooter({ text: `Vortex Management System - ${String(tab).replace('tab_', '').toUpperCase()} • ${formatDate(new Date())}` });

  const mainRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tab_stats').setLabel('📊 Estatísticas').setStyle(tab === 'tab_stats' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!canAccessPanelTab(interaction.member, 'tab_stats')),
    new ButtonBuilder().setCustomId('tab_roles').setLabel('🛡️ Cargos Vortex').setStyle(tab === 'tab_roles' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!canAccessPanelTab(interaction.member, 'tab_roles')),
    new ButtonBuilder().setCustomId('tab_config').setLabel('⚙️ Configurações').setStyle(tab === 'tab_config' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!canAccessPanelTab(interaction.member, 'tab_config')),
    new ButtonBuilder().setCustomId('tab_manutencao').setLabel('🔧 Manutenção').setStyle(tab === 'tab_manutencao' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!canAccessPanelTab(interaction.member, 'tab_manutencao')),
    new ButtonBuilder().setCustomId('tab_pontos').setLabel('🕒 Pontos').setStyle(tab === 'tab_pontos' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!canAccessPanelTab(interaction.member, 'tab_pontos'))
  );

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tab_ausencias').setLabel('Ausências').setStyle(tab === 'tab_ausencias' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!canAccessPanelTab(interaction.member, 'tab_ausencias')),
    new ButtonBuilder().setCustomId('tab_commands').setLabel('Comandos').setStyle(tab === 'tab_commands' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!canAccessPanelTab(interaction.member, 'tab_commands')),
    new ButtonBuilder().setCustomId('tab_perfil').setLabel('Perfil').setStyle(tab === 'tab_perfil' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!canAccessPanelTab(interaction.member, 'tab_perfil')),
    new ButtonBuilder().setCustomId('tab_cobrancas').setLabel('Cobranças').setStyle(tab === 'tab_cobrancas' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!canAccessPanelTab(interaction.member, 'tab_cobrancas')),
    new ButtonBuilder().setCustomId('tab_live_stream').setLabel('Live Stream').setStyle(tab === 'tab_live_stream' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!canAccessPanelTab(interaction.member, 'tab_live_stream'))
  );

  const actionRow = new ActionRowBuilder();
  let extraRows = [];

  if (tab === 'tab_stats') {
    const realtime = await getRealtimeGuildStats(guild);
    embed.setAuthor({ name: 'VORTEX | DASHBOARD', iconURL: guild.iconURL() || client.user.displayAvatarURL() }).setColor('#7000FF')
      .setDescription('### 📊 Resumo em Tempo Real\n*Painel geral de estatísticas do servidor*\n\n**Como funciona**\nEsta aba mostra os principais números do servidor e o status atual do sistema. Use os botões do painel para navegar entre as áreas administrativas.')
      .addFields(
        { name: '👤 Membros', value: String(realtime.totalMembers), inline: true },
        { name: 'Pessoas / Bots', value: `${realtime.humanCount} / ${realtime.botCount}`, inline: true },
        { name: 'Canais / Cargos', value: `${realtime.channelCount} / ${realtime.roleCount}`, inline: true },
        { name: '📋 Fichas', value: String((stats.aprovados || 0) + (stats.recusados || 0) + (stats.pendentes || 0)), inline: true },
        { name: '🟢 Status', value: conf.MAINTENANCE_MODE ? '🔴 Em Manutenção' : '🟢 Online', inline: true },
        { name: 'Fonte dos dados', value: realtime.source, inline: true }
      );
  } else if (tab === 'tab_roles') {
    const levels = ensureRoleLevels(conf);
    const permissions = ensureCommandPermissions(conf);
    embed.setAuthor({ name: '🛡️ VORTEX | GESTÃO DE ACESSOS', iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor('#5865F2')
      .setDescription('### 🔐 Controle de Cargos Vortex\n\n' + 
                      'Nesta aba você seleciona cargos pesquisando pelo nome e define o nível de acesso de cada grupo.\n\n' +
                      '**Como funciona**\n' +
                      '**Admin:** mexe em avisos, set e todos os sistemas de ponto, mas não usa manutenção.\n' +
                      '**Médio:** aceita set e envia avisos.\n' +
                      '**Membro:** usa botões de bater ponto e registra ações básicas.\n\n' +
                      `**👑 Administrador Master:** ${SUPERIOR_IDS.map(roleId => `<@&${roleId}>`).join(' ')}\n\n` +
                      '*Manutenção continua liberada somente para o cargo master.*')
      .addFields(
        { name: 'Acesso total', value: SUPERIOR_IDS.map(roleId => `<@&${roleId}>`).join(' '), inline: false },
        { name: 'Admin Vortex', value: formatRoleList(levels.admin), inline: false },
        { name: 'Médio Vortex', value: formatRoleList(levels.medio), inline: false },
        { name: 'Membro Vortex', value: formatRoleList(levels.membro), inline: false },
        { name: '/painel privado', value: formatRoleList(permissions.painel, '`Somente Admin/Médio`'), inline: false },
        { name: 'Set', value: formatRoleList(permissions.set, '`Sem filtro extra`'), inline: true },
        { name: 'Avisos', value: formatRoleList(permissions.avisos, '`Sem filtro extra`'), inline: true },
        { name: 'Registro', value: formatRoleList(permissions.registro, '`Sem filtro extra`'), inline: true },
        { name: 'Ponto', value: formatRoleList(permissions.ponto, '`Sem filtro extra`'), inline: true },
        { name: 'Remover live', value: formatRoleList(permissions.live_remove, '`Não configurado`'), inline: true },
        { name: 'Ajuste de ponto', value: formatRoleList(conf.POINT_ADJUST_STAFF_ROLES, '`Admin Vortex`'), inline: true }
      );

    extraRows = [
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId('select_vortex_role_admin').setPlaceholder('Selecionar cargos Admin Vortex').setMinValues(0).setMaxValues(5)
      ),
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId('select_vortex_role_medio').setPlaceholder('Selecionar cargos Médio Vortex').setMinValues(0).setMaxValues(5)
      ),
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId('select_vortex_role_membro').setPlaceholder('Selecionar cargos Membro Vortex').setMinValues(0).setMaxValues(5)
      ),
    ];
  } else if (tab === 'tab_manutencao') {
    const since = conf.MAINTENANCE_SINCE ? `<t:${Math.floor(conf.MAINTENANCE_SINCE / 1000)}:R>` : 'N/A';
    
    embed.setAuthor({ name: '🛠️ Painel de Controle — Modo Manutenção', iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor(conf.MAINTENANCE_MODE ? '#FF0055' : '#3498DB')
      .setDescription('### 🔧 Controle de Manutenção\n' +
                      'Quando o modo de manutenção está ativo, qualquer interação de usuários comuns com o bot retorna uma mensagem informando que o bot está em manutenção.\n\n' +
                      `**🔴 Status Atual:** ${conf.MAINTENANCE_MODE ? '🔴 ATIVO' : '🟢 DESATIVADO'}\n` +
                      `**👤 Ativado por:** <@${conf.MAINTENANCE_BY || 'N/A'}>\n` +
                      `**🕒 Tempo:** ${since}\n\n` +
                      '**📖 Como Funciona**\n' +
                      'Ao ativar, usuários sem cargo de staff que tentarem usar o bot receberão uma mensagem automática informando manutenção, com botão para suporte.\n\n' +
                      '**🔐 Permissões Master**\n' +
                      `Apenas os cargos ${SUPERIOR_IDS.map(roleId => `<@&${roleId}>`).join(' ')} podem gerenciar este estado.`)
      .addFields(
          { name: '✅ Liberados', value: '`/painel`, `/set` (Staff)', inline: true },
          { name: '⛔ Restritos', value: '`/manutencao` (Geral)', inline: true },
          { name: '📢 Logs no canal', value: conf.DISABLE_CHANNEL_LOGS ? '`Desligados`' : '`Ligados`', inline: true },
          { name: '📩 Logs por DM', value: conf.DISABLE_DM_LOGS ? '`Desligados`' : '`Ligados`', inline: true },
          { name: '🎮 Logs de atividades', value: conf.DISABLE_ACTIVITY_LOGS ? '`Desligados`' : '`Ligados`', inline: true },
          { name: '✨ Boas-vindas', value: '`Sempre ativa`', inline: true },
          { name: 'Canal do ponto', value: `<#${conf.POINT_ACTION_CHANNEL_ID || DEFAULT_POINT_ACTION_CHANNEL_ID}>`, inline: true },
          { name: 'Categoria de ajuste', value: `<#${conf.POINT_ADJUST_CATEGORY_ID || DEFAULT_POINT_ADJUST_CATEGORY_ID}>`, inline: true },
          { name: 'Mudanças registradas', value: readUpdatesSummary().slice(0, 900), inline: false }
      )

    actionRow.addComponents(
      new ButtonBuilder().setCustomId('toggle_maint').setLabel(conf.MAINTENANCE_MODE ? '🟢 Desativar Manutenção' : '🔴 Ativar Manutenção').setStyle(conf.MAINTENANCE_MODE ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('toggle_channel_logs').setLabel(conf.DISABLE_CHANNEL_LOGS ? '📢 Ligar Log' : '🔕 Desligar Log').setStyle(conf.DISABLE_CHANNEL_LOGS ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('toggle_dm_logs').setLabel(conf.DISABLE_DM_LOGS ? '📩 Ligar Log DM' : '📵 Desligar Log DM').setStyle(conf.DISABLE_DM_LOGS ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('toggle_activity_logs').setLabel(conf.DISABLE_ACTIVITY_LOGS ? '🎮 Ligar Logs' : '🎮 Desligar Logs').setStyle(conf.DISABLE_ACTIVITY_LOGS ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('test_notice').setLabel('🧪 Testar Aviso').setStyle(ButtonStyle.Secondary)
    );

    extraRows = [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('select_point_action_channel')
          .setPlaceholder('Selecionar canal de texto onde o ponto funciona')
          .addChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('select_point_adjust_category')
          .setPlaceholder('Selecionar categoria dos pedidos de ajuste de ponto')
          .addChannelTypes(ChannelType.GuildCategory)
          .setMinValues(1)
          .setMaxValues(1)
      ),
    ];
  } else if (tab === 'tab_config') {
    const privateMode = Boolean(conf.PANEL_PRIVATE_MODE);
    embed.setTitle('⚙️ CONFIGURAÇÕES').setColor('#00D9FF')
      .setDescription('### Configuração geral\n\nUse os botões abaixo para abrir a configuração específica de **Set**, **Avisos** ou **Logs**.')
      .addFields(
        { name: 'Canal de logs', value: conf.LOG_CHANNEL ? `<#${conf.LOG_CHANNEL}>` : '`Não configurado`', inline: true },
        { name: '/painel privado', value: privateMode ? '`Ativado`' : '`Desativado`', inline: true },
        { name: 'Set', value: 'Configure cargos e permissões do sistema de set.', inline: true },
        { name: 'Avisos', value: 'Configure DMs e cargo mencionado nos avisos.', inline: true },
        { name: 'Logs', value: 'Configure canal e modos de logs do bot.', inline: true }
      );

    extraRows = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('config_set').setLabel('Set').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('config_avisos').setLabel('Avisos').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('config_logs').setLabel('Logs').setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('toggle_panel_private_mode')
          .setLabel(privateMode ? 'Desativar modo privado' : 'Ativar modo privado')
          .setStyle(privateMode ? ButtonStyle.Success : ButtonStyle.Danger)
      ),
    ];
  } else if (tab === 'config_logs') {
    const selectedLogChannelId = logChannelSelections.get(getSelectionKey(interaction));
    const disabledLogChannelIds = Array.isArray(conf.DISABLED_LOG_CHANNEL_IDS)
      ? conf.DISABLED_LOG_CHANNEL_IDS.map(String)
      : [];
    const selectedLogChannelDisabled = selectedLogChannelId && disabledLogChannelIds.includes(selectedLogChannelId);
    embed.setTitle('⚙️ CONFIGURAÇÕES | LOGS').setColor('#00D9FF')
      .setDescription([
        '### Data logs',
        '',
        'Cada modo abaixo tem um botão próprio para ligar ou desligar.',
        `Somente <@${LOGS_MANAGER_IDS[0]}> ou os cargos máximos ${SUPERIOR_IDS.map((roleId) => `<@&${roleId}>`).join(' ')} podem desativar, reativar ou trocar o canal de logs.`,
        '',
        `Canal/call selecionado: ${selectedLogChannelId ? `<#${selectedLogChannelId}>` : '`Nenhum`'}`,
      ].join('\n'))
      .addFields(
        { name: 'Canal principal', value: conf.LOG_CHANNEL ? `<#${conf.LOG_CHANNEL}>` : '`Não configurado`', inline: true },
        { name: 'Logs do canal', value: conf.DISABLE_CHANNEL_LOGS ? '`Desativados`' : '`Ativados`', inline: true },
        { name: 'Logs por DM', value: conf.DISABLE_DM_LOGS ? '`Desativados`' : '`Ativados`', inline: true },
        { name: 'Logs de atividades', value: conf.DISABLE_ACTIVITY_LOGS ? '`Desativados`' : '`Ativados`', inline: true },
        { name: 'Avisos por DM', value: conf.DISABLE_NOTICE_DMS ? '`Desativados`' : '`Ativados`', inline: true },
        { name: 'Canais com logs desativados', value: formatChannelList(conf.DISABLED_LOG_CHANNEL_IDS), inline: false }
      );

    actionRow.addComponents(
      new ButtonBuilder().setCustomId('toggle_channel_logs').setLabel(conf.DISABLE_CHANNEL_LOGS ? 'Reativar canal' : 'Desativar canal').setStyle(conf.DISABLE_CHANNEL_LOGS ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('toggle_dm_logs').setLabel(conf.DISABLE_DM_LOGS ? 'Reativar DM' : 'Desativar DM').setStyle(conf.DISABLE_DM_LOGS ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('toggle_activity_logs').setLabel(conf.DISABLE_ACTIVITY_LOGS ? 'Reativar atividades' : 'Desativar atividades').setStyle(conf.DISABLE_ACTIVITY_LOGS ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('toggle_notice_dms').setLabel(conf.DISABLE_NOTICE_DMS ? 'Reativar avisos' : 'Desativar avisos').setStyle(conf.DISABLE_NOTICE_DMS ? ButtonStyle.Success : ButtonStyle.Danger)
    );

    extraRows = [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('select_log')
          .setPlaceholder('Selecionar canal para logs')
          .addChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('select_disabled_log_channel')
          .setPlaceholder('Selecionar canal/call para alterar logs')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice)
          .setMinValues(1)
          .setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('toggle_selected_log_channel')
          .setLabel(selectedLogChannelDisabled ? 'Reativar logs desse canal' : 'Desativar logs desse canal')
          .setStyle(selectedLogChannelDisabled ? ButtonStyle.Success : ButtonStyle.Danger)
          .setDisabled(!selectedLogChannelId)
      ),
    ];
  } else if (tab === 'config_avisos') {
    embed.setTitle('⚙️ CONFIGURAÇÕES | AVISOS').setColor('#7000FF')
      .setDescription('### Configurar avisos\n\nControle o envio de DMs globais e escolha um cargo extra para ser mencionado nos avisos. Quando um aviso for publicado, trate como prioridade.')
      .addFields(
        { name: 'Avisos por DM', value: conf.DISABLE_NOTICE_DMS ? '`Desativados`' : '`Ativados`', inline: true },
        { name: 'Cargo extra mencionado', value: conf.NOTICE_MENTION_ROLE_ID ? `<@&${conf.NOTICE_MENTION_ROLE_ID}>` : '`Não configurado`', inline: true }
      );

    const noticeRoleRow = new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId('select_notice_mention_role').setPlaceholder('Selecione o cargo extra mencionado nos avisos').setMinValues(1).setMaxValues(1)
    );
    const noticeButtonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('toggle_notice_dms')
        .setLabel(conf.DISABLE_NOTICE_DMS ? 'Ligar DM de Avisos' : 'Desligar DM de Avisos')
        .setStyle(conf.DISABLE_NOTICE_DMS ? ButtonStyle.Success : ButtonStyle.Danger)
    );
    extraRows = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('config_set').setLabel('Set').setStyle(ButtonStyle.Primary)
      ),
      noticeRoleRow,
      noticeButtonRow,
    ];
  } else if (tab === 'config_set') {
    const permissions = ensureCommandPermissions(conf);
    const setRoles = permissions.set || [];
    embed.setTitle('⚙️ CONFIGURAÇÕES | SET').setColor('#5865F2')
      .setDescription('### Configurar set\n\nSelecione quais cargos podem usar as ações do sistema de set. A manutenção continua exclusiva do cargo master.')
      .addFields(
        { name: 'Cargos liberados para /set', value: formatRoleList(setRoles, '`Todos os Cargos Vortex pelas regras internas`'), inline: false },
        { name: 'Nível Médio Vortex', value: 'Também pode aceitar set e mandar avisos quando configurado em Cargos Vortex.', inline: false }
      );

    commandPermissionSelections.set(getSelectionKey(interaction), 'set');
    const pointRoleRow = new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('select_command_permission_roles')
        .setPlaceholder('Selecionar cargos permitidos para /set')
        .setMinValues(0)
        .setMaxValues(10)
    );
    extraRows = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('config_avisos').setLabel('Avisos').setStyle(ButtonStyle.Primary)
      ),
      pointRoleRow,
    ];
  } else if (tab === 'tab_pontos') {
    const selectedReadjustUserId = pointReadjustSelections.get(getSelectionKey(interaction));
    const pointData = loadJSON(path.join(__dirname, '..', 'pontos.json'))[guild.id] || {};
    const pointAllowedRoles = getPointAllowedRoleIds();
    const openPointOptions = Object.values(pointData)
      .filter((point) => point?.activePointStartedAt)
      .slice(0, 25)
      .map((point) => ({
        label: String(point.userName || point.userId).slice(0, 100),
        description: `Aberto desde ${formatDate(point.activePointStartedAt)}`.slice(0, 100),
        value: String(point.userId),
      }));
    embed.setAuthor({ name: '🕒 VORTEX | GESTÃO DE PONTOS', iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor('#ED4245')
      .setDescription([
        '### Controle de dados de ponto',
        '',
        '**Como funciona**',
        'Use esta aba para deletar dados de ponto ou fazer um reajuste manual.',
        'Para achar a pessoa com mais facilidade, selecione o usuário abaixo antes de clicar em `Reajustar ponto`.',
        '',
        `**Usuário selecionado:** ${selectedReadjustUserId ? `<@${selectedReadjustUserId}>` : '`Nenhum`'}`,
        `**Pontos abertos:** ${openPointOptions.length}`,
        `**Cargos que podem bater ponto/detectar:** ${formatRoleList(pointAllowedRoles)}`,
        '',
        '**Reajuste de ponto**',
        'Informe a hora que abriu o ponto e a hora que fechou o ponto. O sistema soma esse período no total do usuário e salva em `commands/pontos.json`.',
        '',
        'Formato obrigatório: `DD/MM/AAAA HH:mm:ss`. Os segundos são opcionais.',
      ].join('\n'));

    actionRow.addComponents(
      new ButtonBuilder().setCustomId('show_all_points').setLabel('Mostrar todos os pontos').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('show_user_point_sheet').setLabel('Folha do usuário').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('correct_point_close').setLabel('Reajustar ponto').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('close_selected_point').setLabel('Fechar ponto').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('clear_point_user').setLabel('Deletar ponto').setStyle(ButtonStyle.Danger)
    );
    extraRows = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('delete_point_correction_channel').setLabel('Deletar call ajuste').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('clear_point_no_billing').setLabel('Deletar ponto + sem cobrança').setStyle(ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('select_point_readjust_user')
          .setPlaceholder('Selecionar usuário para folha, reajuste, fechamento ou exclusão')
          .setMinValues(1)
          .setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId('select_point_allowed_roles')
          .setPlaceholder('Selecionar cargos que podem bater ponto e detectar')
          .setMinValues(1)
          .setMaxValues(10)
      ),
    ];
  } else if (tab === 'tab_cobrancas') {
    const automationConfig = readAutomationConfig();
    embed.setAuthor({ name: 'VORTEX | COBRANÇAS E PENALIDADES', iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor('#FEE75C')
      .setDescription([
        '### Controle de cobranças automáticas',
        '',
        `Confirmação de ponto aberto: **${automationConfig.pointMonitorEnabled ? 'ligada' : 'desligada'}**`,
        `Cobrança de offline sem ausência: **${automationConfig.offlineChargeEnabled ? 'ligada' : 'desligada'}**`,
        `Ciclo de confirmação: **${automationConfig.pointMonitorDmIntervalHours}h**`,
        `Tentativas por ciclo: **${automationConfig.pointMonitorMaxDmAttempts} DMs**`,
        'Se o usuário confirmar, a contagem zera e começa outro ciclo de 4h. Se ignorar as 3 DMs, o ponto fecha automaticamente.',
        `Canal de penalidades: <#${automationConfig.penaltyChannelId}>`,
        `Categoria de correção: <#${automationConfig.pointCorrectionCategoryId}>`,
        `Cobrança offline: **DM às ${String(automationConfig.offlineChargeHour).padStart(2, '0')}:00 a cada ${automationConfig.offlineChargeIntervalDays} dias**`,
        'Usuários em ausência não recebem essa cobrança.',
        '',
        'Use `Verificar agora` para rodar a cobrança sem esperar o agendador.',
      ].join('\n'));
    actionRow.addComponents(
      new ButtonBuilder().setCustomId('toggle_point_monitor').setLabel(automationConfig.pointMonitorEnabled ? 'Desligar confirmação' : 'Ligar confirmação').setStyle(automationConfig.pointMonitorEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId('toggle_offline_charge').setLabel(automationConfig.offlineChargeEnabled ? 'Desligar cobrança' : 'Ligar cobrança').setStyle(automationConfig.offlineChargeEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId('run_point_automation').setLabel('Verificar agora').setStyle(ButtonStyle.Primary)
    );
  } else if (tab === 'tab_live_stream') {
    const links = getGuildLiveLinks(guild.id);
    const termsAccepted = links.length > 0 || hasAcceptedLiveTerms(guild.id, interaction.user.id);
    const twitchCount = links.filter((link) => link.twitchLogin || parseTwitchLogin(link.url)).length;

    embed.setAuthor({ name: 'VORTEX | LIVE STREAM', iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor('#9146FF')
      .setDescription([
        '### Cadastro de canais de live',
        '',
        'Use esta aba para cadastrar mais canais/usuários de live que devem disparar alerta automático.',
        `Os alertas são enviados em <#${ALERT_CHANNEL_ID}> quando a Twitch informar que o canal ficou online.`,
        '',
        `Termos aceitos: **${termsAccepted ? 'sim' : 'não'}**`,
        `Total cadastrado: **${links.length}**`,
        `Links Twitch monitorados: **${twitchCount}**`,
        '',
        '**Cadastrados**',
        formatLiveLinksList(links),
      ].join('\n'));

    actionRow.addComponents(
      new ButtonBuilder().setCustomId('live_stream_add_link').setLabel('Adicionar usuário').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('live_stream_check_now').setLabel('Verificar agora').setStyle(ButtonStyle.Primary).setDisabled(links.length === 0),
      new ButtonBuilder().setCustomId('live_stream_clear_links').setLabel('Limpar cadastros').setStyle(ButtonStyle.Danger).setDisabled(links.length === 0)
    );

    if (!termsAccepted) {
      extraRows = [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('Aceitar termos')
            .setStyle(ButtonStyle.Link)
            .setURL(buildLiveTermsUrl(guild.id, interaction.user.id))
        ),
      ];
    }
  } else if (tab === 'tab_commands') {
    const permissions = ensureCommandPermissions(conf);
    const selected = commandPermissionSelections.get(getSelectionKey(interaction)) || COMMAND_PERMISSION_OPTIONS[0].value;
    const lines = COMMAND_PERMISSION_OPTIONS.map((option) => {
      const roles = permissions[option.value] || [];
      return `**${option.label}:** ${formatRoleList(roles, '`Todos os Cargos Vortex`')}`;
    }).join('\n');

    embed.setAuthor({ name: 'VORTEX | PERMISSÕES DE COMANDOS', iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor('#00D9FF')
      .setDescription([
        '### Configurar comandos e ações',
        '',
        'Selecione um comando/ação e depois selecione os cargos que podem usar.',
        'Se nenhum cargo for selecionado, o comando fica liberado para todos que passarem nas regras internas dele.',
        '',
        `Modo privado do /painel: **${conf.PANEL_PRIVATE_MODE ? 'ligado' : 'desligado'}**`,
        '',
        lines,
        '',
        `Editando agora: **${selected}**`,
      ].join('\n'));

    extraRows = [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('select_command_permission_target')
          .setPlaceholder('Escolha o comando ou ação para configurar')
          .addOptions(COMMAND_PERMISSION_OPTIONS)
      ),
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId('select_command_permission_roles')
          .setPlaceholder(`Selecionar cargos permitidos para ${selected}`)
          .setMinValues(0)
          .setMaxValues(10)
      ),
    ];
  } else if (tab === 'tab_ausencias') {
    const absenceConfig = getAbsenceConfig();
    const activeAbsences = getActiveGuildAbsences(guild.id);
    const activeList = activeAbsences.length
      ? activeAbsences.slice(0, 10).map((absence, index) => {
          return `${index + 1}. <@${absence.userId}> - volta ${formatAbsenceDate(absence.endsAt)} - ID \`${absence.userId}\``;
        }).join('\n')
      : 'Nenhuma ausência ativa no momento.';

    embed.setAuthor({ name: 'VORTEX | GESTÃO DE AUSÊNCIAS', iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor('#7000FF')
      .setDescription([
        '### Controle de ausências',
        '',
        '**Como funciona**',
        'Use esta aba para configurar o cargo aplicado pelo `/ausencia`, controlar a mensagem de fim e alterar o retorno de quem está ausente.',
        '',
        '**Ausências ativas**',
        activeList,
        '',
        'Para horas, informe o retorno como `12:00` ou `12h`. Para dia/data, use `DD/MM` ou `DD/MM/AAAA`. Para dias, use uma quantidade como `3`.',
      ].join('\n'))
      .addFields(
        { name: 'Cargo de ausência', value: `<@&${absenceConfig.roleId}>`, inline: true },
        { name: 'Mensagem final', value: absenceConfig.disableEndMessage ? '`Desativada`' : '`Ativada`', inline: true },
        { name: 'Canal de logs', value: `<#${absenceConfig.logChannelId || DEFAULT_ABSENCE_LOG_CHANNEL_ID}>`, inline: true },
        { name: 'Ausências ativas', value: String(activeAbsences.length), inline: true }
      );

    actionRow.addComponents(
      new ButtonBuilder().setCustomId('set_absence_role').setLabel('Trocar cargo').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('change_absence_return').setLabel('Alterar retorno').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('toggle_absence_end_message').setLabel(absenceConfig.disableEndMessage ? 'Ligar mensagem' : 'Desligar mensagem').setStyle(absenceConfig.disableEndMessage ? ButtonStyle.Success : ButtonStyle.Danger)
    );
  } else if (tab === 'tab_perfil') {
    const profiles = getGuildProfiles(guild.id);
    const profileConfig = readProfileConfig();
    const selectedProfile = profileRegisterSelections.get(getSelectionKey(interaction)) || {};
    const profileRows = Object.values(profiles).slice(0, 10).map((profile, index) => {
      return `${index + 1}. <@${profile.userId}> - ${profile.nomeGame || profile.displayName || 'Sem nome'} - call ${profile.callChannelId ? `<#${profile.callChannelId}>` : 'N/A'} - ultima atualização ${profile.lastProfileUpdateAt ? formatDate(profile.lastProfileUpdateAt) : 'N/A'}`;
    });

    embed.setAuthor({ name: 'VORTEX | PERFIS', iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor('#00D9FF')
      .setDescription([
        '### Controle de Perfil',
        '',
        'Este módulo acompanha os usuários aprovados no `/set`.',
        'Também permite cadastrar manualmente pessoas que já estão no Discord.',
        'Cada perfil deve ser atualizado a cada 1 dia usando `/perfil link:<link da foto> nivel:<numero>`.',
        'Os links de mídia ficam salvos no JSON mesmo se o arquivo original for apagado.',
        `Cobrança por DM: **${profileConfig.billingDmEnabled ? 'ligada' : 'desligada'}**`,
        `Usuários sem cobrança: **${Array.isArray(profileConfig.billingExemptUserIds) ? profileConfig.billingExemptUserIds.length : 0}**`,
        '',
        `Selecionado no perfil: ${selectedProfile.userId ? `<@${selectedProfile.userId}>` : '`Nenhum usuário`'} | ${selectedProfile.channelId ? `<#${selectedProfile.channelId}>` : '`Nenhuma call/canal`'}`,
        '',
        '**Perfis salvos**',
        profileRows.length ? profileRows.join('\n') : 'Nenhum perfil salvo ainda.',
        '',
        `Data/hora real: ${formatDate(new Date())}`,
      ].join('\n'));

    actionRow.addComponents(
      new ButtonBuilder().setCustomId('profile_register').setLabel('Cadastrar perfil').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('profile_list_registered').setLabel('Ver cadastrados').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('profile_test').setLabel('Testar perfil').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('profile_delete_no_billing').setLabel('Apagar dados').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('profile_toggle_billing').setLabel(profileConfig.billingDmEnabled ? 'Desligar cobrança' : 'Ligar cobrança').setStyle(profileConfig.billingDmEnabled ? ButtonStyle.Danger : ButtonStyle.Success)
    );
    extraRows = [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('select_profile_register_user')
          .setPlaceholder('Selecionar usuário para perfil')
          .setMinValues(1)
          .setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('select_profile_register_channel')
          .setPlaceholder('Selecionar call/canal do usuário')
          .setMinValues(1)
          .setMaxValues(1)
      ),
    ];
  }

  const useCompactNavigation = ['tab_config', 'config_set', 'config_avisos', 'config_logs'].includes(tab);
  let components = useCompactNavigation ? [mainRow] : [mainRow, navRow];
  if (actionRow.components.length > 0) components.push(actionRow);
  if (extraRows.length > 0) components.push(...extraRows);
  if (components.length > 5 && components.includes(navRow)) {
    components = components.filter((row) => row !== navRow);
  }

  const options = edit
    ? { embeds: [embed.setImage(null)], components: components }
    : withPanelImage({ embeds: [embed], components: components });
  if (edit) {
    return safeUpdate(interaction, options).catch(async (err) => {
      await reportPanelError(interaction.client, err, `Atualizar painel: ${tab}`);
      return safeReply(interaction, { content: '❌ Erro ao atualizar o painel. O bug foi enviado para o canal de logs.', ephemeral: true });
    });
  } else {
    return safeReply(interaction, options).catch(async (err) => {
      await reportPanelError(interaction.client, err, `Enviar painel: ${tab}`);
      return null;
    });
  }
}
