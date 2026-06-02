const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const { sendVortexLog, notifyError, notifyDmFailure, isDmLogDisabled, handleReenableChannelLogsButton, isPrimaryGuild } = require('../utils/notifications');
const { openPoint, closePoint, formatDuration, formatDate } = require('../utils/pontoManager');
const { updateStatusPanel, getPointConfig, setOnlineChannelAccess } = require('../utils/pontoPanel');
const { createAbsence, approveAbsenceRequest, rejectAbsenceRequest, removeOwnAbsence, formatDate: formatAbsenceDate } = require('../utils/ausenciaManager');
const {
    createAdjustmentRequest,
    decideAdjustment,
    decideAdjustmentWithManualRange,
    getAdjustmentApprovalContext,
} = require('../utils/pontoAdjustmentManager');
const { confirmPointPresence, handlePenaltyButton } = require('../utils/pointAutomation');
const { createApprovedSetChannel, handleApprovedChannelGuide, getApprovedSetChannelRecord, getApprovedSetChannelRecordByUser } = require('../utils/approvedSetChannels');
const { getUserProfile, registerApprovedProfile } = require('../utils/profileManager');
const { handleBauButton, handleBauModal } = require('../utils/bauManager');
const { hasAnyVortexRole, hasVortexLevel, hasPanelAccess } = require('../utils/permissions');
const { getPointAllowedRoleIds } = require('../utils/pointRoleConfig');
const { applyApprovedHierarchy } = require('../utils/vortexHierarchy');
const { handleCallInteraction, handleModal: handleCallModal } = require('../config/callManager');
const { safeReply, safeEdit, safeDeferReply, safeShowModal } = require('../utils/safeReply');
const { isPrimaryGuildChannel } = require('../utils/guildScope');
const { createPointActionTranscriptSummary } = require('../utils/pointTranscriptNotifier');
const { queuePointSnapshotSync } = require('../utils/frequencyDashboardSync');
const { buildMaintenanceEmbed, isMaintenanceControlInteraction } = require('../utils/maintenanceMode');

const STATS_PATH = path.join(__dirname, '..', 'commands', 'stats.json');
const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const PEDIDOS_PATH = path.join(__dirname, '..', 'commands', 'pedidos_ativos.json');
const ERROR_LOG_CHANNEL_ID = '1497685822525149337';
const SUPERIOR_IDS = ['1497703127074345040', '1498884908028792942'];
const SUPERIOR_ID = SUPERIOR_IDS[0];

function loadJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } }
function saveJSON(p, d) { try { fs.writeFileSync(p, JSON.stringify(d, null, 2)); } catch {} }

function hasStaffPermission(member) {
    return hasVortexLevel(member, ['admin', 'medio']);
}

function buildManualAdjustmentApprovalModal(requestId, request = {}) {
    const legacyCloseInput = String(request.closedAtInput || '').trim();
    const closePlaceholder = legacyCloseInput
        ? `Ex: 03:00 | Saida pedida: ${legacyCloseInput}`.slice(0, 100)
        : 'Ex: 03:00 ou 03h';

    const modal = new ModalBuilder()
        .setCustomId(`modal_ponto_adjust_accept_range_${requestId}`)
        .setTitle('Corrigir ponto');

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('point_date')
                .setLabel('Data do ponto')
                .setPlaceholder('Ex: 28/05/2026 ou 28 ate 29')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('started_at')
                .setLabel('Hora que entrou')
                .setPlaceholder('Ex: 22:00 ou 22h')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('closed_at')
                .setLabel('Hora que saiu')
                .setPlaceholder(closePlaceholder)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
        )
    );

    return modal;
}

async function schedulePointAdjustmentChannelDelete(channel) {
    if (!channel?.delete || !channel?.guild) return;

    await channel.send({
        content: '🗑️ Ajuste finalizado. Este canal será apagado em **15 segundos**.',
    }).catch(() => {});

    setTimeout(() => {
        channel.delete('Ajuste de ponto finalizado.').catch(() => null);
    }, 15 * 1000);
}

function hasMasterPermission(member) {
    return Boolean(member?.roles?.cache && SUPERIOR_IDS.some(roleId => member.roles.cache.has(roleId)));
}

function hasPointRole(member) {
    const roleIds = getPointAllowedRoleIds();
    return Boolean(member?.roles?.cache && roleIds.some(roleId => member.roles.cache.has(roleId)));
}

function hasAbsenceAccess(member) {
    return hasPointRole(member) || hasAnyVortexRole(member);
}

function isPublicExibirInteraction(interaction) {
    if (interaction.isChatInputCommand?.() && interaction.commandName === 'exibir') return true;
    if (interaction.isStringSelectMenu?.() && String(interaction.customId || '').startsWith('exibir_panel_select')) return true;
    return false;
}

