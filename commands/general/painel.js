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
  TextInputStyle
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { sendVortexLog } = require('../../utils/notifications');
const { deleteUserPoint, adjustPointSession, formatDuration, formatDate } = require('../../utils/pontoManager');
const { updateStatusPanel } = require('../../utils/pontoPanel');
const { buildAllPointsReportPayload } = require('../../utils/pontoReport');
const { getAbsenceConfig, saveAbsenceConfig, getActiveGuildAbsences, updateAbsenceReturn, formatDate: formatAbsenceDate, DEFAULT_ABSENCE_LOG_CHANNEL_ID } = require('../../utils/ausenciaManager');
const { getGuildProfiles, checkProfileUpdates, parseTestPeriod, registerManualProfile, readProfileConfig, toggleProfileBilling } = require('../../utils/profileManager');
const { hasVortexLevel } = require('../../utils/permissions');

const STATS_PATH = path.join(__dirname, '..', 'stats.json');
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const SUPERIOR_ID = '1497703127074345040';
const NOTICE_DM_REENABLE_USER_IDS = ['289227932432334869', '761011766440230932'];
const DEFAULT_POINT_ACTION_CHANNEL_ID = '1498087608390127806';
const DEFAULT_POINT_ADJUST_CATEGORY_ID = '1498087442304073870';
const VORTEX_PANEL_IMAGE = path.join(__dirname, '..', '..', 'foto', 'IMG_4234.png');
const VORTEX_PANEL_IMAGE_NAME = 'IMG_4234.png';
const UPDATES_PATH = path.join(__dirname, '..', '..', 'SISTEMA_ATUALIZACOES.md');
const commandPermissionSelections = new Map();
const pointReadjustSelections = new Map();
const profileRegisterSelections = new Map();
const COMMAND_PERMISSION_OPTIONS = [
    { label: '/avisos', value: 'avisos', description: 'Quem pode abrir e enviar avisos' },
    { label: '/set', value: 'set', description: 'Quem pode usar o sistema de set' },
    { label: '/registro', value: 'registro', description: 'Quem pode consultar registro de ponto' },
    { label: '/ponto', value: 'ponto', description: 'Quem pode gerar relatorio de ponto' },
    { label: '/ausencia', value: 'ausencia', description: 'Quem pode usar ausencia' },
    { label: '/perfil', value: 'perfil', description: 'Quem pode consultar e atualizar perfil' },
    { label: '/ativarponto', value: 'ativarponto', description: 'Quem pode publicar o painel de ponto' },
];

function loadJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } }
function saveJSON(p, d) { try { fs.writeFileSync(p, JSON.stringify(d, null, 2)); } catch {} }

function hasStaffPermission(member) {
    return hasVortexLevel(member, ['admin']);
}

