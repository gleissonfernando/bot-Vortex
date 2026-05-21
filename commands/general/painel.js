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
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { sendVortexLog, setChannelLogsEnabled } = require('../../utils/notifications');
const { getUserPoint, deleteUserPoint, adjustPointSessionFlexible, closePoint, formatDuration, formatDate } = require('../../utils/pontoManager');
const { setOnlineChannelAccess, updateStatusPanel } = require('../../utils/pontoPanel');
const {
  safeReply,
  safeEdit,
  safeDeferReply,
  safeShowModal,
  safeUpdate: safeInteractionUpdate,
} = require('../../utils/safeReply');
const { buildAllPointsReportPayload } = require('../../utils/pontoReport');
const { getAbsenceConfig, saveAbsenceConfig, getActiveGuildAbsences, updateAbsenceReturn, formatDate: formatAbsenceDate, DEFAULT_ABSENCE_LOG_CHANNEL_ID } = require('../../utils/ausenciaManager');
const {
  getGuildProfiles,
  checkProfileUpdates,
  parseTestPeriod,
  registerManualProfile,
  readProfileConfig,
  toggleProfileBilling,
  toggleProfileUpdateNotifications,
  addBillingExemptUserId,
  deleteUserProfile,
  syncProfilesFromApprovedSetChannels,
} = require('../../utils/profileManager');
const { readAutomationConfig, updateAutomationConfig, runPointAutomationCheck, openPointCorrectionForClosedPoint, deletePointCorrectionChannels } = require('../../utils/pointAutomation');
const { hasAnyVortexRole, hasVortexLevel, hasPanelAccess: canUsePanel } = require('../../utils/permissions');
const { getPointAllowedRoleIds, setPointAllowedRoleIds } = require('../../utils/pointRoleConfig');
const { createPointTranscriptRecord } = require('../../utils/pointTranscriptStore');
const { createPointActionTranscriptSummary } = require('../../utils/pointTranscriptNotifier');
const { ensureVortexHierarchyConfig, getVortexAutoRoles, setVortexAutoRoles } = require('../../utils/vortexHierarchy');
const {
  FACTION_HIERARCHY_ROLES,
  ensureFactionHierarchyConfig,
  getFactionHierarchyConfig,
  getFactionHierarchyRole,
  setFactionHierarchyRoleIds,
  setFactionHierarchyChannelId,
  publishFactionHierarchyPanel,
  updateFactionHierarchyPanel,
  formatConfiguredRoles,
} = require('../../utils/factionHierarchy');
const {
  ensureMirrorMessageConfig,
  getMirrorMessageChannelIds,
  toggleMirrorMessageChannel,
} = require('../../utils/mirrorMessageManager');
const { allowVoiceChannelAccess, fetchVoiceChannels, syncVoiceChannelAccess } = require('../../utils/voiceChannelAccess');
const { allowTextChannelAccess, isTextChannel } = require('../../utils/textChannelAccess');
const {
  PANEL_THEME_TARGETS,
  buildThemedPanelPayload,
  clearPanelVisualTheme,
  getPanelTargetMeta,
  getPanelVisualTheme,
  normalizeBannerRatio,
  normalizeBannerUrl,
  normalizeHexColor,
  setPanelVisualTheme,
} = require('../../utils/panelTheme');
const STATS_PATH = path.join(__dirname, '..', 'stats.json');
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const PANEL_ERROR_LOG_CHANNEL_ID = '1497685822525149337';
const SUPERIOR_IDS = ['1497703127074345040', '1498884908028792942'];
const SUPERIOR_ID = SUPERIOR_IDS[0];
const NOTICE_DM_REENABLE_USER_IDS = ['289227932432334869', '761011766440230932'];
const LOGS_MANAGER_IDS = ['289227932432334869'];
const DEFAULT_POINT_ACTION_CHANNEL_ID = '1498087608390127806';
const DEFAULT_POINT_ADJUST_CATEGORY_ID = '1498087442304073870';
const UPDATES_PATH = path.join(__dirname, '..', '..', 'SISTEMA_ATUALIZACOES.md');
const commandPermissionSelections = new Map();
const vortexRoleModeSelections = new Map();
const pointReadjustSelections = new Map();
const profileRegisterSelections = new Map();
const logChannelSelections = new Map();
const factionHierarchySelections = new Map();
const mirrorMessageSelections = new Map();
const adjustCallSelections = new Map();
const visualThemeSelections = new Map();
const COMMAND_PERMISSION_OPTIONS = [
    { label: '/painel', value: 'painel', description: 'Quem pode usar o painel de controle' },
    { label: '/avisos', value: 'avisos', description: 'Quem pode abrir e enviar avisos' },
    { label: '/clear', value: 'clear', description: 'Quem pode limpar mensagens no chat' },
    { label: '/clipe', value: 'clipe', description: 'Quem pode enviar clipes' },
    { label: '/painelponto', value: 'painelponto', description: 'Quem pode abrir o painel de ponto' },
    { label: '/set', value: 'set', description: 'Quem pode usar o sistema de set' },
    { label: '/serve', value: 'serve', description: 'Quem pode consultar ou usar serve' },
    { label: '/registro', value: 'registro', description: 'Quem pode consultar registro de ponto' },
    { label: '/ponto', value: 'ponto', description: 'Quem pode gerar relatório de ponto' },
    { label: '/ausencia', value: 'ausencia', description: 'Quem pode usar ausência' },
    { label: '/perfil', value: 'perfil', description: 'Quem pode consultar e atualizar perfil' },
    { label: '/ativarponto', value: 'ativarponto', description: 'Quem pode publicar o painel de ponto' },
];
const PANEL_TOOL_OPTIONS = [
    { label: 'Estatísticas', value: 'tab_stats', description: 'Visão geral do servidor e cadastros', emoji: '📊' },
    { label: 'Cargos Vortex', value: 'tab_roles', description: 'Níveis de cargos e acessos principais', emoji: '🛡️' },
    { label: 'Configurações', value: 'tab_config', description: 'Configurações gerais do painel', emoji: '⚙️' },
    { label: 'Configurações - Set', value: 'config_set', description: 'Cargos liberados para o sistema de set', emoji: '📝' },
    { label: 'Configurações - Avisos', value: 'config_avisos', description: 'Avisos por DM e cargo mencionado', emoji: '🔔' },
    { label: 'Configurações - Logs', value: 'config_logs', description: 'Canal de logs e filtros por canal', emoji: '🧾' },
    { label: 'Manutenção', value: 'tab_manutencao', description: 'Modo manutenção e ajustes gerais', emoji: '🛠️' },
    { label: 'Pontos', value: 'tab_pontos', description: 'Folhas, reajustes e cargos de ponto', emoji: '🕒' },
    { label: 'Ausências', value: 'tab_ausencias', description: 'Cargos, retornos e mensagens de ausência', emoji: '📆' },
    { label: 'Comandos', value: 'tab_commands', description: 'Permissões por comando ou ação', emoji: '⌨️' },
    { label: 'Perfil', value: 'tab_perfil', description: 'Cadastros, cobranças e perfis salvos', emoji: '👤' },
    { label: 'Cobranças', value: 'tab_cobrancas', description: 'Cobranças e penalidades automáticas', emoji: '💸' },
    { label: 'Mensagens', value: 'tab_mirror_messages', description: 'Transformar mensagens em painel do bot', emoji: '💬' },
    { label: 'Ajuste', value: 'tab_adjust_calls', description: 'Ativar ou desativar calls de ajuste', emoji: '🔧' },
    { label: 'Visual', value: 'tab_visual', description: 'Cor e banner dos painéis em Components V2', emoji: '🎨' },
    { label: 'Hierarquia FAC', value: 'tab_fac_hierarchy', description: 'Painel automatico da hierarquia da fac', emoji: '🏛️' },
];

function isPanelToolValue(value) {
    return PANEL_TOOL_OPTIONS.some((option) => option.value === value);
}

function buildPanelToolSelectRow(currentTab) {
    const current = PANEL_TOOL_OPTIONS.find((option) => option.value === currentTab) || PANEL_TOOL_OPTIONS[0];
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('select_panel_tool')
            .setPlaceholder(`Ferramenta atual: ${current.emoji ? `${current.emoji} ` : ''}${current.label}`)
            .addOptions(PANEL_TOOL_OPTIONS.map((option) => ({
                ...option,
                default: option.value === current.value,
            })))
    );
}

function getPanelBackTarget(tab) {
    if (['config_set', 'config_avisos', 'config_logs'].includes(tab)) return 'tab_config';
    return 'tab_stats';
}

function buildPanelBackRow(tab) {
    const target = getPanelBackTarget(tab);
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`panel_back_${target}`)
            .setEmoji('⬅️')
            .setLabel(target === 'tab_config' ? 'Voltar para Configurações' : 'Voltar')
            .setStyle(ButtonStyle.Secondary)
    );
}

function getPanelTabMeta(tab) {
    switch (tab) {
        case 'tab_stats': return { icon: '📊', title: 'DASHBOARD' };
        case 'tab_roles': return { icon: '🛡️', title: 'GESTÃO DE ACESSOS' };
        case 'tab_config': return { icon: '⚙️', title: 'CONFIGURAÇÕES' };
        case 'config_set': return { icon: '📝', title: 'CONFIGURAÇÕES | SET' };
        case 'config_avisos': return { icon: '🔔', title: 'CONFIGURAÇÕES | AVISOS' };
        case 'config_logs': return { icon: '🧾', title: 'CONFIGURAÇÕES | LOGS' };
        case 'tab_manutencao': return { icon: '🛠️', title: 'MANUTENÇÃO' };
        case 'tab_pontos': return { icon: '🕒', title: 'GESTÃO DE PONTOS' };
        case 'tab_ausencias': return { icon: '📆', title: 'GESTÃO DE AUSÊNCIAS' };
        case 'tab_commands': return { icon: '⌨️', title: 'PERMISSÕES DE COMANDOS' };
        case 'tab_perfil': return { icon: '👤', title: 'PERFIS' };
        case 'tab_cobrancas': return { icon: '💸', title: 'COBRANÇAS E PENALIDADES' };
        case 'tab_mirror_messages': return { icon: '💬', title: 'MENSAGENS EM PAINEL' };
        case 'tab_adjust_calls': return { icon: '🔧', title: 'AJUSTE DE CALLS' };
        case 'tab_visual': return { icon: '🎨', title: 'VISUAL DOS PAINÉIS' };
        case 'tab_fac_hierarchy': return { icon: '🏛️', title: 'HIERARQUIA DA FAC' };
        default: return { icon: 'V', title: String(tab || '').replace('tab_', '').toUpperCase() };
    }
}

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

function getVortexRoleMode(interaction) {
    return vortexRoleModeSelections.get(getSelectionKey(interaction)) || 'set';
}

function getVisualTargetKey(interaction) {
    return visualThemeSelections.get(getSelectionKey(interaction)) || 'global';
}

function formatVisualTheme(theme) {
    return [
        `Cor: **${theme.color}**${theme.hasOwnColor ? '' : ' (global)'}`,
        `Banner: ${theme.bannerUrl ? `<${theme.bannerUrl}>` : '`Sem banner`'}${theme.hasOwnBanner ? '' : ' (global)'}`,
        `Proporção: **${theme.bannerRatio || '16:9'}**${theme.hasOwnRatio ? '' : ' (global)'}`,
    ].join('\n');
}