function hasConfiguredCommandAccess(interaction, commandName) {
    if (!interaction?.member?.roles?.cache) return true;
    if (commandName === 'exibir') return true;
    if (commandName === 'clear' || commandName === 'clipe') return true;
    if (commandName === 'perfil') {
        const approvedSetChannelRecord = interaction.channelId
            ? getApprovedSetChannelRecord(interaction.guildId, interaction.channelId)
            : null;
        return hasAbsenceAccess(interaction.member)
            || Boolean(getUserProfile(interaction.guildId, interaction.user.id))
            || Boolean(approvedSetChannelRecord?.userId === interaction.user.id)
            || Boolean(getApprovedSetChannelRecordByUser(interaction.guildId, interaction.user.id))
            || hasStaffPermission(interaction.member);
    }
    if (commandName === 'ausencia') return hasAbsenceAccess(interaction.member);

    const conf = loadJSON(CONFIG_PATH);
    const permissions = conf.COMMAND_ROLE_PERMISSIONS || {};
    const allowedRoles = Array.isArray(permissions[commandName]) ? permissions[commandName].map(String) : [];
    if (SUPERIOR_IDS.some(roleId => interaction.member.roles.cache.has(roleId))) return true;
    if (allowedRoles.length > 0) {
        return allowedRoles.some(roleId => interaction.member.roles.cache.has(roleId));
    }
    if (commandName === 'painel') return hasPanelAccess(interaction.member);
    return hasAnyVortexRole(interaction.member);
}

function isCommandDisabled(conf, commandName) {
    const disabled = Array.isArray(conf.COMMAND_DISABLED_COMMANDS)
        ? conf.COMMAND_DISABLED_COMMANDS.map(String)
        : [];
    return disabled.includes(String(commandName));
}