function hasMasterPermission(member) {
    return Boolean(member?.roles?.cache?.has(SUPERIOR_ID));
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

async function safeReply(interaction, options) {
    if (interaction.replied || interaction.deferred) {
        return interaction.followUp(options).catch(() => null);
    }
    return interaction.reply(options).catch(() => null);
}

async function safeUpdate(interaction, options) {
    const { ephemeral, ...updateOptions } = options;
    if (interaction.replied || interaction.deferred) {
        return interaction.editReply(options).catch(() => interaction.followUp(options).catch(() => null));
    }
    return interaction.update(updateOptions).catch(() => interaction.reply(options).catch(() => null));
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('VORTEX MANAGEMENT SYSTEM - Painel de Controle'),

  async execute(interaction) {
    return renderDashboard(interaction, hasStaffPermission(interaction.member) ? 'tab_stats' : 'config_set');
  },

  async handleButton(interaction) {
    const customId = interaction.customId;
    const conf = loadJSON(CONFIG_PATH);

    if (customId.startsWith('tab_')) {
      return renderDashboard(interaction, customId, true);
    }

    if (customId === 'config_set' || customId === 'config_avisos') {
      return renderDashboard(interaction, customId, true);
    }

    if (!hasStaffPermission(interaction.member)) return safeReply(interaction, { content: '❌ Sem permissão para usar esta ação.', ephemeral: true });

    if ((customId === 'tab_manutencao' || ['toggle_maint', 'toggle_channel_logs', 'toggle_dm_logs', 'test_notice'].includes(customId)) && !hasMasterPermission(interaction.member)) {
      return safeReply(interaction, { content: `❌ Somente o cargo <@&${SUPERIOR_ID}> pode usar a manutenção.`, ephemeral: true });
    }

    if (customId === 'show_all_points') {
      await interaction.deferReply({ ephemeral: true });
      const payload = await buildAllPointsReportPayload(interaction.guild);

      sendVortexLog(interaction.client, {
          title: 'Relatorio Completo de Pontos Gerado',
          description: `O relatorio completo de pontos foi gerado por <@${interaction.user.id}> (${interaction.user.id}).`,
          color: '#7000FF',
          type: 'PONTO',
          userId: interaction.user.id
      }).catch(() => {});

      return interaction.editReply(payload);
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
      conf.DISABLE_CHANNEL_LOGS = !conf.DISABLE_CHANNEL_LOGS;
      saveJSON(CONFIG_PATH, conf);

      sendVortexLog(interaction.client, {
          title: 'Logs de Canal Alterados',
          description: `Envio de logs no canal foi **${conf.DISABLE_CHANNEL_LOGS ? 'DESLIGADO' : 'LIGADO'}** por <@${interaction.user.id}>.`,
          color: conf.DISABLE_CHANNEL_LOGS ? '#FFA500' : '#57F287',
          type: 'CONFIGURAÇÃO',
          userId: interaction.user.id
      }).catch(() => {});

      return renderDashboard(interaction, 'tab_manutencao', true);
    }

    if (customId === 'toggle_dm_logs') {
      conf.DISABLE_DM_LOGS = !conf.DISABLE_DM_LOGS;
      saveJSON(CONFIG_PATH, conf);

      sendVortexLog(interaction.client, {
          title: 'Logs por DM Alterados',
          description: `Envio de logs por DM foi **${conf.DISABLE_DM_LOGS ? 'DESLIGADO' : 'LIGADO'}** por <@${interaction.user.id}>.\n\nA DM de boas-vindas continua ativa.`,
          color: conf.DISABLE_DM_LOGS ? '#FFA500' : '#57F287',
          type: 'CONFIGURAÇÃO',
          userId: interaction.user.id
      }).catch(() => {});

      return renderDashboard(interaction, 'tab_manutencao', true);
    }

    if (customId === 'toggle_notice_dms') {
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

      return renderDashboard(interaction, 'tab_config', true);
    }

    if (customId === 'toggle_absence_end_message') {
      const absenceConfig = getAbsenceConfig();
      const nextConfig = saveAbsenceConfig({
        DISABLE_ABSENCE_END_MESSAGE: !absenceConfig.disableEndMessage,
      });

      sendVortexLog(interaction.client, {
          title: 'Mensagem de Ausencia Alterada',
          description: `Mensagem de fim de ausencia foi **${nextConfig.disableEndMessage ? 'DESLIGADA' : 'LIGADA'}** por <@${interaction.user.id}>.`,
          color: nextConfig.disableEndMessage ? '#FFA500' : '#57F287',
          type: 'AUSENCIA',
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

    if (customId === 'clear_point_user' || customId === 'correct_point_close') {
        const selectedUserId = pointReadjustSelections.get(getSelectionKey(interaction));
        const modal = new ModalBuilder()
            .setCustomId(customId === 'clear_point_user' ? 'modal_clear_point_user' : 'modal_correct_point_close')
            .setTitle(customId === 'clear_point_user' ? 'Deletar Dados de Ponto' : 'Reajustar Ponto');

        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('user_id')
                .setLabel('ID DO USUARIO')
                .setPlaceholder('Selecione no painel ou cole o ID Discord')
                .setValue(selectedUserId || '')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
        ));

        if (customId === 'correct_point_close') {
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('started_at')
                        .setLabel('HORARIO QUE ABRIU O PONTO')
                        .setPlaceholder('Obrigatorio: 27/04/2026 14:00:00')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('closed_at')
                        .setLabel('HORARIO QUE FECHOU O PONTO')
                        .setPlaceholder('Obrigatorio: 27/04/2026 18:30:00')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                )
            );
        }

        return interaction.showModal(modal);
    }

    if (customId === 'set_absence_role') {
        const absenceConfig = getAbsenceConfig();
        const modal = new ModalBuilder()
            .setCustomId('modal_absence_role')
            .setTitle('Configurar Cargo de Ausencia');

        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('role_id')
                .setLabel('ID DO CARGO DE AUSENCIA')
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
            .setTitle('Alterar Retorno de Ausencia');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('user_id')
                    .setLabel('ID DO USUARIO')
                    .setPlaceholder('Cole o ID Discord do usuario')
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
                    .setPlaceholder('Cole o ID Discord do usuario')
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
                    .setCustomId('photo_link')
                    .setLabel('LINK DA FOTO')
                    .setPlaceholder('Cole o link da foto do Discord ou imagem')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
            )
        );

        return interaction.showModal(modal);
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

  },

  async handleSelectMenu(interaction) {
    if (!hasStaffPermission(interaction.member)) return safeReply(interaction, { content: '❌ Sem permissão.', ephemeral: true });
    
    const data = loadJSON(CONFIG_PATH);
    if (interaction.customId === 'select_log') {
        if (!hasVortexLevel(interaction.member, ['admin'])) return safeReply(interaction, { content: '❌ Apenas Admin Vortex pode alterar o canal de logs.', ephemeral: true });
        data.LOG_CHANNEL = String(interaction.values[0]);
        saveJSON(CONFIG_PATH, data);
        
        sendVortexLog(interaction.client, {
            title: 'Canal de Logs Alterado',
            description: `O canal de logs foi alterado para <#${data.LOG_CHANNEL}> por <@${interaction.user.id}>.`,
            color: '#00D9FF',
            type: 'CONFIGURAÇÃO',
            userId: interaction.user.id
        }).catch(() => {});

        return renderDashboard(interaction, 'tab_config', true);
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

    if (interaction.customId === 'select_point_readjust_user') {
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
    if (!hasStaffPermission(interaction.member)) return safeReply(interaction, { content: '❌ Sem permissão.', ephemeral: true });
    
    const data = loadJSON(CONFIG_PATH);
    if (interaction.customId === 'modal_clear_point_user') {
        const userId = interaction.fields.getTextInputValue('user_id').trim();
        if (!/^\d{15,25}$/.test(userId)) {
            return safeReply(interaction, { content: '❌ ID de usuário inválido.', ephemeral: true });
        }

        const existed = await deleteUserPoint(interaction.guild.id, userId);
        await updateStatusPanel(interaction.client, interaction.guild.id);

        sendVortexLog(interaction.client, {
            title: 'Dados de Ponto Deletados',
            description: `Os dados de ponto de <@${userId}> (${userId}) foram deletados por <@${interaction.user.id}>.\nRegistro existia: ${existed ? 'sim' : 'nao'}.`,
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
        const startedAtInput = interaction.fields.getTextInputValue('started_at').trim();
        const closedAtInput = interaction.fields.getTextInputValue('closed_at').trim();

        if (!/^\d{15,25}$/.test(userId)) {
            return safeReply(interaction, { content: '❌ ID de usuário inválido.', ephemeral: true });
        }

        const result = await adjustPointSession(interaction.guild.id, userId, startedAtInput, closedAtInput, interaction.user.id);
        if (!result.ok) {
            return safeReply(interaction, { content: `❌ ${result.message}`, ephemeral: true });
        }

        await updateStatusPanel(interaction.client, interaction.guild.id);

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
            title: 'Cargo de Ausencia Alterado',
            description: `O cargo de ausencia foi alterado para <@&${roleId}> por <@${interaction.user.id}>.`,
            color: '#7000FF',
            type: 'AUSENCIA',
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
            title: 'Retorno de Ausencia Alterado',
            description: [
                `**Staff:** <@${interaction.user.id}>`,
                `**Usuario:** <@${userId}> (${userId})`,
                `**Retorno anterior:** ${formatAbsenceDate(result.oldEndsAt)}`,
                `**Novo retorno:** ${formatAbsenceDate(result.absence.endsAt)}`,
                `**DM enviada:** ${result.dmSent ? 'sim' : 'nao'}`,
            ].join('\n'),
            color: '#FEE75C',
            type: 'AUSENCIA',
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
            return safeReply(interaction, { content: '❌ Periodo invalido. Use unidade `minutos`, `horas` ou `dias`.', ephemeral: true });
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
            photoLink: photoLink || null,
            registeredBy: interaction.user.id,
        });

        if (!result.ok) {
            return safeReply(interaction, { content: `❌ ${result.message}`, ephemeral: true });
        }

        return safeReply(interaction, {
            content: [
                '✅ Perfil cadastrado no sistema.',
                `Usuário: <@${userId}>`,
                `Nome: ${result.profile.nomeGame || result.profile.displayName}`,
                `Call/Canal: ${result.profile.callChannelId ? `<#${result.profile.callChannelId}>` : 'N/A'}`,
                `Fotos salvas: ${Array.isArray(result.profile.photoLinks) ? result.profile.photoLinks.length : 0}`,
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
    new ButtonBuilder().setCustomId('tab_updates').setLabel('Atualizações').setStyle(tab === 'tab_updates' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!canAccessPanelTab(interaction.member, 'tab_updates'))
  );

  const actionRow = new ActionRowBuilder();
  let extraRows = [];

  if (tab === 'tab_stats') {
    embed.setAuthor({ name: 'VORTEX | DASHBOARD', iconURL: guild.iconURL() || client.user.displayAvatarURL() }).setColor('#7000FF')
      .setDescription('### 📊 Resumo em Tempo Real\n*Painel geral de estatísticas do servidor*\n\n**Como funciona**\nEsta aba mostra os principais números do servidor e o status atual do sistema. Use os botões do painel para navegar entre as áreas administrativas.')
      .addFields(
        { name: '👤 Membros', value: String(guild.memberCount), inline: true },
        { name: '📋 Fichas', value: String((stats.aprovados || 0) + (stats.recusados || 0) + (stats.pendentes || 0)), inline: true },
        { name: '🟢 Status', value: conf.MAINTENANCE_MODE ? '🔴 Em Manutenção' : '🟢 Online', inline: true }
      );
  } else if (tab === 'tab_roles') {
    const levels = ensureRoleLevels(conf);
    const permissions = ensureCommandPermissions(conf);
    embed.setAuthor({ name: '🛡️ VORTEX | GESTÃO DE ACESSOS', iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor('#5865F2')
      .setDescription('### 🔐 Controle de Cargos Vortex\n\n' + 
                      'Nesta aba você seleciona cargos pesquisando pelo nome e define o nivel de acesso de cada grupo.\n\n' +
                      '**Como funciona**\n' +
                      '**Admin:** mexe em avisos, set e todos os sistemas de ponto, mas nao usa manutenção.\n' +
                      '**Medio:** aceita set e envia avisos.\n' +
                      '**Membro:** usa botoes de bater ponto e registra ações basicas.\n\n' +
                      '**👑 Administrador Master:** <@&1497703127074345040>\n\n' +
                      '*Manutenção continua liberada somente para o cargo master.*')
      .addFields(
        { name: 'Acesso total', value: `<@&${SUPERIOR_ID}>`, inline: false },
        { name: 'Admin Vortex', value: formatRoleList(levels.admin), inline: false },
        { name: 'Medio Vortex', value: formatRoleList(levels.medio), inline: false },
        { name: 'Membro Vortex', value: formatRoleList(levels.membro), inline: false },
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
        new RoleSelectMenuBuilder().setCustomId('select_vortex_role_medio').setPlaceholder('Selecionar cargos Medio Vortex').setMinValues(0).setMaxValues(5)
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
                      'Apenas o cargo <@&1497703127074345040> pode gerenciar este estado.')
      .addFields(
          { name: '✅ Liberados', value: '`/painel`, `/set` (Staff)', inline: true },
          { name: '⛔ Restritos', value: '`/manutencao` (Geral)', inline: true },
          { name: '📢 Logs no canal', value: conf.DISABLE_CHANNEL_LOGS ? '`Desligados`' : '`Ligados`', inline: true },
          { name: '📩 Logs por DM', value: conf.DISABLE_DM_LOGS ? '`Desligados`' : '`Ligados`', inline: true },
          { name: '✨ Boas-vindas', value: '`Sempre ativa`', inline: true },
          { name: 'Canal do ponto', value: `<#${conf.POINT_ACTION_CHANNEL_ID || DEFAULT_POINT_ACTION_CHANNEL_ID}>`, inline: true },
          { name: 'Categoria de ajuste', value: `<#${conf.POINT_ADJUST_CATEGORY_ID || DEFAULT_POINT_ADJUST_CATEGORY_ID}>`, inline: true }
      )

    actionRow.addComponents(
      new ButtonBuilder().setCustomId('toggle_maint').setLabel(conf.MAINTENANCE_MODE ? '🟢 Desativar Manutenção' : '🔴 Ativar Manutenção').setStyle(conf.MAINTENANCE_MODE ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('toggle_channel_logs').setLabel(conf.DISABLE_CHANNEL_LOGS ? '📢 Ligar Log' : '🔕 Desligar Log').setStyle(conf.DISABLE_CHANNEL_LOGS ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('toggle_dm_logs').setLabel(conf.DISABLE_DM_LOGS ? '📩 Ligar Log DM' : '📵 Desligar Log DM').setStyle(conf.DISABLE_DM_LOGS ? ButtonStyle.Success : ButtonStyle.Secondary),
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
    embed.setTitle('⚙️ CONFIGURAÇÕES').setColor('#00D9FF')
      .setDescription('### Configuração geral\n\nUse os botões abaixo para abrir a configuração específica de **Set** ou **Avisos**. O canal de logs continua configurável nesta tela.')
      .addFields(
        { name: 'Canal de logs', value: conf.LOG_CHANNEL ? `<#${conf.LOG_CHANNEL}>` : '`Nao configurado`', inline: true },
        { name: 'Set', value: 'Configure cargos e permissões do sistema de set.', inline: true },
        { name: 'Avisos', value: 'Configure DMs e cargo mencionado nos avisos.', inline: true }
      );
    actionRow.addComponents(
      new ChannelSelectMenuBuilder().setCustomId('select_log').setPlaceholder('Selecione o Canal de Logs').addChannelTypes(ChannelType.GuildText)
    );

    extraRows = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('config_set').setLabel('Set').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('config_avisos').setLabel('Avisos').setStyle(ButtonStyle.Secondary)
      ),
    ];
  } else if (tab === 'config_avisos') {
    embed.setTitle('⚙️ CONFIGURAÇÕES | AVISOS').setColor('#7000FF')
      .setDescription('### Configurar avisos\n\nControle o envio de DMs globais e escolha um cargo extra para ser mencionado nos avisos.')
      .addFields(
        { name: 'Avisos por DM', value: conf.DISABLE_NOTICE_DMS ? '`Desativados`' : '`Ativados`', inline: true },
        { name: 'Cargo extra mencionado', value: conf.NOTICE_MENTION_ROLE_ID ? `<@&${conf.NOTICE_MENTION_ROLE_ID}>` : '`Nao configurado`', inline: true }
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
        new ButtonBuilder().setCustomId('tab_config').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
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
        { name: 'Nivel Medio Vortex', value: 'Tambem pode aceitar set e mandar avisos quando configurado em Cargos Vortex.', inline: false }
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
        new ButtonBuilder().setCustomId('tab_config').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('config_avisos').setLabel('Avisos').setStyle(ButtonStyle.Primary)
      ),
      pointRoleRow,
    ];
  } else if (tab === 'tab_pontos') {
    const selectedReadjustUserId = pointReadjustSelections.get(getSelectionKey(interaction));
    embed.setAuthor({ name: '🕒 VORTEX | GESTÃO DE PONTOS', iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor('#ED4245')
      .setDescription([
        '### Controle de dados de ponto',
        '',
        '**Como funciona**',
        'Use esta aba para deletar dados de ponto ou fazer um reajuste manual.',
        'Para achar a pessoa com mais facilidade, selecione o usuário abaixo antes de clicar em `Reajustar ponto`.',
        '',
        `**Usuario selecionado:** ${selectedReadjustUserId ? `<@${selectedReadjustUserId}>` : '`Nenhum`'}`,
        '',
        '**Reajuste de ponto**',
        'Informe a hora que abriu o ponto e a hora que fechou o ponto. O sistema soma esse periodo no total do usuario e salva em `commands/pontos.json`.',
        '',
        'Formato obrigatório: `DD/MM/AAAA HH:mm:ss`. Os segundos são opcionais.',
      ].join('\n'));

    actionRow.addComponents(
      new ButtonBuilder().setCustomId('show_all_points').setLabel('Mostrar todos os pontos').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('correct_point_close').setLabel('Reajustar ponto').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('clear_point_user').setLabel('🗑️ Deletar ponto de usuário').setStyle(ButtonStyle.Danger)
    );
    extraRows = [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('select_point_readjust_user')
          .setPlaceholder('Selecionar usuario para reajustar ponto')
          .setMinValues(1)
          .setMaxValues(1)
      ),
    ];
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
      : 'Nenhuma ausencia ativa no momento.';

    embed.setAuthor({ name: 'VORTEX | GESTÃO DE AUSÊNCIAS', iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor('#7000FF')
      .setDescription([
        '### Controle de ausências',
        '',
        '**Como funciona**',
        'Use esta aba para configurar o cargo aplicado pelo `/ausencia`, controlar a mensagem de fim e alterar o retorno de quem esta ausente.',
        '',
        '**Ausencias ativas**',
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
        'Este módulo acompanha os usuarios aprovados no `/set`.',
        'Também permite cadastrar manualmente pessoas que já estão no Discord.',
        'Cada perfil deve ser atualizado a cada 1 dia usando `/perfil link:<link da foto>`.',
        'Os links de foto ficam salvos no JSON mesmo se a imagem original for apagada.',
        `Cobrança por DM: **${profileConfig.billingDmEnabled ? 'ligada' : 'desligada'}**`,
        '',
        `Selecionado para cadastro: ${selectedProfile.userId ? `<@${selectedProfile.userId}>` : '`Nenhum usuario`'} | ${selectedProfile.channelId ? `<#${selectedProfile.channelId}>` : '`Nenhuma call/canal`'}`,
        '',
        '**Perfis salvos**',
        profileRows.length ? profileRows.join('\n') : 'Nenhum perfil salvo ainda.',
        '',
        `Data/hora real: ${formatDate(new Date())}`,
      ].join('\n'));

    actionRow.addComponents(
      new ButtonBuilder().setCustomId('profile_register').setLabel('Cadastrar perfil').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('profile_test').setLabel('Testar perfil').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('profile_toggle_billing').setLabel(profileConfig.billingDmEnabled ? 'Desligar cobrança' : 'Ligar cobrança').setStyle(profileConfig.billingDmEnabled ? ButtonStyle.Danger : ButtonStyle.Success)
    );
    extraRows = [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('select_profile_register_user')
          .setPlaceholder('Selecionar usuario para cadastrar perfil')
          .setMinValues(1)
          .setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('select_profile_register_channel')
          .setPlaceholder('Selecionar call/canal do usuario')
          .setMinValues(1)
          .setMaxValues(1)
      ),
    ];
  } else if (tab === 'tab_updates') {
    embed.setAuthor({ name: 'VORTEX | ATUALIZAÇÕES', iconURL: guild.iconURL() || client.user.displayAvatarURL() })
      .setColor('#57F287')
      .setDescription([
        '### Correções e Atualizações',
        '',
        readUpdatesSummary(),
        '',
        `Data/hora real: ${formatDate(new Date())}`,
      ].join('\n').slice(0, 4096));
  }

  let components = ['tab_config', 'config_set', 'config_avisos'].includes(tab) ? [mainRow] : [mainRow, navRow];
  if (actionRow.components.length > 0) components.push(actionRow);
  if (extraRows.length > 0) components.push(...extraRows);

  const options = withPanelImage({ embeds: [embed], components: components, ephemeral: true });
  if (edit) {
    return safeUpdate(interaction, options).catch(err => console.log('Erro ao atualizar painel:', err));
  } else {
    return safeReply(interaction, options).catch(err => console.log('Erro ao enviar painel:', err));
  }
}