function formatRoleList(roleIds, emptyText = '`Nenhum`') {
    const ids = Array.isArray(roleIds) ? roleIds.filter(Boolean).map(String) : [];
    return ids.length ? ids.map(id => `<@&${id}>`).join(' ') : emptyText;
}

function buildCommandAccessPreview(permissions, limit = 8) {
    return COMMAND_PERMISSION_OPTIONS.slice(0, limit).map((option) => {
        const roles = permissions[option.value] || [];
        return `${option.label}: ${formatRoleList(roles, '`Todos os Cargos Vortex`')}`;
    }).join('\n');
}

function buildRegisteredProfilesPreview(profiles, limit = 8) {
    const list = Object.values(profiles || {});
    if (!list.length) return 'Nenhum usuário cadastrado no sistema.';
    return list.slice(0, limit).map((profile, index) => {
        const name = profile.nomeGame || profile.displayName || 'Sem nome';
        return `${index + 1}. <@${profile.userId}> - ${name}`;
    }).join('\n') + (list.length > limit ? `\n... mais ${list.length - limit} cadastro(s).` : '');
}

function formatChannelList(channelIds, emptyText = '`Nenhum canal desativado`') {
    const ids = Array.isArray(channelIds) ? channelIds.filter(Boolean).map(String) : [];
    return ids.length ? ids.map(id => `<#${id}>`).join('\n').slice(0, 1024) : emptyText;
}

function formatLogSwitch(disabled) {
    return disabled ? '🔴 Desativado' : '🟢 Ativo';
}

function formatLogChannelSelection(channelId, disabled) {
    if (!channelId) return '`Nenhum canal selecionado`';
    return `${disabled ? '🔴 Bloqueado' : '🟢 Liberado'} • <#${channelId}>`;
}

function ensureAdjustCallConfig(conf) {
    if (!Array.isArray(conf.ADJUST_CALL_CHANNEL_IDS)) {
        conf.ADJUST_CALL_CHANNEL_IDS = [];
    }
    conf.ADJUST_CALL_CHANNEL_IDS = [...new Set(
        conf.ADJUST_CALL_CHANNEL_IDS
            .filter(Boolean)
            .map(String)
    )];
    return conf.ADJUST_CALL_CHANNEL_IDS;
}

function getAdjustCallChannelIds(conf = loadJSON(CONFIG_PATH)) {
    return ensureAdjustCallConfig(conf);
}

function setAdjustCallEnabled(channelId, enabled) {
    const conf = loadJSON(CONFIG_PATH);
    const ids = new Set(ensureAdjustCallConfig(conf));
    const id = String(channelId);
    if (enabled) ids.add(id);
    else ids.delete(id);
    conf.ADJUST_CALL_CHANNEL_IDS = [...ids];
    saveJSON(CONFIG_PATH, conf);
    return { enabled, channelIds: conf.ADJUST_CALL_CHANNEL_IDS };
}

function isAdjustCallChannel(channel) {
    return channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice;
}

function buildAdjustCallIdModal() {
    return new ModalBuilder()
        .setCustomId('modal_adjust_call_id')
        .setTitle('Selecionar call por ID')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('channel_id')
                    .setLabel('ID da call/canal de voz')
                    .setPlaceholder('Ex: 1234567890123456789')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );
}

function formatAdjustCallOption(channel, activeIds = [], selectedChannelId = null) {
    const isStage = channel.type === ChannelType.GuildStageVoice;
    const parentName = channel.parent?.name || 'Sem categoria';
    const memberCount = channel.members?.size ?? 0;
    const status = activeIds.includes(channel.id) ? 'ativa' : 'desativada';
    return {
        label: String(channel.name || `Call ${channel.id}`).slice(0, 100),
        description: `${isStage ? 'Palco' : 'Call'} | ${parentName} | ${memberCount} online | ${status}`.slice(0, 100),
        value: channel.id,
        default: selectedChannelId === channel.id,
    };
}

async function getAdjustCallSelectData(guild, activeIds = [], selectedChannelId = null) {
    const channels = await fetchVoiceChannels(guild).catch(() => new Map());
    const allOptions = [...channels.values()].map((channel) => formatAdjustCallOption(channel, activeIds, selectedChannelId));
    let options = allOptions.slice(0, 25);

    if (selectedChannelId && !options.some((option) => option.value === selectedChannelId)) {
        const selectedOption = allOptions.find((option) => option.value === selectedChannelId);
        if (selectedOption) options = [...options.slice(0, 24), selectedOption];
    }

    return {
        total: allOptions.length,
        shown: options.length,
        options,
    };
}

async function registerSelectedProfileFromPanel(interaction, selected = {}) {
    const userId = String(selected.userId || '').trim();
    if (!/^\d{15,25}$/.test(userId)) {
        return safeReply(interaction, { content: '❌ Selecione um usuário primeiro.', ephemeral: true });
    }

    await safeDeferReply(interaction, { ephemeral: true });

    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    const target = member?.user || await interaction.client.users.fetch(userId).catch(() => null);
    if (!target) {
        return safeEdit(interaction, { content: '❌ Usuário não encontrado no servidor.' });
    }

    const callChannelId = selected.channelId ? String(selected.channelId) : null;
    if (callChannelId) {
        const channel = await interaction.guild.channels.fetch(callChannelId).catch(() => null);
        if (!isTextChannel(channel)) {
            return safeEdit(interaction, { content: '❌ O canal selecionado não é um canal de texto válido. Selecione outro canal.' });
        }
        await allowTextChannelAccess(channel, interaction.guild).catch(() => null);
    }

    const result = await registerManualProfile(interaction.guild, target, {
        name: member?.displayName || target.username,
        callChannelId,
        registeredBy: interaction.user.id,
    });

    if (!result.ok) {
        return safeEdit(interaction, { content: `❌ ${result.message}` });
    }

    profileRegisterSelections.set(getSelectionKey(interaction), {
        ...selected,
        userId,
        channelId: result.profile.callChannelId || selected.channelId || null,
    });

    await target.send({
        content: [
            '✅ Você foi cadastrado no sistema Vortex.',
            `Servidor: ${interaction.guild.name}`,
            `Cadastrado por: <@${interaction.user.id}>`,
            `Nome salvo: ${result.profile.nomeGame || result.profile.displayName}`,
            result.profile.callChannelId ? `Canal de texto vinculado: <#${result.profile.callChannelId}>` : null,
            '',
            'Agora você pode usar os recursos liberados para usuários cadastrados.',
        ].filter(Boolean).join('\n'),
        allowedMentions: { users: [interaction.user.id] },
    }).catch(() => null);

    return safeEdit(interaction, {
        content: [
            '✅ Perfil cadastrado no sistema.',
            `Usuário: <@${userId}>`,
            `Nome: ${result.profile.nomeGame || result.profile.displayName}`,
            `Canal de texto: ${result.profile.callChannelId ? `<#${result.profile.callChannelId}>` : 'N/A'}`,
            `Data/hora real: ${formatDate(new Date())}`,
            '',
            'Abra o painel novamente ou volte para a aba de perfil para ver a lista atualizada.',
        ].join('\n'),
    });
}

function parsePanelColor(value, fallback = 0x7000FF) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const hex = String(value || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{6}$/i.test(hex)) return parseInt(hex, 16);
    return fallback;
}

function createPanelView(tabMeta) {
    return {
        color: 0x7000FF,
        authorName: `VORTEX ${tabMeta.icon} | ${tabMeta.title}`,
        description: '',
        fields: [],
        footerText: null,
        setAuthor(author = {}) {
            if (author.name) this.authorName = author.name;
            return this;
        },
        setColor(color) {
            this.color = parsePanelColor(color, this.color);
            return this;
        },
        setDescription(description) {
            this.description = String(description || '');
            return this;
        },
        addFields(...fields) {
            this.fields.push(...fields.flat().filter(Boolean));
            return this;
        },
        setFooter(footer = {}) {
            this.footerText = footer.text || null;
            return this;
        },
        setTimestamp() {
            return this;
        },
        setImage() {
            return this;
        },
    };
}

function buildPanelV2Payload(panelView, rows = []) {
    return buildThemedPanelPayload('painel', {
        color: panelView.color,
        author: { name: panelView.authorName },
        description: panelView.description,
        fields: panelView.fields,
        footer: panelView.footerText ? { text: panelView.footerText } : null,
    }, { components: rows });
}

function isUnknownInteractionError(error) {
    return error?.code === 10062 || error?.rawError?.code === 10062;
}