async function reportInteractionError(client, error, context = 'Interação') {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    const channel = await client.channels.fetch(ERROR_LOG_CHANNEL_ID).catch(() => null);
    if (!isPrimaryGuildChannel(channel)) return false;
    if (!channel?.isTextBased?.()) return false;

    return channel.send({
        embeds: [
            new EmbedBuilder()
                .setColor('#FF0055')
                .setTitle('Erro/Bug de interação')
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

async function runInteractionHandler(interaction, context, handler) {
    try {
        return await handler();
    } catch (error) {
        await reportInteractionError(interaction.client, error, context);
        if (interaction.isRepliable?.()) {
            await safeReply(interaction, {
                content: '❌ Essa interação deu erro. O bug foi enviado para o canal de logs.',
                ephemeral: true,
            });
        }
        return null;
    }
}

async function sendRecruitmentResultDm(client, targetUser, {
    approved,
    guild,
    staffUser,
    tipo = null,
    idGame = null,
    nomeGame = null,
    numeroGame = null,
    nivelGame = null,
}) {
    if (!targetUser) return false;
    if (isDmLogDisabled()) return false;

    const color = approved ? '#57F287' : '#ED4245';
    const title = approved ? 'Set aprovado' : 'Set recusado';
    const statusText = approved
        ? 'Seu pedido de set foi aprovado pela staff.'
        : 'Seu pedido de set foi recusado pela staff.';

    const details = [
        `**Servidor:** ${guild?.name || 'Vortex'}`,
        `**Resultado:** ${approved ? 'Aprovado' : 'Reprovado'}`,
        staffUser ? `**Analisado por:** ${staffUser.tag}` : null,
        tipo ? `**Tipo de set:** ${tipo}` : null,
        nomeGame ? `**Nome em game:** ${nomeGame}` : null,
        idGame ? `**ID em game:** \`${idGame}\`` : null,
        numeroGame ? `**Número em game:** \`${numeroGame}\`` : null,
        nivelGame ? `**Nível em game:** \`${nivelGame}\`` : null,
    ].filter(Boolean).join('\n');

    const nextSteps = approved
        ? [
            'Seus cargos foram atualizados.',
            'Seu apelido pode levar alguns instantes para aparecer atualizado.',
            'Se algo estiver errado, fale com a staff.',
        ].join('\n')
        : [
            'Revise seus dados antes de tentar novamente.',
            'Fale com a staff se precisar entender o motivo.',
        ].join('\n');

    const embed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({
            name: 'VORTEX | Recrutamento',
            iconURL: client.user?.displayAvatarURL?.() || undefined,
        })
        .setTitle(`${approved ? '✅' : '❌'} ${title}`)
        .setDescription(statusText)
        .addFields(
            { name: '📋 Dados do pedido', value: details, inline: false },
            { name: approved ? '✅ Próximo passo' : '⚠️ Orientação', value: nextSteps, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Vortex • Sistema de Set' });

    if (guild?.iconURL?.()) {
        embed.setThumbnail(guild.iconURL({ dynamic: true, size: 256 }));
    }

    try {
        await targetUser.send({ embeds: [embed] });
        return true;
    } catch (error) {
        await notifyDmFailure(
            client,
            targetUser.tag || targetUser.username || 'Usuário',
            targetUser.id,
            error.message,
            approved ? 'DM de aprovação de set' : 'DM de reprovação de set'
        ).catch(() => {});
        return false;
    }
}

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        const { client, guild, user, member } = interaction;
        const conf = loadJSON(CONFIG_PATH);
        if (interaction.guildId && !isPrimaryGuild(interaction.guildId) && !isPublicExibirInteraction(interaction)) return;

        // Bloqueio de Manutenção VORTEX
        if (conf.MAINTENANCE_MODE && !isMaintenanceControlInteraction(interaction, hasMasterPermission(member))) {
            if (interaction.isRepliable()) {
                return safeReply(interaction, { embeds: [buildMaintenanceEmbed(client, conf)], ephemeral: true, allowedMentions: { parse: [] } });
            }
            return;
        }

        // Slash Commands
        if (interaction.isChatInputCommand()) {
            const cmd = client.commands.get(interaction.commandName);
            if (cmd) {
                try {
                    if (isCommandDisabled(conf, interaction.commandName)) {
                        return safeReply(interaction, {
                            content: '❌ Este comando está desativado.',
                            ephemeral: true,
                        });
                    }

                    if (!hasConfiguredCommandAccess(interaction, interaction.commandName)) {
                        return safeReply(interaction, {
                            content: '❌ Você não tem cargo liberado no /painel para usar este comando.',
                            ephemeral: true,
                        });
                    }

                    if (interaction.commandName === 'perfil') {
                        const target = interaction.options.getUser('usuario') || interaction.user;
                        if (target.id !== interaction.user.id && !hasVortexLevel(interaction.member, ['admin'])) {
                            return safeReply(interaction, {
                                content: '❌ Você só pode consultar ou atualizar o seu próprio perfil.',
                                ephemeral: true,
                            });
                        }
                    }

                    sendVortexLog(client, {
                        title: 'Comando Executado',
                        description: [
                            `**Comando:** /${interaction.commandName}`,
                            `**Usuário:** <@${user.id}> (${user.id})`,
                            `**Canal:** ${interaction.channel ? `<#${interaction.channel.id}>` : 'N/A'}`,
                            `**Servidor:** ${guild ? `${guild.name} (${guild.id})` : 'DM'}`,
                        ].join('\n'),
                        color: '#5865F2',
                        type: 'COMANDO',
                        userId: user.id,
                        channelId: interaction.channelId,
                        guildId: interaction.guildId,
                    }).catch(() => {});
                    await cmd.execute(interaction);
                } catch (error) {
                    await notifyError(client, error, `Comando /${interaction.commandName}`);
                    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                        await safeReply(interaction, { content: 'Ocorreu um erro ao executar este comando.', ephemeral: true });
                    }
                }
            }
            return;
        }

        // Interações do Painel
        if (interaction.isButton() && interaction.customId === 'ponto_adjust_request') {
            const modal = new ModalBuilder()
                .setCustomId('modal_ponto_adjust_request')
                .setTitle('Corrigir ponto');

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('point_date')
                        .setLabel('Data do ponto')
                        .setPlaceholder('Ex: 23, 23/04, 23/04/2026 ou 23 ate 24')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('started_at')
                        .setLabel('Hora que entrou')
                        .setPlaceholder('Ex: 18:30 ou 18h30')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('closed_at')
                        .setLabel('Hora que saiu')
                        .setPlaceholder('Ex: 23:00 ou 02h')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('reason')
                        .setLabel('Motivo do ajuste')
                        .setPlaceholder('Explique por que o ponto não foi fechado corretamente.')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                        .setMaxLength(900)
                )
            );

            return safeShowModal(interaction, modal);
        }

        if (interaction.isModalSubmit() && interaction.customId === 'modal_ponto_adjust_request') {
            await safeDeferReply(interaction, { ephemeral: true });
            const pointDateInput = interaction.fields.getTextInputValue('point_date').trim();
            const startedAtInput = interaction.fields.getTextInputValue('started_at').trim();
            const closedAtInput = interaction.fields.getTextInputValue('closed_at').trim();
            const reason = interaction.fields.getTextInputValue('reason').trim();
            const result = await createAdjustmentRequest(interaction, pointDateInput, startedAtInput, closedAtInput, reason);
            if (!result.ok) {
                return safeEdit(interaction, { content: `❌ ${result.message}` });
            }
            return safeEdit(interaction, {
                content: `✅ Pedido de ajuste aberto em <#${result.channel.id}>. Aguarde a análise da staff.`,
            });
        }

        if (interaction.isButton() && (interaction.customId.startsWith('ponto_adjust_accept_') || interaction.customId.startsWith('ponto_adjust_reject_'))) {
            const approved = interaction.customId.startsWith('ponto_adjust_accept_');
            const requestId = interaction.customId.replace(approved ? 'ponto_adjust_accept_' : 'ponto_adjust_reject_', '');

            if (approved) {
                const approvalContext = await getAdjustmentApprovalContext(interaction, requestId);
                if (!approvalContext.ok) {
                    return safeReply(interaction, { content: `❌ ${approvalContext.message}`, ephemeral: true });
                }
                if (approvalContext.needsManualRange) {
                    return safeShowModal(interaction, buildManualAdjustmentApprovalModal(requestId, approvalContext.request));
                }
            }

            await safeDeferReply(interaction, { ephemeral: true });
            const result = await decideAdjustment(interaction, requestId, approved);
            if (!result.ok) {
                return safeEdit(interaction, { content: `❌ ${result.message}` });
            }

            await updateStatusPanel(client, guild.id, { forceVisibilitySync: true });
            await interaction.message.edit({ components: [] }).catch(() => {});
            await interaction.channel.send({
                content: [
                    approved ? '✅ Ajuste aprovado.' : '❌ Ajuste recusado.',
                    result.message,
                    `Analisado por: <@${interaction.user.id}>`,
                ].join('\n'),
            }).catch(() => {});
            await schedulePointAdjustmentChannelDelete(interaction.channel);

            return safeEdit(interaction, { content: result.message });
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_ponto_adjust_accept_range_')) {
            await safeDeferReply(interaction, { ephemeral: true });
            const requestId = interaction.customId.replace('modal_ponto_adjust_accept_range_', '');
            const pointDateInput = interaction.fields.getTextInputValue('point_date').trim();
            const startedAtInput = interaction.fields.getTextInputValue('started_at').trim();
            const closedAtInput = interaction.fields.getTextInputValue('closed_at').trim();
            const result = await decideAdjustmentWithManualRange(interaction, requestId, pointDateInput, startedAtInput, closedAtInput);
            if (!result.ok) {
                return safeEdit(interaction, { content: `❌ ${result.message}` });
            }

            await updateStatusPanel(client, guild.id, { forceVisibilitySync: true });
            await interaction.channel.send({
                content: [
                    '✅ Ajuste aprovado.',
                    result.message,
                    `Analisado por: <@${interaction.user.id}>`,
                ].join('\n'),
            }).catch(() => {});
            await schedulePointAdjustmentChannelDelete(interaction.channel);

            return safeEdit(interaction, { content: result.message });
        }

        if (interaction.isButton() && (interaction.customId === 'ponto_open' || interaction.customId === 'ponto_close')) {
            const pointConfig = getPointConfig();
            if (interaction.channel.id !== pointConfig.actionChannelId) {
                return safeReply(interaction, {
                    content: `Você só pode bater ponto em <#${pointConfig.actionChannelId}>.`,
                    ephemeral: true
                });
            }

            if (!hasPointRole(member)) {
                const roleIds = getPointAllowedRoleIds();
                return safeReply(interaction, {
                    content: `❌ Você não tem cargo liberado para bater ponto. Cargos permitidos: ${roleIds.map(roleId => `<@&${roleId}>`).join(' ')}`,
                    ephemeral: true,
                    allowedMentions: { roles: [] },
                });
            }

            await safeDeferReply(interaction, { ephemeral: true });

            const opening = interaction.customId === 'ponto_open';
            const result = opening
                ? await openPoint(guild.id, user.id, {
                    userName: member?.displayName || user.username,
                    userMention: `<@${user.id}>`,
                    registro: user.id
                })
                : await closePoint(guild.id, user.id);

            if (result.action === 'opened' || (opening && result.action === 'already_open')) {
                await setOnlineChannelAccess(client, guild.id, user.id, true);
            }
            if (result.action === 'closed' || (!opening && result.action === 'already_closed')) {
                await setOnlineChannelAccess(client, guild.id, user.id, false);
            }

            await updateStatusPanel(client, guild.id, { forceVisibilitySync: true });
            if (result.action === 'opened' || result.action === 'closed') {
                queuePointSnapshotSync(client);
            }

            if (result.action === 'already_open') {
                return safeEdit(interaction, {
                    content: '❌ Seu ponto já está aberto.',
                });
            }

            if (result.action === 'already_closed') {
                return safeEdit(interaction, {
                    content: '❌ Você não possui ponto aberto.',
                });
            }

            if (result.action === 'too_soon') {
                return safeEdit(interaction, {
                    content: `⏳ O ponto só pode ser fechado depois de **60 segundos** aberto. Tempo atual: **${formatDuration(result.durationMs)}**. Aguarde mais **${formatDuration(result.waitMs)}**.`,
                });
            }

            sendVortexLog(client, {
                title: opening ? 'Ponto Aberto' : 'Ponto Fechado',
                description: opening
                    ? `<@${user.id}> abriu o ponto as ${formatDate(result.data.activePointStartedAt)}.`
                    : `<@${user.id}> fechou o ponto às ${formatDate(result.data.lastPointCloseAt)}. Duração: ${formatDuration(result.durationMs)}.`,
                color: opening ? '#57F287' : '#ED4245',
                type: 'PONTO',
                userId: user.id,
                channelId: interaction.channelId,
            }).catch(() => {});

            const summary = await createPointActionTranscriptSummary({
                guild,
                target: user,
                generatedBy: user,
                action: opening ? 'opened' : 'closed',
                result,
            });

            return safeEdit(interaction, {
                content: summary.content,
                allowedMentions: { users: [user.id] },
            });
        }

        if (interaction.isButton() && interaction.customId.startsWith('point_presence_confirm_')) {
            return confirmPointPresence(interaction);
        }

        if (interaction.isButton() && String(interaction.customId || '').startsWith('live_')) {
            const lives = client.commands.get('lives');
            if (lives?.handleButton) {
                return runInteractionHandler(interaction, `Lives botão: ${interaction.customId}`, () => lives.handleButton(interaction));
            }
        }

        if (interaction.isModalSubmit() && String(interaction.customId || '').startsWith('live_modal_')) {
            const lives = client.commands.get('lives');
            if (lives?.handleModal) {
                return runInteractionHandler(interaction, `Lives modal: ${interaction.customId}`, () => lives.handleModal(interaction));
            }
        }

        if (interaction.isButton() && (interaction.customId.startsWith('point_penalty_accept_') || interaction.customId.startsWith('point_penalty_reject_'))) {
            if (!hasStaffPermission(member)) return safeReply(interaction, { content: '❌ Sem permissão.', ephemeral: true });
            return handlePenaltyButton(interaction);
        }

        if (interaction.isButton() && (interaction.customId.startsWith('approved_channel_guide_') || interaction.customId === 'approved_channel_guide_done')) {
            return handleApprovedChannelGuide(interaction);
        }

        if (interaction.isButton() && interaction.customId === 'ausencia_request') {
            if (!hasAbsenceAccess(member)) {
                return safeReply(interaction, { content: '❌ Você não tem cargo liberado para usar ausência.', ephemeral: true });
            }
            const ausencia = client.commands.get('ausencia');
            if (!ausencia?.buildAbsenceModal) {
                return safeReply(interaction, { content: '❌ Sistema de ausência indisponível no momento.', ephemeral: true });
            }
            return safeShowModal(interaction, ausencia.buildAbsenceModal(interaction));
        }

        if (interaction.isButton() && interaction.customId === 'ausencia_remove') {
            if (!hasAbsenceAccess(member)) {
                return safeReply(interaction, { content: '❌ Você não tem cargo liberado para usar ausência.', ephemeral: true });
            }
            await safeDeferReply(interaction, { ephemeral: true });
            const result = await removeOwnAbsence(interaction);
            if (!result.ok) {
                return safeEdit(interaction, { content: `❌ ${result.message}` });
            }
            return safeEdit(interaction, {
                content: `✅ Sua ausência foi retirada. Retorno registrado em ${formatAbsenceDate(result.absence.removedAt)}.`,
            });
        }

        if (interaction.isButton() && (interaction.customId.startsWith('ausencia_accept_') || interaction.customId.startsWith('ausencia_reject_'))) {
            if (!hasStaffPermission(member)) {
                return safeReply(interaction, { content: '❌ Sem permissão.', ephemeral: true });
            }

            return runInteractionHandler(interaction, `Ausência botão: ${interaction.customId}`, async () => {
                await safeDeferReply(interaction, { ephemeral: true });
                const approved = interaction.customId.startsWith('ausencia_accept_');
                const userId = interaction.customId.replace(approved ? 'ausencia_accept_' : 'ausencia_reject_', '');
                const result = approved
                    ? await approveAbsenceRequest(interaction, userId)
                    : await rejectAbsenceRequest(interaction, userId);

                if (!result.ok) {
                    return safeEdit(interaction, { content: `❌ ${result.message}` });
                }

                await interaction.message.edit({ components: [] }).catch(() => null);
                const scheduled = approved && result.absence?.status === 'scheduled';
                await interaction.channel.send({
                    content: approved
                        ? (scheduled
                            ? `✅ Ausência aceita para <@${userId}>. Cargo será aplicado em ${formatAbsenceDate(result.absence.startsAt)}.`
                            : `✅ Ausência aceita para <@${userId}>. Cargo aplicado.`)
                        : `❌ Ausência recusada para <@${userId}>. O usuário foi avisado por DM.`,
                    allowedMentions: { parse: [] },
                }).catch(() => null);
                setTimeout(() => interaction.channel.delete('Solicitação de ausência concluída.').catch(() => null), 30000);

                return safeEdit(interaction, {
                    content: approved
                        ? (scheduled
                            ? `✅ Ausência aceita para <@${userId}> e agendada para ${formatAbsenceDate(result.absence.startsAt)}.`
                            : `✅ Ausência aceita para <@${userId}>.`)
                        : `❌ Ausência recusada para <@${userId}>.`,
                });
            });
        }

        if (interaction.isButton() && interaction.customId === 're_enable_channel_logs') {
            return runInteractionHandler(interaction, 'Botao DM: religar logs', () => handleReenableChannelLogsButton(interaction));
        }

        if (interaction.isButton() && [
            'call_create',
            'call_private',
            'call_public',
            'call_limit',
            'call_allow',
            'call_disconnect',
            'call_ban',
            'call_delete',
        ].includes(interaction.customId)) {
            return runInteractionHandler(interaction, `Call botão: ${interaction.customId}`, () => handleCallInteraction(interaction));
        }

        if (interaction.isModalSubmit() && (
            interaction.customId === 'modal_call_limit'
            || interaction.customId === 'modal_allow'
            || interaction.customId === 'modal_disconnect'
            || interaction.customId === 'modal_ban'
        )) {
            return runInteractionHandler(interaction, `Call modal: ${interaction.customId}`, () => handleCallModal(interaction));
        }

        if (interaction.isModalSubmit() && interaction.customId === 'modal_ausencia_request') {
            if (!hasAbsenceAccess(member)) {
                return safeReply(interaction, { content: '❌ Você não tem cargo liberado para usar ausência.', ephemeral: true });
            }
            if (!interaction.deferred && !interaction.replied) {
                await safeDeferReply(interaction, { ephemeral: true });
            }

            const result = await createAbsence(interaction, {
                reason: interaction.fields.getTextInputValue('reason'),
                startDateInput: interaction.fields.getTextInputValue('start_date'),
                returnDateInput: interaction.fields.getTextInputValue('return_date'),
            });

            if (!result.ok) {
                return safeEdit(interaction, { content: `❌ ${result.message}` });
            }

            return safeEdit(interaction, {
                content: [
                    '✅ Solicitação de ausência enviada para aprovação.',
                    `Canal: <#${result.channel.id}>`,
                    `Início solicitado: ${formatAbsenceDate(result.absence.startsAt)}`,
                    `Retorno solicitado: ${formatAbsenceDate(result.absence.endsAt)}`,
                ].join('\n'),
            });
        }

        // Interações do Painel
        const avisos = client.commands.get('avisos');
        if (avisos) {
            if (interaction.isChannelSelectMenu() && (interaction.customId === 'avisos_select_channel' || interaction.customId === 'avisos_select_call')) {
                return await avisos.handleSelectMenu(interaction);
            }
            if (interaction.isUserSelectMenu() && interaction.customId === 'avisos_select_user') {
                return await avisos.handleSelectMenu(interaction);
            }
            if (interaction.isRoleSelectMenu() && interaction.customId === 'avisos_select_role') {
                return await avisos.handleSelectMenu(interaction);
            }
            if (interaction.isButton() && (interaction.customId === 'avisos_send_guild' || interaction.customId === 'avisos_send_global' || interaction.customId === 'avisos_send_direct')) {
                return await avisos.handleButton(interaction);
            }
            if (interaction.isModalSubmit() && (interaction.customId === 'avisos_modal_guild' || interaction.customId === 'avisos_modal_global' || interaction.customId === 'avisos_modal_direct')) {
                return await avisos.handleModal(interaction);
            }
        }

        if (interaction.isButton() && String(interaction.customId || '').startsWith('bau_')) {
            return runInteractionHandler(interaction, `Bau botao: ${interaction.customId}`, () => handleBauButton(interaction));
        }

        if (interaction.isModalSubmit() && String(interaction.customId || '').startsWith('modal_bau_')) {
            return runInteractionHandler(interaction, `Bau modal: ${interaction.customId}`, () => handleBauModal(interaction));
        }

        const exibir = client.commands.get('exibir');
        if (exibir && interaction.isStringSelectMenu() && String(interaction.customId || '').startsWith('exibir_panel_select')) {
            return await exibir.handleSelectMenu(interaction);
        }

        // Interações do Painel
        const painel = client.commands.get('painel');
        if (painel) {
            if (interaction.isButton() && (interaction.customId.startsWith('tab_') || interaction.customId.startsWith('panel_back_') || interaction.customId.startsWith('confirm_close_point_') || ['config_set', 'config_avisos', 'config_logs', 'toggle_maint', 'toggle_channel_logs', 'toggle_dm_logs', 'toggle_activity_logs', 'toggle_notice_dms', 'send_test_log', 'toggle_panel_private_mode', 'toggle_vortex_role_remove_mode', 'set_vortex_auto_pending', 'set_vortex_auto_approved', 'publish_fac_hierarchy_panel', 'refresh_fac_hierarchy_panel', 'toggle_selected_log_channel', 'toggle_mirror_message_channel', 'open_adjust_call_v2', 'adjust_call_activate', 'adjust_call_deactivate', 'adjust_call_select_by_id', 'adjust_call_sync', 'visual_set_color', 'visual_set_banner', 'visual_clear_target', 'toggle_absence_end_message', 'test_notice', 'clear_point_user', 'clear_point_no_billing', 'correct_point_close', 'close_selected_point', 'delete_point_correction_channel', 'cancel_close_point', 'show_all_points', 'show_user_point_sheet', 'set_absence_role', 'change_absence_return', 'profile_test', 'profile_register', 'profile_delete_no_billing', 'profile_list_registered', 'profile_toggle_billing', 'toggle_point_monitor', 'toggle_offline_charge', 'run_point_automation'].includes(interaction.customId))) {
                return runInteractionHandler(interaction, `Painel botão: ${interaction.customId}`, () => painel.handleButton(interaction));
            }
            if (interaction.isStringSelectMenu() && interaction.customId === 'select_panel_tool') {
                return runInteractionHandler(interaction, `Painel select: ${interaction.customId}`, () => painel.handleSelectMenu(interaction));
            }
            if (interaction.isChannelSelectMenu() && ['select_log', 'select_disabled_log_channel', 'select_mirror_message_channel', 'select_adjust_call_channel', 'select_point_action_channel', 'select_point_online_channel', 'select_point_adjust_category', 'select_point_online_voice_channel', 'select_profile_register_channel', 'select_fac_hierarchy_channel'].includes(interaction.customId)) {
                return runInteractionHandler(interaction, `Painel select: ${interaction.customId}`, () => painel.handleSelectMenu(interaction));
            }
            if (interaction.isStringSelectMenu() && (interaction.customId === 'select_command_permission_target' || interaction.customId === 'select_fac_hierarchy_target' || interaction.customId === 'select_open_point_user' || interaction.customId === 'select_visual_target' || interaction.customId === 'select_adjust_call_id')) {
                return runInteractionHandler(interaction, `Painel select: ${interaction.customId}`, () => painel.handleSelectMenu(interaction));
            }
            if (interaction.isRoleSelectMenu() && (interaction.customId.startsWith('select_fac_hierarchy_role_') || ['select_notice_mention_role', 'select_point_adjust_role', 'select_point_allowed_roles', 'select_vortex_role_admin', 'select_vortex_role_medio', 'select_vortex_role_membro', 'select_command_permission_roles'].includes(interaction.customId))) {
                return runInteractionHandler(interaction, `Painel select: ${interaction.customId}`, () => painel.handleSelectMenu(interaction));
            }
            if (interaction.isUserSelectMenu() && ['select_point_readjust_user', 'select_profile_register_user'].includes(interaction.customId)) {
                return runInteractionHandler(interaction, `Painel select: ${interaction.customId}`, () => painel.handleSelectMenu(interaction));
            }
            if (interaction.isModalSubmit() && (interaction.customId === 'modal_clear_point_user' || interaction.customId === 'modal_correct_point_close' || interaction.customId === 'modal_absence_role' || interaction.customId === 'modal_absence_return' || interaction.customId === 'modal_profile_test' || interaction.customId === 'modal_profile_register' || interaction.customId === 'modal_visual_color' || interaction.customId === 'modal_visual_banner' || interaction.customId === 'modal_vortex_auto_role_pending' || interaction.customId === 'modal_vortex_auto_role_approved' || interaction.customId === 'modal_adjust_call_id')) {
                return runInteractionHandler(interaction, `Painel modal: ${interaction.customId}`, () => painel.handleModal(interaction));
            }
        }

        // Sistema de Recrutamento (/set)
        if (interaction.isButton() && interaction.customId === 'Vortex_set_start') {
            // Limitação de pedidos simultâneos removida conforme solicitado pelo usuário.
            const existingProfile = getUserProfile(guild.id, user.id);
            if (existingProfile) {
                return safeReply(interaction, {
                    content: '❌ Você já possui perfil cadastrado no sistema Vortex. Para pedir outro set, a gerência precisa apagar seu perfil pelo `/painel` primeiro.',
                    ephemeral: true,
                });
            }

            const select = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('Vortex_select_tipo').setPlaceholder('Escolha o tipo de set').addOptions([
                    { label: 'Morador', value: 'Morador', description: 'Cadastro como morador', emoji: '🏠' },
                    { label: 'Membro', value: 'Membro', description: 'Cadastro como membro da Vortex', emoji: '👤' }
                ])
            );
            return safeReply(interaction, { content: 'Selecione como deseja abrir seu pedido de set:', components: [select], ephemeral: true });
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'Vortex_select_tipo') {
            const modal = new ModalBuilder().setCustomId(`Vortex_modal_${interaction.values[0]}`).setTitle(`Set | ${interaction.values[0]}`);
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id_game').setLabel('ID em game').setPlaceholder('Exemplo: 123').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nome_game').setLabel('Nome em game').setPlaceholder('Exemplo: Gleisson').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('numero_game').setLabel('Número em game').setPlaceholder('Exemplo: 555-123').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nivel_game').setLabel('Nível em game').setPlaceholder('Exemplo: 25').setStyle(TextInputStyle.Short).setRequired(true))
            );
            return safeShowModal(interaction, modal);
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith('Vortex_modal_')) {
            await safeDeferReply(interaction, { ephemeral: true });
            const existingProfile = getUserProfile(guild.id, user.id);
            if (existingProfile) {
                return safeEdit(interaction, {
                    content: '❌ Você já possui perfil cadastrado no sistema Vortex. Para pedir outro set, a gerência precisa apagar seu perfil pelo `/painel` primeiro.',
                });
            }
            const tipo = interaction.customId.split('_')[2];
            const idGame = interaction.fields.getTextInputValue('id_game').trim();
            const nomeGame = interaction.fields.getTextInputValue('nome_game').trim();
            const numeroGame = interaction.fields.getTextInputValue('numero_game').trim();
            const nivelGame = interaction.fields.getTextInputValue('nivel_game').trim();

            const canal = await guild.channels.create({
                name: `set-${user.username}`,
                parent: config.recruitmentCategoryId,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] },
                    ...SUPERIOR_IDS.map(roleId => ({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }))
                ]
            });

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('📋 Pedido de Set')
                .setDescription([
                    `<@${user.id}> abriu um pedido de set.`,
                    '',
                    'Confira os dados abaixo antes de aprovar ou recusar.',
                ].join('\n'))
                .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
                .addFields(
                    { name: '👤 Usuário', value: `<@${user.id}>`, inline: true },
                    { name: '🆔 Discord ID', value: `\`${user.id}\``, inline: true },
                    { name: '📌 Tipo de Set', value: `\`${tipo}\``, inline: true },
                    { name: '🎮 ID em Game', value: `\`${idGame}\``, inline: true },
                    { name: '🏷️ Nome em Game', value: `\`${nomeGame}\``, inline: true },
                    { name: '📱 Número em Game', value: `\`${numeroGame}\``, inline: true },
                    { name: '📈 Nível em Game', value: `\`${nivelGame}\``, inline: true },
                    { name: '📊 Status', value: '`Aguardando análise`', inline: true }
                )
                .setFooter({ text: 'Vortex • Sistema de Set' })
                .setTimestamp();

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`Vortex_app_${user.id}`).setLabel('Aprovar').setEmoji('✅').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`Vortex_rej_${user.id}`).setLabel('Reprovar').setEmoji('❌').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('Vortex_del').setLabel('Apagar').setEmoji('🗑️').setStyle(ButtonStyle.Secondary)
            );

            await canal.send({ content: `<@${user.id}> seu pedido foi aberto. Aguarde a análise da staff.`, embeds: [embed], components: [buttons] });
            await safeEdit(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('✅ Pedido enviado')
                        .setDescription(`Seu canal de atendimento foi criado: <#${canal.id}>`)
                        .setFooter({ text: 'Vortex • Sistema de Set' }),
                ],
            });

            const pedidosAtivos = loadJSON(PEDIDOS_PATH);
            pedidosAtivos[user.id] = {
                channelId: canal.id,
                tipo,
                idGame,
                nomeGame,
                numeroGame,
                nivelGame,
                createdAt: new Date().toISOString(),
            };
            saveJSON(PEDIDOS_PATH, pedidosAtivos);

            const stats = loadJSON(STATS_PATH);
            stats.pendentes = (stats.pendentes || 0) + 1;
            saveJSON(STATS_PATH, stats);

            await sendVortexLog(client, {
                title: 'Novo Pedido de Set',
                description: `O usuário <@${user.id}> abriu um novo pedido de set.\n\n**Tipo:** ${tipo}\n**Canal:** <#${canal.id}>`,
                color: '#3498DB',
                type: 'RECRUTAMENTO',
                userId: user.id,
                channelId: canal.id,
                relatedChannelIds: [interaction.channelId],
            });
            return;
        }

        // Botões de Recrutamento (Aprovar/Reprovar/Apagar)
        if (interaction.isButton()) {
            if (interaction.customId === 'Vortex_del') {
                if (!hasStaffPermission(member)) return safeReply(interaction, { content: '❌ Sem permissão.', ephemeral: true });
                await safeReply(interaction, { content: '🗑️ Apagando este canal...', ephemeral: true });
                return interaction.channel.delete().catch(() => {});
            }

            if (interaction.customId.startsWith('Vortex_app_') || interaction.customId.startsWith('Vortex_rej_')) {
                if (!hasStaffPermission(member)) return safeReply(interaction, { content: '❌ Sem permissão.', ephemeral: true });
                await safeDeferReply(interaction);
                
                const isApp = interaction.customId.startsWith('Vortex_app_');
                const targetId = interaction.customId.split('_')[2];
                const pedidosAtivos = loadJSON(PEDIDOS_PATH);
                const targetUser = await client.users.fetch(targetId).catch(() => null);
                const requestData = typeof pedidosAtivos[targetId] === 'object' && pedidosAtivos[targetId] !== null
                    ? pedidosAtivos[targetId]
                    : {};
                const requestType = requestData.tipo || null;
                const idGame = requestData.idGame || null;
                const nomeGame = requestData.nomeGame || null;
                const numeroGame = requestData.numeroGame || null;
                const nivelGame = requestData.nivelGame || null;
                let dmSent = false;
                let approvedChannel = null;
                let approvedChannelMessage = null;
                
                if (isApp) {
                    const target = await guild.members.fetch(targetId).catch(() => null);
                    if (target) {
                        await applyApprovedHierarchy(target, `Set aprovado por ${user.tag || user.id}`).catch(() => null);
                        if (nomeGame && idGame) {
                            await target.setNickname(`${nomeGame} | ${idGame}`).catch(() => {});
                        }
                        const channelResult = await createApprovedSetChannel(guild, target, {
                            nomeGame,
                            idGame,
                            nivelGame,
                            staffUserId: user.id,
                        }).catch((error) => ({ ok: false, message: error.message, channel: null }));
                        approvedChannel = channelResult.channel;
                        approvedChannelMessage = channelResult.message;
                        await registerApprovedProfile(guild, target, {
                            tipo: requestType,
                            nomeGame,
                            idGame,
                            numeroGame,
                            nivelGame,
                            callChannelId: approvedChannel?.id || null,
                            approvedBy: user.id,
                        }).catch((error) => {
                            approvedChannelMessage = `${approvedChannelMessage || 'Canal processado'} | perfil não salvo: ${error.message}`;
                        });
                    }
                    dmSent = await sendRecruitmentResultDm(client, targetUser || target?.user, {
                        approved: true,
                        guild,
                        staffUser: user,
                        tipo: requestType,
                        idGame,
                        nomeGame,
                        numeroGame,
                        nivelGame,
                    });
                } else {
                    dmSent = await sendRecruitmentResultDm(client, targetUser, {
                        approved: false,
                        guild,
                        staffUser: user,
                        tipo: requestType,
                        idGame,
                        nomeGame,
                       numeroGame,
                       nivelGame,
                    });
                }

                delete pedidosAtivos[targetId];
                saveJSON(PEDIDOS_PATH, pedidosAtivos);

                const stats = loadJSON(STATS_PATH);
                if (isApp) stats.aprovados = (stats.aprovados || 0) + 1;
                else stats.recusados = (stats.recusados || 0) + 1;
                if (stats.pendentes > 0) stats.pendentes--;
                saveJSON(STATS_PATH, stats);

                const resultEmbed = new EmbedBuilder()
                    .setColor(isApp ? '#57F287' : '#ED4245')
                    .setTitle(isApp ? '✅ Set aprovado' : '❌ Set recusado')
                    .setDescription([
                        `Usuário: <@${targetId}>`,
                        `Resultado: ${isApp ? 'Aprovado' : 'Reprovado'}`,
                        `Staff: <@${user.id}>`,
                        `DM enviada: ${dmSent ? 'sim' : 'não'}`,
                        isApp ? `Canal aprovado: ${approvedChannel ? `<#${approvedChannel.id}>` : approvedChannelMessage || 'não criado'}` : null,
                        '',
                        'Canal será deletado em 1 minuto.',
                    ].filter((line) => line !== null).join('\n'))
                    .setTimestamp();

                await safeEdit(interaction, { embeds: [resultEmbed] });

                const finalActionRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('Vortex_del')
                        .setLabel('Apagar')
                        .setEmoji('🗑️')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(!isApp)
                );

                await interaction.message.edit({ components: [finalActionRow] }).catch(() => {});
                
                await sendVortexLog(client, {
                    title: isApp ? 'Solicitação Aprovada' : 'Solicitação Reprovada',
                    description: [
                        `**Staff:** <@${user.id}>`,
                        `**Candidato:** <@${targetId}>`,
                        `**Resultado:** ${isApp ? 'Aprovado' : 'Reprovado'}`,
                        `**DM enviada:** ${dmSent ? 'sim' : 'não'}`,
                        isApp ? `**Canal aprovado:** ${approvedChannel ? `<#${approvedChannel.id}>` : approvedChannelMessage || 'não criado'}` : null,
                    ].filter(Boolean).join('\n'),
                    color: isApp ? '#57F287' : '#FF0055',
                    type: 'RECRUTAMENTO',
                    userId: user.id, // Log para o staff que realizou a ação
                    channelId: interaction.channelId,
                });

                setTimeout(() => interaction.channel.delete().catch(() => {}), 60000);
                return;
            }
        }

        if (interaction.isButton()) {
            return safeReply(interaction, {
                content: `❌ Botão não reconhecido pelo sistema: \`${interaction.customId}\`. O evento foi registrado para correção.`,
                ephemeral: true,
            });
        }
    }
};