async function safeUpdate(interaction, options) {
    const { ephemeral, ...updateOptions } = options;
    if (interaction.replied || interaction.deferred) {
        return safeEdit(interaction, options);
    }
    try {
        return await safeInteractionUpdate(interaction, updateOptions);
    } catch (error) {
        if (isUnknownInteractionError(error)) return null;
        try {
            return await safeReply(interaction, options);
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

function formatTranscriptPeriod(startKey, endKey) {
    const [sy, sm, sd] = String(startKey || '').split('-');
    const [ey, em, ed] = String(endKey || '').split('-');
    if (!sy || !sm || !sd || !ey || !em || !ed) return 'Periodo indisponivel';
    return `${sd}/${sm}/${sy} ate ${ed}/${em}/${ey}`;
}

function formatTranscriptRecordPeriod(record) {
    return record?.periodLabel || formatTranscriptPeriod(record?.weekStartKey, record?.weekEndKey);
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

    if (customId.startsWith('panel_back_')) {
      const target = customId.replace('panel_back_', '');
      if (!isPanelToolValue(target)) {
        return safeReply(interaction, { content: '❌ Destino inválido.', ephemeral: true });
      }
      return renderDashboard(interaction, target, true);
    }

    if (!hasStaffPermission(interaction.member) && !hasLogsManagerPermission(interaction)) return safeReply(interaction, { content: '❌ Sem permissão para usar esta ação.', ephemeral: true });

    if ((customId === 'tab_manutencao' || ['toggle_maint', 'test_notice'].includes(customId)) && !hasMasterPermission(interaction.member)) {
      return safeReply(interaction, { content: `❌ Somente os cargos ${SUPERIOR_IDS.map(roleId => `<@&${roleId}>`).join(' ')} podem usar a manutenção.`, ephemeral: true });
    }

    if (customId === 'visual_set_color' || customId === 'visual_set_banner') {
      if (!hasVortexLevel(interaction.member, ['admin'])) {
        return safeReply(interaction, { content: '❌ Apenas Admin Vortex pode alterar o visual dos painéis.', ephemeral: true });
      }

      const targetKey = getVisualTargetKey(interaction);
      const target = getPanelTargetMeta(targetKey);
      const theme = getPanelVisualTheme(targetKey);
      const modal = new ModalBuilder()
        .setCustomId(customId === 'visual_set_color' ? 'modal_visual_color' : 'modal_visual_banner')
        .setTitle(customId === 'visual_set_color' ? 'Cor do painel' : 'Banner do painel');

      if (customId === 'visual_set_color') {
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('color')
            .setLabel(`Cor para ${target.label}`)
            .setPlaceholder('#7000FF')
            .setValue(theme.color || '#7000FF')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(7)
        ));
      } else {
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('banner_url')
              .setLabel(`URL do banner para ${target.label}`)
              .setPlaceholder('https://exemplo.com/banner.png')
              .setValue(theme.bannerUrl || '')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setMaxLength(400)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('banner_ratio')
              .setLabel('Proporção do banner')
              .setPlaceholder('16:9, 21:9, 3:1...')
              .setValue(theme.bannerRatio || '16:9')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(12)
          )
        );
      }

      return safeShowModal(interaction, modal);
    }

    if (customId === 'visual_clear_target') {
      if (!hasVortexLevel(interaction.member, ['admin'])) {
        return safeReply(interaction, { content: '❌ Apenas Admin Vortex pode limpar o visual dos painéis.', ephemeral: true });
      }

      const targetKey = getVisualTargetKey(interaction);
      const target = getPanelTargetMeta(targetKey);
      clearPanelVisualTheme(targetKey);

      sendVortexLog(interaction.client, {
        title: 'Visual de Painel Resetado',
        description: `Visual de **${target.label}** resetado por <@${interaction.user.id}>.`,
        color: '#7000FF',
        type: 'CONFIGURAÇÃO',
        userId: interaction.user.id,
      }).catch(() => {});

      return renderDashboard(interaction, 'tab_visual', true);
    }

    if (customId === 'show_all_points') {
      await safeDeferReply(interaction, { ephemeral: true });
      const payload = await buildAllPointsReportPayload(interaction.guild);

      sendVortexLog(interaction.client, {
          title: 'Relatorio Completo de Pontos Gerado',
          description: `O relatório completo de pontos foi gerado por <@${interaction.user.id}> (${interaction.user.id}).`,
          color: '#7000FF',
          type: 'PONTO',
          userId: interaction.user.id
      }).catch(() => {});

      return safeEdit(interaction, payload);
    }

    if (customId === 'show_user_point_sheet') {
      await safeDeferReply(interaction, { ephemeral: true });
      const userId = pointReadjustSelections.get(getSelectionKey(interaction));
      if (!userId) return safeEdit(interaction, { content: '❌ Selecione um usuário primeiro.' });

      const target = await interaction.client.users.fetch(userId).catch(() => null);
      if (!target) return safeEdit(interaction, { content: '❌ Não consegui encontrar esse usuário.' });

      const data = await getUserPoint(interaction.guild.id, userId).catch(() => null);
      if (!data || (!data.activePointStartedAt && !Array.isArray(data.sessions))) {
        return safeEdit(interaction, { content: `❌ <@${userId}> ainda não possui ponto registrado.` });
      }

      let transcript = null;
      try {
        transcript = await createPointTranscriptRecord({
          guild: interaction.guild,
          target,
          generatedBy: interaction.user,
        });
      } catch (error) {
        await reportPanelError(interaction.client, error, 'Gerar folha/transcript de ponto');
        return safeEdit(interaction, {
          content: '❌ Não consegui salvar o transcript web deste usuário. O erro foi enviado para os logs.',
        });
      }

      sendVortexLog(interaction.client, {
        title: 'Folha de Ponto Gerada',
        description: `A folha/transcript de <@${userId}> (${userId}) foi gerada por <@${interaction.user.id}> (${interaction.user.id}).`,
        color: '#7000FF',
        type: 'PONTO',
        userId: interaction.user.id,
      }).catch(() => {});

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Ver Transcript')
          .setStyle(ButtonStyle.Link)
          .setURL(transcript.url)
      );

      const { record } = transcript;
      const transcriptEmbed = new EmbedBuilder()
        .setColor('#005DFF')
        .setAuthor({
          name: 'VORTEX | TRANSCRIPT DE PONTO',
          iconURL: interaction.client.user?.displayAvatarURL?.() || undefined,
        })
        .setTitle('Relatorio de Ponto Gerado')
        .setDescription([
          `Folha/transcript de <@${userId}> gerada com sucesso.`,
          '',
          'O historico completo fica disponivel apenas no link web abaixo.',
        ].join('\n'))
        .addFields(
          { name: 'Usuario', value: `<@${userId}>`, inline: true },
          { name: 'Periodo', value: formatTranscriptRecordPeriod(record), inline: true },
          { name: 'Cargo/faccao', value: record.factionName || 'N/A', inline: true },
          { name: 'Total semanal', value: record.summary?.weeklyTotal || '0h', inline: true },
          { name: 'Total mensal', value: record.summary?.monthlyTotal || '0h', inline: true },
          { name: 'Dias trabalhados', value: String(record.summary?.daysWithPoints ?? 0), inline: true },
          { name: 'Ajustes manuais', value: String(record.summary?.manualAdjustments ?? 0), inline: true },
          { name: 'Transcript ID', value: `\`${record.id}\``, inline: true },
          { name: 'Expira em', value: record.expiresAt ? formatDate(record.expiresAt) : 'N/A', inline: true }
        )
        .setFooter({ text: 'Vortex Bot • Transcript Web' })
        .setTimestamp();

      if (target.displayAvatarURL) {
        transcriptEmbed.setThumbnail(target.displayAvatarURL({ size: 256 }));
      }

      return safeEdit(interaction, buildThemedPanelPayload('painelponto', transcriptEmbed, {
        components: [row],
        allowedMentions: { users: [userId] },
      }));
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
      await safeDeferReply(interaction, { ephemeral: true });
      await runPointAutomationCheck(interaction.client, { force: true });
      return safeEdit(interaction, { content: '✅ Verificação de ponto, perfil e cobranças executada agora.' });
    }

    if (customId === 'close_selected_point') {
      await safeDeferReply(interaction, { ephemeral: true });
      const userId = pointReadjustSelections.get(getSelectionKey(interaction));
      if (!userId) return safeEdit(interaction, { content: '❌ Selecione um usuário primeiro.' });
      const pointData = loadJSON(path.join(__dirname, '..', 'pontos.json'))[interaction.guild.id]?.[userId];
      if (!pointData?.activePointStartedAt) {
        return safeEdit(interaction, { content: `❌ <@${userId}> não está com ponto aberto.` });
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
      return safeEdit(interaction, {
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
      await safeDeferReply(interaction, { ephemeral: true });
      const userId = pointReadjustSelections.get(getSelectionKey(interaction));
      if (!userId) return safeEdit(interaction, { content: '❌ Selecione um usuário primeiro.' });
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

      return safeEdit(interaction, {
        content: deleted.length
          ? `✅ Call/canal de ajuste de <@${userId}> deletado. Total: ${deleted.length}.`
          : `⚠️ Nenhuma call/canal de ajuste encontrada para <@${userId}>.`,
      });
    }

    if (customId === 'clear_point_no_billing') {
      await safeDeferReply(interaction, { ephemeral: true });
      const userId = pointReadjustSelections.get(getSelectionKey(interaction));
      if (!userId) return safeEdit(interaction, { content: '❌ Selecione um usuário primeiro.' });

      const existed = await deleteUserPoint(interaction.guild.id, userId);
      const exempt = addBillingExemptUserId(userId, interaction.user.id);
      if (!exempt.ok) return safeEdit(interaction, { content: `❌ ${exempt.message}` });

      await setOnlineChannelAccess(interaction.client, interaction.guild.id, userId, false).catch(() => null);
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

      return safeEdit(interaction, {
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
      await safeDeferReply(interaction, { ephemeral: true });
      const userId = customId.replace('confirm_close_point_', '');
      const pointBeforeClose = loadJSON(path.join(__dirname, '..', 'pontos.json'))[interaction.guild.id]?.[userId] || {};
      const targetUser = await interaction.client.users.fetch(userId).catch(() => null);
      const result = await closePoint(interaction.guild.id, userId);
      if (result.action === 'already_closed') {
        return safeEdit(interaction, { content: `❌ <@${userId}> não está com ponto aberto.` });
      }
      await setOnlineChannelAccess(interaction.client, interaction.guild.id, userId, false).catch(() => null);
      await updateStatusPanel(interaction.client, interaction.guild.id).catch(() => null);
      const pointSummary = targetUser ? await createPointActionTranscriptSummary({
        guild: interaction.guild,
        target: targetUser,
        generatedBy: interaction.user,
        action: 'closed',
        result,
      }) : null;
      if (targetUser) {
        await targetUser.send({
          content: [
            '⚠️ Seu ponto foi fechado manualmente pela gerência.',
            `Fechado por: <@${interaction.user.id}>`,
            '',
            pointSummary?.content || [
              `Horário registrado: ${formatDate(result.data.lastPointCloseAt)}`,
              `Tempo contabilizado: ${formatDuration(result.durationMs)}`,
            ].join('\n'),
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
      return safeEdit(interaction, {
        content: [
          `✅ Ponto de <@${userId}> fechado. Tempo: ${formatDuration(result.durationMs)}.`,
          pointSummary?.transcriptUrl ? `Transcript: ${pointSummary.transcriptUrl}` : null,
          correctionChannel ? `Canal de correção: <#${correctionChannel.id}>` : 'Canal de correção: não criado.',
        ].filter(Boolean).join('\n'),
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

    if (customId === 'send_test_log') {
      if (!hasLogsManagerPermission(interaction)) {
        return safeReply(interaction, { content: '❌ Apenas o responsável pelos logs pode enviar teste de logs.', ephemeral: true });
      }

      await sendVortexLog(interaction.client, {
        title: 'Teste do Painel de Logs',
        description: [
          `Teste enviado por <@${interaction.user.id}>.`,
          `Canal principal configurado: ${conf.LOG_CHANNEL ? `<#${conf.LOG_CHANNEL}>` : 'nenhum'}.`,
          `Data/hora real: ${formatDate(new Date())}`,
        ].join('\n'),
        color: '#00D9FF',
        type: 'CONFIGURAÇÃO',
        userId: interaction.user.id
      }).catch((error) => reportPanelError(interaction.client, error, 'Enviar teste de logs'));

      return safeReply(interaction, { content: '✅ Teste de log enviado.', ephemeral: true });
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

    if (customId === 'toggle_vortex_role_remove_mode') {
      if (!hasVortexLevel(interaction.member, ['admin'])) {
        return safeReply(interaction, { content: '❌ Apenas Admin Vortex pode alterar Cargos Vortex.', ephemeral: true });
      }

      const key = getSelectionKey(interaction);
      const nextMode = vortexRoleModeSelections.get(key) === 'remove' ? 'set' : 'remove';
      vortexRoleModeSelections.set(key, nextMode);

      return renderDashboard(interaction, 'tab_roles', true);
    }

    if (customId === 'set_vortex_auto_pending' || customId === 'set_vortex_auto_approved') {
      if (!hasVortexLevel(interaction.member, ['admin'])) {
        return safeReply(interaction, { content: '❌ Apenas Admin Vortex pode alterar cargos automáticos.', ephemeral: true });
      }

      const type = customId === 'set_vortex_auto_pending' ? 'pending' : 'approved';
      const autoRoles = getVortexAutoRoles(conf);
      const modal = new ModalBuilder()
        .setCustomId(`modal_vortex_auto_role_${type}`)
        .setTitle(type === 'pending' ? 'Cargo Automático Pendente' : 'Cargo Automático Aprovado');

      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('role_ids')
          .setLabel('IDS DOS CARGOS')
          .setPlaceholder('Cole 1 ou mais IDs separados por vírgula')
          .setValue((autoRoles[type] || []).join(', '))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
      ));

      return safeShowModal(interaction, modal);
    }

    if (customId === 'publish_fac_hierarchy_panel' || customId === 'refresh_fac_hierarchy_panel') {
      if (!hasVortexLevel(interaction.member, ['admin', 'medio'])) {
        return safeReply(interaction, { content: '❌ Seu nível não libera o painel de hierarquia da fac.', ephemeral: true });
      }

      await safeDeferReply(interaction, { ephemeral: true });
      const result = customId === 'publish_fac_hierarchy_panel'
        ? await publishFactionHierarchyPanel(interaction).catch((error) => ({ ok: false, message: error.message }))
        : await updateFactionHierarchyPanel(interaction.client, interaction.guild.id).catch((error) => ({ ok: false, message: error.message }));

      return safeEdit(interaction, {
        content: `${result.ok ? '✅' : '❌'} ${result.message}`,
      });
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

        return safeReply(interaction, buildThemedPanelPayload('painel', maintEmbed, {
            components: [maintBtn],
            ephemeral: true,
        }));
    }

    if (customId === 'open_adjust_call_v2') {
        if (!hasVortexLevel(interaction.member, ['admin', 'medio'])) {
            return safeReply(interaction, { content: '❌ Seu nível não libera a ferramenta de ajuste.', ephemeral: true });
        }

        return renderDashboard(interaction, 'tab_adjust_calls', true);
    }

    if (customId === 'adjust_call_select_by_id') {
        if (!hasVortexLevel(interaction.member, ['admin', 'medio'])) {
            return safeReply(interaction, { content: '❌ Seu nível não libera a ferramenta de ajuste.', ephemeral: true });
        }

        return safeShowModal(interaction, buildAdjustCallIdModal());
    }

    if (customId === 'adjust_call_sync') {
        if (!hasVortexLevel(interaction.member, ['admin', 'medio'])) {
            return safeReply(interaction, { content: '❌ Seu nível não libera a ferramenta de ajuste.', ephemeral: true });
        }

        await syncVoiceChannelAccess(interaction.guild).catch((error) => reportPanelError(interaction.client, error, 'Sincronizar calls'));
        return renderDashboard(interaction, 'tab_adjust_calls', true);
    }

    if (customId === 'adjust_call_activate' || customId === 'adjust_call_deactivate') {
        if (!hasVortexLevel(interaction.member, ['admin', 'medio'])) {
            return safeReply(interaction, { content: '❌ Seu nível não libera a ferramenta de ajuste.', ephemeral: true });
        }

        const selectedChannelId = adjustCallSelections.get(getSelectionKey(interaction));
        if (!selectedChannelId) {
            return safeReply(interaction, { content: '❌ Selecione uma call primeiro.', ephemeral: true });
        }

        const channel = await interaction.guild.channels.fetch(selectedChannelId).catch(() => null);
        if (!isAdjustCallChannel(channel)) {
            adjustCallSelections.delete(getSelectionKey(interaction));
            return safeReply(interaction, { content: '❌ A call selecionada não existe mais ou não é uma call válida.', ephemeral: true });
        }

        const enabled = customId === 'adjust_call_activate';
        const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
        if (botMember && !channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels)) {
            return safeReply(interaction, {
                content: `❌ Não tenho permissão para gerenciar a call <#${channel.id}>.`,
                ephemeral: true,
            });
        }

        try {
            if (enabled) {
                await allowVoiceChannelAccess(channel, interaction.guild).catch(() => null);
            }

            await channel.permissionOverwrites.edit(interaction.guild.id, {
                Connect: enabled,
            }, {
                reason: `Call de ajuste ${enabled ? 'ativada' : 'desativada'} por ${interaction.user.tag || interaction.user.id}`,
            });
        } catch (error) {
            await reportPanelError(interaction.client, error, `Alterar call de ajuste: ${selectedChannelId}`);
            return safeReply(interaction, {
                content: '❌ Não consegui alterar essa call. O erro foi enviado para os logs.',
                ephemeral: true,
            });
        }

        const result = setAdjustCallEnabled(channel.id, enabled);
        sendVortexLog(interaction.client, {
            title: enabled ? 'Call de Ajuste Ativada' : 'Call de Ajuste Desativada',
            description: [
                `Call: <#${channel.id}> (${channel.id})`,
                `Status: **${enabled ? 'ativada' : 'desativada'}**`,
                `Calls ativas agora: **${result.channelIds.length}**`,
                `Alterado por: <@${interaction.user.id}>`,
            ].join('\n'),
            color: enabled ? '#57F287' : '#FF0055',
            type: 'CONFIGURAÇÃO',
            userId: interaction.user.id,
        }).catch(() => {});

        return renderDashboard(interaction, 'tab_adjust_calls', true);
    }

    if (customId === 'toggle_mirror_message_channel') {
        if (!hasVortexLevel(interaction.member, ['admin', 'medio'])) {
            return safeReply(interaction, { content: '❌ Seu nível não libera configuração de mensagens.', ephemeral: true });
        }
        const selectedChannelId = mirrorMessageSelections.get(getSelectionKey(interaction));
        if (!selectedChannelId) {
            return safeReply(interaction, { content: '❌ Selecione um canal primeiro.', ephemeral: true });
        }

        const result = toggleMirrorMessageChannel(selectedChannelId);
        sendVortexLog(interaction.client, {
            title: 'Canal de Mensagem em Painel Alterado',
            description: [
                `Canal: <#${selectedChannelId}>`,
                `Status: **${result.enabled ? 'ativado' : 'desativado'}**`,
                `Alterado por: <@${interaction.user.id}>`,
            ].join('\n'),
            color: result.enabled ? '#005DFF' : '#FF0055',
            type: 'CONFIGURAÇÃO',
            userId: interaction.user.id
        }).catch(() => {});

        return renderDashboard(interaction, 'tab_mirror_messages', true);
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

        return safeShowModal(interaction, modal);
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

        return safeShowModal(interaction, modal);
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
                    .setPlaceholder('Exemplo: 30/04 ou 30/04/2026')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );

        return safeShowModal(interaction, modal);
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

        return safeShowModal(interaction, modal);
    }

    if (customId === 'profile_register') {
        const selected = profileRegisterSelections.get(getSelectionKey(interaction)) || {};
        if (selected.userId) {
            return registerSelectedProfileFromPanel(interaction, selected);
        }

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
                    .setPlaceholder('Opcional: se vazio, usa o nome do Discord')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('call_channel_id')
                    .setLabel('ID DO CANAL DE TEXTO')
                    .setPlaceholder('Selecione no painel ou cole o ID do canal de texto')
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

        return safeShowModal(interaction, modal);
    }

    if (customId === 'profile_delete_no_billing') {
        await safeDeferReply(interaction, { ephemeral: true });
        const selected = profileRegisterSelections.get(getSelectionKey(interaction)) || {};
        const userId = selected.userId;
        if (!userId) return safeEdit(interaction, { content: '❌ Selecione um usuário primeiro.' });

        const result = await deleteUserProfile(
            interaction.guild,
            userId,
            `Perfil deletado no /painel por ${interaction.user.tag || interaction.user.id}`
        );

        sendVortexLog(interaction.client, {
            title: 'Perfil deletado',
            description: [
                `Usuário: <@${userId}> (${userId})`,
                `Gerente: <@${interaction.user.id}>`,
                `Perfil existia: ${result.deleted ? 'sim' : 'não'}`,
                `Registros removidos: ${result.deletedCount || 0}`,
                `Canal deletado: ${result.channelDeleted ? 'sim' : 'não'}`,
                `Cargo aprovado removido: ${result.approvedRoleRemoved ? 'sim' : 'não'}`,
                `Cargo pendente adicionado: ${result.pendingRoleAdded ? 'sim' : 'não'}`,
            ].join('\n'),
            color: '#FF0055',
            type: 'PERFIL',
            userId: interaction.user.id
        }).catch(() => {});

        return safeEdit(interaction, {
            content: [
                result.deleted
                    ? `✅ Cadastro de <@${userId}> apagado.`
                    : `⚠️ Nenhum perfil salvo encontrado para <@${userId}>.`,
                result.deleted ? `✅ Registros removidos: ${result.deletedCount || 1}. O usuário pode pedir outro /set.` : null,
                result.channelDeleted
                    ? '✅ Canal/call vinculado deletado.'
                    : 'ℹ️ Nenhum canal/call vinculado foi deletado.',
                result.approvedRoleRemoved ? '✅ Cargo de aprovado removido.' : 'ℹ️ Cargo de aprovado não foi removido.',
                result.pendingRoleAdded ? '✅ Cargo pendente adicionado.' : 'ℹ️ Cargo pendente não foi adicionado.',
            ].filter(Boolean).join('\n'),
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

    if (customId === 'profile_toggle_update_notifications') {
        const next = toggleProfileUpdateNotifications();
        sendVortexLog(interaction.client, {
            title: 'Notificacao de Perfil Alterada',
            description: `Notificações de atualização de perfil foram **${next.profileUpdateNotificationsEnabled ? 'LIGADAS' : 'DESLIGADAS'}** por <@${interaction.user.id}>.\nData/hora real: ${formatDate(new Date())}`,
            color: next.profileUpdateNotificationsEnabled ? '#57F287' : '#FFA500',
            type: 'PERFIL',
            userId: interaction.user.id
        }).catch(() => {});
        return renderDashboard(interaction, 'tab_perfil', true);
    }

    if (customId === 'profile_list_registered') {
        await safeDeferReply(interaction, { ephemeral: true });
        const profiles = getGuildProfiles(interaction.guild.id);
        const report = buildRegisteredProfilesReport(interaction.guild, profiles);
        const file = new AttachmentBuilder(Buffer.from(report, 'utf8'), {
            name: `usuarios-cadastrados-${interaction.guild.id}.txt`,
        });
        return safeEdit(interaction, {
            content: `✅ Relatório gerado com **${Object.keys(profiles).length}** usuários cadastrados.`,
            files: [file],
        });
    }

  },

  async handleSelectMenu(interaction) {
    if (!hasPanelAccess(interaction.member)) return safeReply(interaction, { content: '❌ Você precisa estar cadastrado no /painel para usar esta seleção.', ephemeral: true });

    if (interaction.customId === 'select_panel_tool') {
        const selectedTool = interaction.values[0];
        if (!isPanelToolValue(selectedTool)) {
            return safeReply(interaction, { content: '❌ Ferramenta inválida.', ephemeral: true });
        }
        return renderDashboard(interaction, selectedTool, true);
    }

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

    if (interaction.customId === 'select_mirror_message_channel') {
        if (!hasVortexLevel(interaction.member, ['admin', 'medio'])) {
            return safeReply(interaction, { content: '❌ Seu nível não libera configuração de mensagens.', ephemeral: true });
        }
        mirrorMessageSelections.set(getSelectionKey(interaction), String(interaction.values[0]));
        return renderDashboard(interaction, 'tab_mirror_messages', true);
    }

    if (interaction.customId === 'select_adjust_call_id') {
        if (!hasVortexLevel(interaction.member, ['admin', 'medio'])) {
            return safeReply(interaction, { content: '❌ Seu nível não libera a ferramenta de ajuste.', ephemeral: true });
        }

        const channelId = String(interaction.values[0]);
        const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (!isAdjustCallChannel(channel)) {
            return safeReply(interaction, { content: '❌ Essa call não existe mais ou não é uma call válida.', ephemeral: true });
        }

        adjustCallSelections.set(getSelectionKey(interaction), channelId);
        await allowVoiceChannelAccess(channel, interaction.guild).catch(() => null);
        return renderDashboard(interaction, 'tab_adjust_calls', true);
    }

    if (interaction.customId === 'select_adjust_call_channel') {
        if (!hasVortexLevel(interaction.member, ['admin', 'medio'])) {
            return safeReply(interaction, { content: '❌ Seu nível não libera a ferramenta de ajuste.', ephemeral: true });
        }

        const channelId = String(interaction.values[0]);
        const channel = interaction.channels?.get(channelId) || await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (!isAdjustCallChannel(channel)) {
            return safeReply(interaction, { content: '❌ Selecione uma call válida.', ephemeral: true });
        }

        adjustCallSelections.set(getSelectionKey(interaction), channelId);
        return renderDashboard(interaction, 'tab_adjust_calls', true);
    }

    if (interaction.customId === 'select_visual_target') {
        if (!hasVortexLevel(interaction.member, ['admin'])) {
            return safeReply(interaction, { content: '❌ Apenas Admin Vortex pode configurar o visual dos painéis.', ephemeral: true });
        }

        const targetKey = interaction.values[0];
        if (!PANEL_THEME_TARGETS.some((target) => target.key === targetKey)) {
            return safeReply(interaction, { content: '❌ Painel visual inválido.', ephemeral: true });
        }

        visualThemeSelections.set(getSelectionKey(interaction), targetKey);
        return renderDashboard(interaction, 'tab_visual', true);
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

    if (interaction.customId === 'select_fac_hierarchy_channel') {
        if (!hasVortexLevel(interaction.member, ['admin', 'medio'])) return safeReply(interaction, { content: '❌ Seu nível não libera essa configuração.', ephemeral: true });
        const hierarchy = setFactionHierarchyChannelId(interaction.values[0]);

        sendVortexLog(interaction.client, {
            title: 'Canal da Hierarquia FAC Alterado',
            description: `Canal do painel de hierarquia da fac alterado para <#${hierarchy.channelId}> por <@${interaction.user.id}>.`,
            color: '#7000FF',
            type: 'SEGURANÇA',
            userId: interaction.user.id
        }).catch(() => {});

        return renderDashboard(interaction, 'tab_fac_hierarchy', true);
    }

    if (interaction.customId.startsWith('select_fac_hierarchy_role_')) {
        if (!hasVortexLevel(interaction.member, ['admin', 'medio'])) return safeReply(interaction, { content: '❌ Seu nível não libera essa configuração.', ephemeral: true });
        const roleKey = interaction.customId.replace('select_fac_hierarchy_role_', '');
        const role = getFactionHierarchyRole(roleKey);
        if (!role) return safeReply(interaction, { content: '❌ Cargo da hierarquia inválido.', ephemeral: true });

        const hierarchy = setFactionHierarchyRoleIds(role.key, interaction.values);
        await updateFactionHierarchyPanel(interaction.client, interaction.guild.id).catch(() => null);

        sendVortexLog(interaction.client, {
            title: 'Cargo da Hierarquia FAC Alterado',
            description: [
                `Posição: **${role.label}**`,
                `Cargo(s): ${formatConfiguredRoles(hierarchy.roles[role.key])}`,
                `Por <@${interaction.user.id}>.`,
            ].join('\n'),
            color: '#7000FF',
            type: 'SEGURANÇA',
            userId: interaction.user.id
        }).catch(() => {});

        return renderDashboard(interaction, 'tab_fac_hierarchy', true);
    }

    if (interaction.customId.startsWith('select_vortex_role_')) {
        if (!hasVortexLevel(interaction.member, ['admin'])) return safeReply(interaction, { content: '❌ Apenas Admin Vortex pode alterar Cargos Vortex.', ephemeral: true });
        const level = interaction.customId.replace('select_vortex_role_', '');
        const levels = ensureRoleLevels(data);
        const mode = getVortexRoleMode(interaction);
        const selectedRoles = interaction.values.map(String);
        const currentRoles = Array.isArray(levels[level]) ? levels[level].map(String) : [];
        levels[level] = mode === 'remove'
          ? currentRoles.filter((roleId) => !selectedRoles.includes(roleId))
          : selectedRoles;
        saveJSON(CONFIG_PATH, data);

        sendVortexLog(interaction.client, {
            title: 'Cargo Vortex Alterado',
            description: [
              `Nivel **${level}** atualizado para: ${levels[level].map(id => `<@&${id}>`).join(' ') || 'nenhum'}`,
              `Modo usado: **${mode === 'remove' ? 'remover' : 'definir'}**`,
              `Por <@${interaction.user.id}>.`,
            ].join('\n'),
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

    if (interaction.customId === 'select_fac_hierarchy_target') {
        if (!hasVortexLevel(interaction.member, ['admin', 'medio'])) return safeReply(interaction, { content: '❌ Seu nível não libera essa configuração.', ephemeral: true });
        factionHierarchySelections.set(getSelectionKey(interaction), interaction.values[0]);
        return renderDashboard(interaction, 'tab_fac_hierarchy', true);
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
        const channelId = String(interaction.values[0]);
        const channel = interaction.channels?.get(channelId) || await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (!isTextChannel(channel)) {
            return safeReply(interaction, { content: '❌ Selecione um canal de texto válido.', ephemeral: true });
        }

        await allowTextChannelAccess(channel, interaction.guild).catch(() => null);
        profileRegisterSelections.set(key, {
            ...(profileRegisterSelections.get(key) || {}),
            channelId,
        });
        return renderDashboard(interaction, 'tab_perfil', true);
    }
  },

  async handleModal(interaction) {
    if (!hasPanelAccess(interaction.member)) return safeReply(interaction, { content: '❌ Você precisa estar cadastrado no /painel para usar esta ação.', ephemeral: true });
    if (!hasStaffPermission(interaction.member)) return safeReply(interaction, { content: '❌ Sem permissão.', ephemeral: true });
    
    const data = loadJSON(CONFIG_PATH);
    if (interaction.customId === 'modal_adjust_call_id') {
        if (!hasVortexLevel(interaction.member, ['admin', 'medio'])) {
            return safeReply(interaction, { content: '❌ Seu nível não libera a ferramenta de ajuste.', ephemeral: true });
        }

        const channelId = interaction.fields.getTextInputValue('channel_id').trim();
        if (!/^\d{15,25}$/.test(channelId)) {
            return safeReply(interaction, { content: '❌ ID de call inválido.', ephemeral: true });
        }

        const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
        if (!channel || String(channel.guildId || channel.guild?.id || '') !== String(interaction.guild.id) || !isAdjustCallChannel(channel)) {
            return safeReply(interaction, { content: '❌ Não encontrei essa call neste servidor. Confira o ID e minhas permissões.', ephemeral: true });
        }

        adjustCallSelections.set(getSelectionKey(interaction), channel.id);
        await allowVoiceChannelAccess(channel, interaction.guild).catch(() => null);
        return renderDashboard(interaction, 'tab_adjust_calls', true);
    }

    if (interaction.customId === 'modal_visual_color' || interaction.customId === 'modal_visual_banner') {
        if (!hasVortexLevel(interaction.member, ['admin'])) {
            return safeReply(interaction, { content: '❌ Apenas Admin Vortex pode alterar o visual dos painéis.', ephemeral: true });
        }

        const targetKey = getVisualTargetKey(interaction);
        const target = getPanelTargetMeta(targetKey);
        let theme;

        if (interaction.customId === 'modal_visual_color') {
            const color = normalizeHexColor(interaction.fields.getTextInputValue('color'), '');
            if (!color) {
                return safeReply(interaction, { content: '❌ Cor inválida. Use formato HEX, exemplo: `#7000FF`.', ephemeral: true });
            }

            theme = setPanelVisualTheme(targetKey, { color });
        } else {
            const bannerUrlInput = interaction.fields.getTextInputValue('banner_url').trim();
            const ratioInput = interaction.fields.getTextInputValue('banner_ratio').trim();
            const bannerUrl = normalizeBannerUrl(bannerUrlInput);
            if (bannerUrlInput && !bannerUrl) {
                return safeReply(interaction, { content: '❌ URL inválida. Use uma URL começando com `https://` ou deixe vazio para remover.', ephemeral: true });
            }

            theme = setPanelVisualTheme(targetKey, {
                bannerUrl,
                bannerRatio: normalizeBannerRatio(ratioInput, '16:9'),
            });
        }

        sendVortexLog(interaction.client, {
            title: 'Visual de Painel Alterado',
            description: [
                `Painel: **${target.label}**`,
                `Cor: **${theme.color}**`,
                `Banner: ${theme.bannerUrl ? theme.bannerUrl : 'sem banner'}`,
                `Proporção: **${theme.bannerRatio}**`,
                `Alterado por: <@${interaction.user.id}>`,
            ].join('\n'),
            color: theme.color,
            type: 'CONFIGURAÇÃO',
            userId: interaction.user.id,
        }).catch(() => {});

        return renderDashboard(interaction, 'tab_visual', true);
    }

    if (interaction.customId === 'modal_vortex_auto_role_pending' || interaction.customId === 'modal_vortex_auto_role_approved') {
        if (!hasVortexLevel(interaction.member, ['admin'])) {
            return safeReply(interaction, { content: '❌ Apenas Admin Vortex pode alterar cargos automáticos.', ephemeral: true });
        }

        const type = interaction.customId.endsWith('_pending') ? 'pending' : 'approved';
        const rawRoleIds = interaction.fields.getTextInputValue('role_ids');
        const roleIds = [...new Set(rawRoleIds.split(/[\s,;]+/).map((roleId) => roleId.trim()).filter(Boolean))];
        if (!roleIds.length || roleIds.some((roleId) => !/^\d{15,25}$/.test(roleId))) {
            return safeReply(interaction, { content: '❌ Envie apenas IDs de cargos válidos, separados por vírgula ou espaço.', ephemeral: true });
        }

        const missing = [];
        for (const roleId of roleIds) {
            const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
            if (!role) missing.push(roleId);
        }
        if (missing.length) {
            return safeReply(interaction, {
                content: `❌ Cargo(s) não encontrado(s): ${missing.map((roleId) => `\`${roleId}\``).join(', ')}`,
                ephemeral: true,
            });
        }

        const savedRoles = setVortexAutoRoles(type, roleIds);
        sendVortexLog(interaction.client, {
            title: 'Hierarquia Vortex Alterada',
            description: [
                `Cargo(s) automático(s) de **${type === 'pending' ? 'pendente' : 'aprovado'}** alterados por <@${interaction.user.id}>.`,
                `Cargos: ${savedRoles.map((roleId) => `<@&${roleId}>`).join(' ') || 'nenhum'}`,
            ].join('\n'),
            color: '#5865F2',
            type: 'SEGURANÇA',
            userId: interaction.user.id
        }).catch(() => {});

        return renderDashboard(interaction, 'tab_roles', true);
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
            return safeReply(interaction, { content: '❌ ID de canal de texto inválido.', ephemeral: true });
        }
        if (callChannelId) {
            const channel = await interaction.guild.channels.fetch(callChannelId).catch(() => null);
            if (!isTextChannel(channel)) {
                return safeReply(interaction, { content: '❌ O ID informado não é de um canal de texto válido.', ephemeral: true });
            }
            await allowTextChannelAccess(channel, interaction.guild).catch(() => null);
        }

        const target = await interaction.client.users.fetch(userId).catch(() => null);
        if (!target) {
            return safeReply(interaction, { content: '❌ Usuário não encontrado.', ephemeral: true });
        }
        const member = await interaction.guild.members.fetch(userId).catch(() => null);

        const result = await registerManualProfile(interaction.guild, target, {
            name: name || member?.displayName || target.username,
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
                result.profile.callChannelId ? `Canal de texto vinculado: <#${result.profile.callChannelId}>` : null,
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
                `Canal de texto: ${result.profile.callChannelId ? `<#${result.profile.callChannelId}>` : 'N/A'}`,
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
  if (tab === 'tab_stats' || tab === 'tab_perfil') {
    await syncProfilesFromApprovedSetChannels(client, {
      syncChannels: true,
      refreshFromMongo: true,
    }).catch((error) => reportPanelError(client, error, 'Sincronizar perfis do painel'));
  }
  const tabMeta = getPanelTabMeta(tab);
  
  const embed = createPanelView(tabMeta)
    .setTimestamp()
    .setFooter({ text: `Vortex Management System • ${tabMeta.icon} ${tabMeta.title} • ${formatDate(new Date())}` });

  const toolSelectRow = buildPanelToolSelectRow(tab);
  const actionRow = new ActionRowBuilder();
  let extraRows = [];

  if (tab === 'tab_stats') {
    const realtime = await getRealtimeGuildStats(guild);
    const permissions = ensureCommandPermissions(conf);
    const profiles = getGuildProfiles(guild.id);
    const profileList = Object.values(profiles);
    const setProfileCount = profileList.filter((profile) => !profile.registeredManually).length;
    const manualProfileCount = profileList.filter((profile) => profile.registeredManually).length;
      embed.setAuthor({ name: `VORTEX ${tabMeta.icon} | DASHBOARD`, iconURL: guild.iconURL() || client.user.displayAvatarURL() }).setColor('#7000FF')
      .setDescription([
        '### 📊 Visão geral',
        '',
        'Resumo rápido do servidor, permissões e cadastros salvos no sistema.',
        'Use os botões do painel para acessar cada área administrativa.',
      ].join('\n'))
      .addFields(
        { name: '👤 Membros', value: String(realtime.totalMembers), inline: true },
        { name: 'Pessoas / Bots', value: `${realtime.humanCount} / ${realtime.botCount}`, inline: true },
        { name: 'Canais / Cargos', value: `${realtime.channelCount} / ${realtime.roleCount}`, inline: true },
        { name: '📋 Fichas', value: String((stats.aprovados || 0) + (stats.recusados || 0) + (stats.pendentes || 0)), inline: true },
        { name: '🟢 Status', value: conf.MAINTENANCE_MODE ? '🔴 Em Manutenção' : '🟢 Online', inline: true },
        { name: 'Fonte dos dados', value: realtime.source, inline: true },
        { name: 'Permissões dos comandos', value: buildCommandAccessPreview(permissions, 6).slice(0, 1024), inline: false },
        { name: 'Cadastros salvos', value: `Total: **${profileList.length}** | /set: **${setProfileCount}** | manual: **${manualProfileCount}**\n${buildRegisteredProfilesPreview(profiles, 6).slice(0, 900)}`, inline: false }
      );
  } else if (tab === 'tab_roles') {
    ensureVortexHierarchyConfig(conf);
    const levels = ensureRoleLevels(conf);
    const permissions = ensureCommandPermissions(conf);
    const autoRoles = getVortexAutoRoles(conf);
    const vortexRoleMode = getVortexRoleMode(interaction);
    embed.setAuthor({ name: `VORTEX ${tabMeta.icon} | GESTÃO DE ACESSOS`, iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor('#5865F2')
      .setDescription([
        '### 🔐 Cargos e acessos',
        '',
        'Defina quais cargos entram em cada nível de permissão.',
        'Os cargos automáticos são aplicados na entrada do servidor, aprovação do set e remoção de cadastro.',
        `**Modo atual:** ${vortexRoleMode === 'remove' ? 'remover cargos selecionados' : 'definir cargos selecionados'}`,
        '',
        '**Níveis**',
        '**Admin:** gerencia avisos, set e sistemas de ponto.',
        '**Médio:** analisa set e envia avisos.',
        '**Membro:** usa ações básicas, como bater ponto.',
        '',
        `**Master:** ${SUPERIOR_IDS.map(roleId => `<@&${roleId}>`).join(' ')}`,
      ].join('\n'))
      .addFields(
        { name: 'Acesso total', value: SUPERIOR_IDS.map(roleId => `<@&${roleId}>`).join(' '), inline: false },
        { name: 'Admin Vortex', value: formatRoleList(levels.admin), inline: false },
        { name: 'Médio Vortex', value: formatRoleList(levels.medio), inline: false },
        { name: 'Membro Vortex', value: formatRoleList(levels.membro), inline: false },
        { name: 'Automático - Pendente', value: formatRoleList(autoRoles.pending), inline: true },
        { name: 'Automático - Aprovado', value: formatRoleList(autoRoles.approved), inline: true },
        { name: '/painel privado', value: formatRoleList(permissions.painel, '`Somente Admin/Médio`'), inline: false },
        { name: 'Set', value: formatRoleList(permissions.set, '`Sem filtro extra`'), inline: true },
        { name: 'Avisos', value: formatRoleList(permissions.avisos, '`Sem filtro extra`'), inline: true },
        { name: 'Registro', value: formatRoleList(permissions.registro, '`Sem filtro extra`'), inline: true },
        { name: 'Ponto', value: formatRoleList(permissions.ponto, '`Sem filtro extra`'), inline: true },
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
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('toggle_vortex_role_remove_mode')
          .setLabel(vortexRoleMode === 'remove' ? 'Desativar modo remover' : 'Ativar modo remover')
          .setStyle(vortexRoleMode === 'remove' ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('set_vortex_auto_pending')
          .setLabel('Cargo pendente')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('set_vortex_auto_approved')
          .setLabel('Cargo aprovado')
          .setStyle(ButtonStyle.Secondary)
      ),
    ];
  } else if (tab === 'tab_manutencao') {
    const since = conf.MAINTENANCE_SINCE ? `<t:${Math.floor(conf.MAINTENANCE_SINCE / 1000)}:R>` : 'N/A';
    
    embed.setAuthor({ name: `VORTEX ${tabMeta.icon} | Painel de Controle`, iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor(conf.MAINTENANCE_MODE ? '#FF0055' : '#3498DB')
      .setDescription([
        '### 🔧 Manutenção',
        '',
        'Use esta aba para pausar o uso normal do bot enquanto ajustes são feitos.',
        '',
        `**Status:** ${conf.MAINTENANCE_MODE ? '🔴 Ativo' : '🟢 Desativado'}`,
        `**Ativado por:** <@${conf.MAINTENANCE_BY || 'N/A'}>`,
        `**Tempo:** ${since}`,
        '',
        `Somente ${SUPERIOR_IDS.map(roleId => `<@&${roleId}>`).join(' ')} podem alterar este modo.`,
      ].join('\n'))
      .addFields(
          { name: '✅ Continua liberado', value: '`/painel`, `/set` para staff', inline: true },
          { name: '⛔ Usuários comuns', value: 'Recebem aviso de manutenção.', inline: true },
          { name: '📢 Logs no canal', value: conf.DISABLE_CHANNEL_LOGS ? '`Desligados`' : '`Ligados`', inline: true },
          { name: '📩 Logs por DM', value: conf.DISABLE_DM_LOGS ? '`Desligados`' : '`Ligados`', inline: true },
          { name: '🎮 Logs de atividades', value: conf.DISABLE_ACTIVITY_LOGS ? '`Desligados`' : '`Ligados`', inline: true },
          { name: '✨ Boas-vindas', value: '`Sempre ativa`', inline: true },
          { name: 'Canal do ponto', value: `<#${conf.POINT_ACTION_CHANNEL_ID || DEFAULT_POINT_ACTION_CHANNEL_ID}>`, inline: true },
          { name: 'Categoria de ajuste', value: `<#${conf.POINT_ADJUST_CATEGORY_ID || DEFAULT_POINT_ADJUST_CATEGORY_ID}>`, inline: true },
          { name: 'Mudanças registradas', value: readUpdatesSummary().slice(0, 900), inline: false }
      )

    actionRow.addComponents(
      new ButtonBuilder().setCustomId('toggle_maint').setLabel(conf.MAINTENANCE_MODE ? 'Desativar manutenção' : 'Ativar manutenção').setStyle(conf.MAINTENANCE_MODE ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('toggle_channel_logs').setLabel(conf.DISABLE_CHANNEL_LOGS ? 'Ligar logs do canal' : 'Desligar logs do canal').setStyle(conf.DISABLE_CHANNEL_LOGS ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('toggle_dm_logs').setLabel(conf.DISABLE_DM_LOGS ? 'Ligar logs por DM' : 'Desligar logs por DM').setStyle(conf.DISABLE_DM_LOGS ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('toggle_activity_logs').setLabel(conf.DISABLE_ACTIVITY_LOGS ? 'Ligar logs de atividade' : 'Desligar logs de atividade').setStyle(conf.DISABLE_ACTIVITY_LOGS ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('test_notice').setLabel('Testar aviso').setStyle(ButtonStyle.Secondary)
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
    embed.setAuthor({ name: `VORTEX ${tabMeta.icon} | CONFIGURAÇÕES`, iconURL: guild.iconURL() || client.user.displayAvatarURL() }).setColor('#00D9FF')
      .setDescription([
        '### Configurações gerais',
        '',
        'Acesse as configurações de set, avisos e logs.',
        'O modo privado limita o uso do `/painel` aos cargos configurados.',
      ].join('\n'))
      .addFields(
        { name: 'Canal de logs', value: conf.LOG_CHANNEL ? `<#${conf.LOG_CHANNEL}>` : '`Não configurado`', inline: true },
        { name: '/painel privado', value: privateMode ? '`Ativado`' : '`Desativado`', inline: true },
        { name: 'Set', value: 'Permissões do sistema de set.', inline: true },
        { name: 'Avisos', value: 'DMs e menções dos avisos.', inline: true },
        { name: 'Logs', value: 'Canal e modos de registro.', inline: true }
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
    const activeLogSwitches = [
      !conf.DISABLE_CHANNEL_LOGS,
      !conf.DISABLE_DM_LOGS,
      !conf.DISABLE_ACTIVITY_LOGS,
      !conf.DISABLE_NOTICE_DMS,
    ].filter(Boolean).length;
    embed.setAuthor({ name: `VORTEX ${tabMeta.icon} | CONFIGURAÇÕES | LOGS`, iconURL: guild.iconURL() || client.user.displayAvatarURL() }).setColor('#00D9FF')
      .setDescription([
        '### Central de logs',
        '',
        'Controle o canal principal, os envios por DM e os canais onde auditoria deve ficar bloqueada.',
        `Apenas <@${LOGS_MANAGER_IDS[0]}> ou ${SUPERIOR_IDS.map((roleId) => `<@&${roleId}>`).join(' ')} podem alterar esta área.`,
        '',
        `**Resumo:** ${activeLogSwitches}/4 sistemas ativos • ${disabledLogChannelIds.length} canal(is) bloqueado(s)`,
        `**Selecionado:** ${formatLogChannelSelection(selectedLogChannelId, selectedLogChannelDisabled)}`,
      ].join('\n'))
      .addFields(
        { name: 'Canal principal', value: conf.LOG_CHANNEL ? `<#${conf.LOG_CHANNEL}>` : '`Não configurado`', inline: true },
        { name: 'Auditoria em canal', value: formatLogSwitch(conf.DISABLE_CHANNEL_LOGS), inline: true },
        { name: 'Logs por DM', value: formatLogSwitch(conf.DISABLE_DM_LOGS), inline: true },
        { name: 'Atividades FiveM/GTA', value: formatLogSwitch(conf.DISABLE_ACTIVITY_LOGS), inline: true },
        { name: 'Avisos por DM', value: formatLogSwitch(conf.DISABLE_NOTICE_DMS), inline: true },
        { name: 'Canal selecionado', value: formatLogChannelSelection(selectedLogChannelId, selectedLogChannelDisabled), inline: true },
        { name: `Canais bloqueados (${disabledLogChannelIds.length})`, value: formatChannelList(disabledLogChannelIds), inline: false }
      );

    actionRow.addComponents(
      new ButtonBuilder().setCustomId('toggle_channel_logs').setLabel(conf.DISABLE_CHANNEL_LOGS ? 'Ligar auditoria' : 'Desligar auditoria').setStyle(conf.DISABLE_CHANNEL_LOGS ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('toggle_dm_logs').setLabel(conf.DISABLE_DM_LOGS ? 'Ligar logs por DM' : 'Desligar logs por DM').setStyle(conf.DISABLE_DM_LOGS ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('toggle_activity_logs').setLabel(conf.DISABLE_ACTIVITY_LOGS ? 'Ligar atividades' : 'Desligar atividades').setStyle(conf.DISABLE_ACTIVITY_LOGS ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('toggle_notice_dms').setLabel(conf.DISABLE_NOTICE_DMS ? 'Ligar DMs avisos' : 'Desligar DMs avisos').setStyle(conf.DISABLE_NOTICE_DMS ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('send_test_log').setLabel('Enviar teste').setStyle(ButtonStyle.Secondary).setDisabled(!conf.LOG_CHANNEL)
    );

    extraRows = [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('select_log')
          .setPlaceholder('Selecionar canal principal de logs')
          .addChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('select_disabled_log_channel')
          .setPlaceholder('Selecionar canal/call para ligar ou desligar logs')
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
    embed.setAuthor({ name: `VORTEX ${tabMeta.icon} | CONFIGURAÇÕES | AVISOS`, iconURL: guild.iconURL() || client.user.displayAvatarURL() }).setColor('#7000FF')
      .setDescription([
        '### Avisos',
        '',
        'Controle o envio de avisos por DM e o cargo extra mencionado nos comunicados.',
      ].join('\n'))
      .addFields(
        { name: 'Avisos por DM', value: conf.DISABLE_NOTICE_DMS ? '`Desativados`' : '`Ativados`', inline: true },
        { name: 'Cargo extra mencionado', value: conf.NOTICE_MENTION_ROLE_ID ? `<@&${conf.NOTICE_MENTION_ROLE_ID}>` : '`Não configurado`', inline: true }
      );

    const noticeRoleRow = new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId('select_notice_mention_role').setPlaceholder('Selecionar cargo mencionado nos avisos').setMinValues(1).setMaxValues(1)
    );
    const noticeButtonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('toggle_notice_dms')
        .setLabel(conf.DISABLE_NOTICE_DMS ? 'Ligar DMs de avisos' : 'Desligar DMs de avisos')
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
    embed.setAuthor({ name: `VORTEX ${tabMeta.icon} | CONFIGURAÇÕES | SET`, iconURL: guild.iconURL() || client.user.displayAvatarURL() }).setColor('#5865F2')
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
    embed.setAuthor({ name: `VORTEX ${tabMeta.icon} | GESTÃO DE PONTOS`, iconURL: guild.iconURL() || client.user.displayAvatarURL() })
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
    embed.setAuthor({ name: `VORTEX ${tabMeta.icon} | COBRANÇAS E PENALIDADES`, iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor('#FEE75C')
      .setDescription([
        '### Cobranças automáticas',
        '',
        `Confirmação de ponto aberto: **${automationConfig.pointMonitorEnabled ? 'ligada' : 'desligada'}**`,
        `Cobrança por offline sem ausência: **${automationConfig.offlineChargeEnabled ? 'ligada' : 'desligada'}**`,
        `Confirmação: **a cada ${automationConfig.pointMonitorDmIntervalHours}h**, até **${automationConfig.pointMonitorMaxDmAttempts} DMs** por ciclo.`,
        `Cobrança offline: **${String(automationConfig.offlineChargeHour).padStart(2, '0')}:00**, a cada **${automationConfig.offlineChargeIntervalDays} dias**.`,
        '',
        `Canal de penalidades: <#${automationConfig.penaltyChannelId}>`,
        `Categoria de correção: <#${automationConfig.pointCorrectionCategoryId}>`,
        '',
        'Usuários em ausência não recebem cobrança offline.',
        '',
        'Use **Verificar agora** para executar a checagem manualmente.',
      ].join('\n'));
    actionRow.addComponents(
      new ButtonBuilder().setCustomId('toggle_point_monitor').setLabel(automationConfig.pointMonitorEnabled ? 'Desligar confirmação' : 'Ligar confirmação').setStyle(automationConfig.pointMonitorEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId('toggle_offline_charge').setLabel(automationConfig.offlineChargeEnabled ? 'Desligar cobrança' : 'Ligar cobrança').setStyle(automationConfig.offlineChargeEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId('run_point_automation').setLabel('Verificar agora').setStyle(ButtonStyle.Primary)
    );
  } else if (tab === 'tab_mirror_messages') {
    ensureMirrorMessageConfig(conf);
    const mirrorChannelIds = getMirrorMessageChannelIds(conf);
    const selectedChannelId = mirrorMessageSelections.get(getSelectionKey(interaction));
    const selectedEnabled = selectedChannelId && mirrorChannelIds.includes(selectedChannelId);

    embed.setAuthor({ name: `VORTEX ${tabMeta.icon} | MENSAGENS EM PAINEL`, iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor('#005DFF')
      .setDescription([
        '### Mensagens em painel',
        '',
        'Nos canais ativados, quando uma pessoa enviar mensagem, o bot apaga a mensagem original e reenvia como painel com nome e foto do autor.',
        '',
        `Canais ativos: **${mirrorChannelIds.length}**`,
        `Canal selecionado: ${selectedChannelId ? `<#${selectedChannelId}>` : '`Nenhum`'}`,
        `Status selecionado: **${selectedEnabled ? 'ativado' : 'desativado'}**`,
        '',
        '**Canais configurados**',
        formatChannelList(mirrorChannelIds, '`Nenhum canal configurado`'),
        '',
        '**Permissões necessárias**',
        'O bot precisa conseguir **ver canal**, **ler mensagens**, **apagar mensagens** e **enviar embeds** nesses canais.',
      ].join('\n'));

    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId('toggle_mirror_message_channel')
        .setLabel(selectedEnabled ? 'Desativar canal' : 'Ativar canal')
        .setStyle(selectedEnabled ? ButtonStyle.Danger : ButtonStyle.Success)
        .setDisabled(!selectedChannelId)
    );

    extraRows = [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('select_mirror_message_channel')
          .setPlaceholder('Selecionar canal onde mensagens viram painel')
          .addChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1)
      ),
    ];
  } else if (tab === 'tab_adjust_calls') {
    const activeCallIds = getAdjustCallChannelIds(conf);
    const selectedChannelId = adjustCallSelections.get(getSelectionKey(interaction));
    const selectedActive = selectedChannelId && activeCallIds.includes(selectedChannelId);
    const callSelectData = await getAdjustCallSelectData(guild, activeCallIds, selectedChannelId);

    embed.setAuthor({ name: `VORTEX ${tabMeta.icon} | AJUSTE DE CALLS`, iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor(selectedActive ? '#57F287' : '#FEE75C')
      .setDescription([
        '### Ajuste',
        '',
        'Selecione uma call e use os botões para ativar ou desativar a entrada nela.',
        'A lista abaixo é montada pelo bot, então ela também tenta encontrar calls privadas/ocultas.',
        '',
        `Call selecionada: ${selectedChannelId ? `<#${selectedChannelId}>` : '`Nenhuma`'}`,
        `Status selecionado: **${selectedActive ? 'ativada' : 'desativada'}**`,
        `Calls encontradas pelo bot: **${callSelectData.total}**`,
        `Mostrando no seletor: **${callSelectData.shown}/25**`,
        `Calls ativas: **${activeCallIds.length}**`,
        '',
        '**Lista ativa**',
        formatChannelList(activeCallIds, '`Nenhuma call ativa`'),
      ].join('\n'));

    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId('adjust_call_activate')
        .setLabel('Ativar')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!selectedChannelId || selectedActive),
      new ButtonBuilder()
        .setCustomId('adjust_call_deactivate')
        .setLabel('Desativar')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!selectedChannelId || !selectedActive),
      new ButtonBuilder()
        .setCustomId('adjust_call_select_by_id')
        .setLabel('Selecionar por ID')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('adjust_call_sync')
        .setLabel('Sincronizar calls')
        .setStyle(ButtonStyle.Primary)
    );

    if (callSelectData.options.length) {
      extraRows = [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('select_adjust_call_id')
            .setPlaceholder('Selecionar call encontrada pelo bot')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(callSelectData.options)
        ),
      ];
    }
  } else if (tab === 'tab_visual') {
    const selectedTargetKey = getVisualTargetKey(interaction);
    const selectedTarget = getPanelTargetMeta(selectedTargetKey);
    const selectedTheme = getPanelVisualTheme(selectedTargetKey);
    const globalTheme = getPanelVisualTheme('global');
    const configuredTargets = PANEL_THEME_TARGETS
      .filter((target) => target.key !== 'global')
      .map((target) => {
        const theme = getPanelVisualTheme(target.key);
        return `${target.label}: ${theme.color}${theme.bannerUrl ? ' + banner' : ''}`;
      })
      .join('\n')
      .slice(0, 1000);

    embed.setAuthor({ name: `VORTEX ${tabMeta.icon} | VISUAL DOS PAINÉIS`, iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor(selectedTheme.color)
      .setDescription([
        '### Visual dos painéis',
        '',
        'Configure cor e banner dos painéis em Components V2.',
        'Escolha **Todos os painéis** para definir o padrão global ou selecione um painel específico para sobrescrever só ele.',
        '',
        `Editando agora: **${selectedTarget.label}**`,
        '',
        '**Tema selecionado**',
        formatVisualTheme(selectedTheme),
        '',
        '**Tema global**',
        formatVisualTheme(globalTheme),
        '',
        '**Painéis disponíveis**',
        configuredTargets || '`Nenhum painel encontrado`',
      ].join('\n'));

    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId('visual_set_color')
        .setLabel('Trocar cor')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('visual_set_banner')
        .setLabel('Trocar banner')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('visual_clear_target')
        .setLabel(selectedTargetKey === 'global' ? 'Resetar global' : 'Limpar painel')
        .setStyle(ButtonStyle.Danger)
    );

    extraRows = [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('select_visual_target')
          .setPlaceholder(`Editar visual: ${selectedTarget.label}`)
          .addOptions(PANEL_THEME_TARGETS.map((target) => ({
            label: target.label,
            value: target.key,
            description: target.description.slice(0, 100),
            default: target.key === selectedTargetKey,
          })))
      ),
    ];
  } else if (tab === 'tab_fac_hierarchy') {
    ensureFactionHierarchyConfig(conf);
    const hierarchy = getFactionHierarchyConfig(conf);
    const selectedRoleKey = factionHierarchySelections.get(getSelectionKey(interaction)) || FACTION_HIERARCHY_ROLES[0].key;
    const selectedRole = getFactionHierarchyRole(selectedRoleKey) || FACTION_HIERARCHY_ROLES[0];

    embed.setAuthor({ name: `VORTEX ${tabMeta.icon} | HIERARQUIA DA FAC`, iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor('#7000FF')
      .setDescription([
        '### Painel de hierarquia da fac',
        '',
        'Configure os cargos de cada posição e publique o embed no canal escolhido.',
        'Quando alguém receber ou perder um desses cargos, o embed será atualizado automaticamente.',
        '',
        `Canal: ${hierarchy.channelId ? `<#${hierarchy.channelId}>` : '`Não configurado`'}`,
        `Mensagem: ${hierarchy.messageId ? `\`${hierarchy.messageId}\`` : '`Não publicada`'}`,
        `Editando agora: **${selectedRole.label}**`,
      ].join('\n'))
      .addFields(
        ...FACTION_HIERARCHY_ROLES.map((role) => ({
          name: role.label,
          value: formatConfiguredRoles(hierarchy.roles[role.key]),
          inline: true,
        }))
      );

    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId('publish_fac_hierarchy_panel')
        .setLabel(hierarchy.messageId ? 'Republicar painel' : 'Publicar painel')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('refresh_fac_hierarchy_panel')
        .setLabel('Atualizar painel')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!hierarchy.channelId || !hierarchy.messageId)
    );

    extraRows = [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('select_fac_hierarchy_channel')
          .setPlaceholder('Selecionar canal onde o embed da hierarquia ficará')
          .addChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('select_fac_hierarchy_target')
          .setPlaceholder(`Editar posição: ${selectedRole.label}`)
          .addOptions(FACTION_HIERARCHY_ROLES.map((role) => ({
            label: role.label,
            value: role.key,
            description: `Configurar cargo(s) de ${role.label}`,
            default: role.key === selectedRole.key,
          })))
      ),
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`select_fac_hierarchy_role_${selectedRole.key}`)
          .setPlaceholder(`Selecionar cargo(s): ${selectedRole.label}`)
          .setMinValues(0)
          .setMaxValues(10)
      ),
    ];
  } else if (tab === 'tab_commands') {
    const permissions = ensureCommandPermissions(conf);
    const selected = commandPermissionSelections.get(getSelectionKey(interaction)) || COMMAND_PERMISSION_OPTIONS[0].value;
    const lines = COMMAND_PERMISSION_OPTIONS.map((option) => {
      const roles = permissions[option.value] || [];
      return `**${option.label}:** ${formatRoleList(roles, '`Todos os Cargos Vortex`')}`;
    }).join('\n');

    embed.setAuthor({ name: `VORTEX ${tabMeta.icon} | PERMISSÕES DE COMANDOS`, iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor('#00D9FF')
      .setDescription([
        '### Permissões de comandos',
        '',
        'Escolha um comando e defina quais cargos podem usar.',
        'Se nenhum cargo for selecionado, valem apenas as regras internas do próprio comando.',
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
          .setPlaceholder('Escolher comando ou ação')
          .addOptions(COMMAND_PERMISSION_OPTIONS)
      ),
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId('select_command_permission_roles')
          .setPlaceholder(`Selecionar cargos para ${selected}`)
          .setMinValues(0)
          .setMaxValues(10)
      ),
    ];
  } else if (tab === 'tab_ausencias') {
    const absenceConfig = getAbsenceConfig();
    const activeAbsences = getActiveGuildAbsences(guild.id);
    const activeList = activeAbsences.length
      ? activeAbsences.slice(0, 10).map((absence, index) => {
          return [
            `**${index + 1}.** <@${absence.userId}>`,
            `Retorno: **${formatAbsenceDate(absence.endsAt)}** | ID: \`${absence.userId}\``,
          ].join('\n');
        }).join('\n')
      : '`Nenhuma ausência ativa no momento.`';
    const hiddenActiveCount = Math.max(0, activeAbsences.length - 10);
    const activeListFooter = hiddenActiveCount ? `\n... mais ${hiddenActiveCount} ausência(s) ativa(s).` : '';
    const endMessageStatus = absenceConfig.disableEndMessage ? '`Desativada`' : '`Ativada`';
    const configuredRole = absenceConfig.roleId ? `<@&${absenceConfig.roleId}>` : '`Não configurado`';
    const logChannel = absenceConfig.logChannelId || DEFAULT_ABSENCE_LOG_CHANNEL_ID;

    embed.setAuthor({ name: `VORTEX ${tabMeta.icon} | GESTÃO DE AUSÊNCIAS`, iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor('#7000FF')
      .setDescription([
        '### Controle de ausências',
        '',
        '**Resumo**',
        `Ativas agora: **${activeAbsences.length}**`,
        `Cargo aplicado: ${configuredRole}`,
        `Mensagem de fim: ${endMessageStatus}`,
        `Logs enviados em: <#${logChannel}>`,
        '',
        '**Regras do sistema**',
        'O usuário solicita pelo `/ausencia` informando motivo, dia de início e dia de retorno.',
        'A ausência é sempre por dias completos. O sistema não aceita ausência por hora.',
        'Quando uma ausência futura é aprovada, o cargo será aplicado automaticamente no dia de início.',
        '',
        '**Ausências ativas**',
        `${activeList}${activeListFooter}`,
      ].join('\n'))
      .addFields(
        {
          name: '🛠️ Ações disponíveis',
          value: [
            '**Trocar cargo:** define qual cargo o usuário recebe quando a ausência é aprovada.',
            '**Alterar retorno:** muda a data de volta de uma ausência ativa.',
            '**Mensagem final:** liga ou desliga o aviso enviado quando a ausência termina.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '📅 Formato para alterar retorno',
          value: [
            'Use `DD/MM` ou `DD/MM/AAAA`.',
            'Exemplo: `15/01` ou `15/01/2026`.',
          ].join('\n'),
          inline: false,
        }
      );

    actionRow.addComponents(
      new ButtonBuilder().setCustomId('set_absence_role').setLabel('Trocar cargo').setEmoji('🎭').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('change_absence_return').setLabel('Alterar retorno').setEmoji('📅').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('toggle_absence_end_message').setLabel(absenceConfig.disableEndMessage ? 'Ligar mensagem final' : 'Desligar mensagem final').setEmoji('🔔').setStyle(absenceConfig.disableEndMessage ? ButtonStyle.Success : ButtonStyle.Danger)
    );
  } else if (tab === 'tab_perfil') {
    const profiles = getGuildProfiles(guild.id);
    const profileConfig = readProfileConfig();
    const selectedProfile = profileRegisterSelections.get(getSelectionKey(interaction)) || {};
    const profileList = Object.values(profiles);
    const setProfileCount = profileList.filter((profile) => !profile.registeredManually).length;
    const manualProfileCount = profileList.filter((profile) => profile.registeredManually).length;
    const profileRows = profileList.slice(0, 10).map((profile, index) => {
      return `${index + 1}. <@${profile.userId}> - ${profile.nomeGame || profile.displayName || 'Sem nome'} - canal ${profile.callChannelId ? `<#${profile.callChannelId}>` : 'N/A'} - ultima atualização ${profile.lastProfileUpdateAt ? formatDate(profile.lastProfileUpdateAt) : 'N/A'}`;
    });

    embed.setAuthor({ name: `VORTEX ${tabMeta.icon} | PERFIS`, iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor('#00D9FF')
      .setDescription([
        '### Perfis',
        '',
        'Acompanhe usuários aprovados no `/set` e cadastros manuais.',
        'Perfis devem ser atualizados pelo `/perfil` com mídia e nível em game.',
        `Cadastrados: **${profileList.length}** | aprovados no /set: **${setProfileCount}** | manuais: **${manualProfileCount}**`,
        `Cobrança por DM: **${profileConfig.billingDmEnabled ? 'ligada' : 'desligada'}**`,
        `Notificação de atualização: **${profileConfig.profileUpdateNotificationsEnabled ? 'ligada' : 'desligada'}**`,
        `Usuários sem cobrança: **${Array.isArray(profileConfig.billingExemptUserIds) ? profileConfig.billingExemptUserIds.length : 0}**`,
        '',
        `Selecionado: ${selectedProfile.userId ? `<@${selectedProfile.userId}>` : '`Nenhum usuário`'} | ${selectedProfile.channelId ? `<#${selectedProfile.channelId}>` : '`Nenhum canal de texto`'}`,
        '',
        '**Perfis salvos**',
        profileRows.length ? profileRows.join('\n') : 'Nenhum perfil salvo ainda.',
        '',
        `Data/hora real: ${formatDate(new Date())}`,
      ].join('\n'));

    actionRow.addComponents(
      new ButtonBuilder().setCustomId('profile_register').setLabel('Cadastrar perfil').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('profile_list_registered').setLabel('Listar perfis').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('profile_test').setLabel('Testar cobrança').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('profile_delete_no_billing').setLabel('Apagar cadastro').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('profile_toggle_billing').setLabel(profileConfig.billingDmEnabled ? 'Desligar cobrança' : 'Ligar cobrança').setStyle(profileConfig.billingDmEnabled ? ButtonStyle.Danger : ButtonStyle.Success)
    );
    extraRows = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('profile_toggle_update_notifications')
          .setLabel(profileConfig.profileUpdateNotificationsEnabled ? 'Desligar notificacao' : 'Ligar notificacao')
          .setStyle(profileConfig.profileUpdateNotificationsEnabled ? ButtonStyle.Danger : ButtonStyle.Success)
      ),
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('select_profile_register_user')
          .setPlaceholder('Selecionar usuário do perfil')
          .setMinValues(1)
          .setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('select_profile_register_channel')
          .setPlaceholder('Selecionar canal de texto vinculado')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum)
          .setMinValues(1)
          .setMaxValues(1)
      ),
    ];
  }

  const backRow = (tab === 'tab_stats' || tab === 'tab_perfil') ? null : buildPanelBackRow(tab);
  let components = [toolSelectRow];
  if (actionRow.components.length > 0) components.push(actionRow);
  if (extraRows.length > 0) components.push(...extraRows);
  if (backRow) components.push(backRow);

  const options = buildPanelV2Payload(embed, components);
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
