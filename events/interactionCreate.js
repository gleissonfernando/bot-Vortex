const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const { sendVortexLog, notifyError, notifyDmFailure, isDmLogDisabled } = require('../utils/notifications');
const { openPoint, closePoint, formatDuration, formatDate, formatTime } = require('../utils/pontoManager');
const { updateStatusPanel, getPointConfig, setOnlineChannelAccess } = require('../utils/pontoPanel');
const { createAbsence, formatDate: formatAbsenceDate } = require('../utils/ausenciaManager');
const { createAdjustmentRequest, decideAdjustment } = require('../utils/pontoAdjustmentManager');
const { hasAnyVortexRole, hasVortexLevel } = require('../utils/permissions');

const STATS_PATH = path.join(__dirname, '..', 'commands', 'stats.json');
const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const PEDIDOS_PATH = path.join(__dirname, '..', 'commands', 'pedidos_ativos.json');
const SUPERIOR_ID = '1497703127074345040';

function loadJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } }
function saveJSON(p, d) { try { fs.writeFileSync(p, JSON.stringify(d, null, 2)); } catch {} }

function hasStaffPermission(member) {
    return hasVortexLevel(member, ['admin', 'medio']);
}

function hasMasterPermission(member) {
    return Boolean(member?.roles?.cache?.has(SUPERIOR_ID));
}

function hasConfiguredCommandAccess(interaction, commandName) {
    if (!interaction?.member?.roles?.cache) return true;
    if (commandName === 'clear' || commandName === 'clipe') return true;
    if (commandName !== 'painel' && !hasAnyVortexRole(interaction.member)) return false;

    const conf = loadJSON(CONFIG_PATH);
    const permissions = conf.COMMAND_ROLE_PERMISSIONS || {};
    const allowedRoles = Array.isArray(permissions[commandName]) ? permissions[commandName].map(String) : [];
    if (interaction.member.roles.cache.has(SUPERIOR_ID)) return true;
    if (allowedRoles.length === 0) return true;
    return allowedRoles.some(roleId => interaction.member.roles.cache.has(roleId));
}

async function safeReply(interaction, options) {
    if (interaction.replied || interaction.deferred) {
        return interaction.followUp(options).catch(() => null);
    }
    return interaction.reply(options).catch(() => null);
}

async function safeEdit(interaction, options) {
    if (interaction.deferred || interaction.replied) {
        return interaction.editReply(options).catch(() => interaction.followUp(options).catch(() => null));
    }
    return interaction.reply(options).catch(() => null);
}

async function sendRecruitmentResultDm(client, targetUser, {
    approved,
    guild,
    staffUser,
    tipo = null,
    idGame = null,
    nomeGame = null,
    numeroGame = null,
}) {
    if (!targetUser) return false;
    if (isDmLogDisabled()) return false;

    const color = approved ? '#57F287' : '#ED4245';
    const title = approved ? 'Solicitação Aprovada' : 'Solicitação Reprovada';
    const statusText = approved
        ? 'Sua solicitação de set foi aprovada pela equipe.'
        : 'Sua solicitação de set foi reprovada pela equipe.';

    const details = [
        `**Servidor:** ${guild?.name || 'Vortex'}`,
        `**Resultado:** ${approved ? 'Aprovado' : 'Reprovado'}`,
        staffUser ? `**Analisado por:** ${staffUser.tag}` : null,
        tipo ? `**Tipo de set:** ${tipo}` : null,
        nomeGame ? `**Nome em game:** ${nomeGame}` : null,
        idGame ? `**ID em game:** \`${idGame}\`` : null,
        numeroGame ? `**Numero em game:** \`${numeroGame}\`` : null,
    ].filter(Boolean).join('\n');

    const nextSteps = approved
        ? [
            'Seu acesso foi liberado e seus cargos foram atualizados.',
            'Caso seu apelido tenha sido ajustado, aguarde alguns instantes para o Discord atualizar.',
            'Procure a staff se algum cargo não aparecer corretamente.',
        ].join('\n')
        : [
            'Revise as informações enviadas e fale com a staff caso precise entender o motivo.',
            'Quando autorizado, você poderá abrir uma nova solicitação.',
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
            { name: 'Resumo', value: details, inline: false },
            { name: approved ? 'Próximos passos' : 'Orientação', value: nextSteps, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Vortex Recruitment System' });

    if (guild?.iconURL?.()) {
        embed.setThumbnail(guild.iconURL({ dynamic: true, size: 256 }));
    }

    try {
        await targetUser.send({ embeds: [embed] });
        return true;
    } catch (error) {
        await notifyDmFailure(
            client,
            targetUser.tag || targetUser.username || 'Usuario',
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

        // Bloqueio de Manutenção VORTEX
        if (conf.MAINTENANCE_MODE && !hasMasterPermission(member)) {
            const maintEmbed = new EmbedBuilder()
                .setTitle('⚠️ VORTEX | MANUTENÇÃO')
                .setColor('#FF0055')
                .setDescription('### 🛠️ Sistema em Manutenção\nO bot está passando por atualizações no momento para garantir a melhor experiência possível. Tente novamente mais tarde.')
                .addFields({ name: '🕒 Previsão', value: 'Em breve', inline: true })
                .setFooter({ text: 'Vortex Management System • Segurança & Estabilidade' })
                .setTimestamp();
            
            const maintBtn = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('Chamar Suporte').setStyle(ButtonStyle.Link).setURL('https://discord.gg/vortex'),
                new ButtonBuilder().setLabel('Status do Sistema').setStyle(ButtonStyle.Link).setURL('https://status.vortex.im').setDisabled(true)
            );

            if (interaction.isRepliable()) {
                return safeReply(interaction, { embeds: [maintEmbed], components: [maintBtn], ephemeral: true });
            }
            return;
        }

        // Slash Commands
        if (interaction.isChatInputCommand()) {
            const cmd = client.commands.get(interaction.commandName);
            if (cmd) {
                try {
                    if (!hasConfiguredCommandAccess(interaction, interaction.commandName)) {
                        return safeReply(interaction, {
                            content: '❌ Você não tem cargo liberado no /painel para usar este comando.',
                            ephemeral: true,
                        });
                    }

                    sendVortexLog(client, {
                        title: 'Comando Executado',
                        description: [
                            `**Comando:** /${interaction.commandName}`,
                            `**Usuario:** <@${user.id}> (${user.id})`,
                            `**Canal:** ${interaction.channel ? `<#${interaction.channel.id}>` : 'N/A'}`,
                            `**Servidor:** ${guild ? `${guild.name} (${guild.id})` : 'DM'}`,
                        ].join('\n'),
                        color: '#5865F2',
                        type: 'COMANDO',
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
                .setTitle('Solicitar ajuste de ponto');

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('closed_at')
                        .setLabel('HORARIO QUE FICOU EM GAME')
                        .setPlaceholder('Ex: 18:30 ou 27/04/2026 18:30')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('reason')
                        .setLabel('MOTIVO DE NAO FECHAR O PONTO')
                        .setPlaceholder('Explique por que nao conseguiu fechar o ponto')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                        .setMaxLength(900)
                )
            );

            return interaction.showModal(modal);
        }

        if (interaction.isModalSubmit() && interaction.customId === 'modal_ponto_adjust_request') {
            await interaction.deferReply({ ephemeral: true });
            const closedAtInput = interaction.fields.getTextInputValue('closed_at').trim();
            const reason = interaction.fields.getTextInputValue('reason').trim();
            const result = await createAdjustmentRequest(interaction, closedAtInput, reason);
            if (!result.ok) {
                return interaction.editReply({ content: `❌ ${result.message}` });
            }
            return interaction.editReply({
                content: `✅ Solicitação aberta em <#${result.channel.id}>. Aguarde a análise da administração.`,
            });
        }

        if (interaction.isButton() && (interaction.customId.startsWith('ponto_adjust_accept_') || interaction.customId.startsWith('ponto_adjust_reject_'))) {
            await interaction.deferReply({ ephemeral: true });
            const approved = interaction.customId.startsWith('ponto_adjust_accept_');
            const requestId = interaction.customId.replace(approved ? 'ponto_adjust_accept_' : 'ponto_adjust_reject_', '');
            const result = await decideAdjustment(interaction, requestId, approved);
            if (!result.ok) {
                return interaction.editReply({ content: `❌ ${result.message}` });
            }

            await updateStatusPanel(client, guild.id);
            await interaction.message.edit({ components: [] }).catch(() => {});
            await interaction.channel.send({
                content: [
                    approved ? '✅ Ajuste aprovado.' : '❌ Ajuste recusado.',
                    result.message,
                    `Analisado por: <@${interaction.user.id}>`,
                ].join('\n'),
            }).catch(() => {});

            return interaction.editReply({ content: result.message });
        }

        if (interaction.isButton() && (interaction.customId === 'ponto_open' || interaction.customId === 'ponto_close')) {
            const pointConfig = getPointConfig();
            if (interaction.channel.id !== pointConfig.actionChannelId) {
                return interaction.reply({
                    content: `Voce so pode bater ponto em <#${pointConfig.actionChannelId}>.`,
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            const opening = interaction.customId === 'ponto_open';
            const result = opening
                ? await openPoint(guild.id, user.id, {
                    userName: member?.displayName || user.username,
                    userMention: `<@${user.id}>`,
                    registro: user.id
                })
                : await closePoint(guild.id, user.id);

            if (result.action === 'opened') {
                await setOnlineChannelAccess(client, guild.id, user.id, true);
            }
            if (result.action === 'closed') {
                await setOnlineChannelAccess(client, guild.id, user.id, false);
            }

            await updateStatusPanel(client, guild.id);

            if (result.action === 'already_open') {
                return interaction.editReply({
                    content: '❌ Você já está online',
                });
            }

            if (result.action === 'already_closed') {
                return interaction.editReply({
                    content: '❌ Você não está em serviço.',
                });
            }

            sendVortexLog(client, {
                title: opening ? 'Ponto Aberto' : 'Ponto Fechado',
                description: opening
                    ? `<@${user.id}> abriu o ponto as ${formatDate(result.data.activePointStartedAt)}.`
                    : `<@${user.id}> fechou o ponto. Duracao: ${formatDuration(result.durationMs)}.`,
                color: opening ? '#57F287' : '#ED4245',
                type: 'PONTO',
                userId: user.id,
            }).catch(() => {});

            return interaction.editReply({
                content: opening
                    ? `✅ Você entrou em serviço às ${formatTime(result.data.activePointStartedAt)}.`
                    : `Ponto fechado. Tempo deste ponto: ${formatDuration(result.durationMs)}.`,
            });
        }

        if (interaction.isModalSubmit() && interaction.customId === 'modal_ausencia_request') {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ ephemeral: true });
            }

            const result = await createAbsence(interaction, {
                name: interaction.fields.getTextInputValue('name'),
                discordId: interaction.fields.getTextInputValue('discord_id'),
                reason: interaction.fields.getTextInputValue('reason'),
                periodInput: interaction.fields.getTextInputValue('period'),
            });

            if (!result.ok) {
                return safeEdit(interaction, { content: `❌ ${result.message}` });
            }

            return safeEdit(interaction, {
                content: [
                    '✅ Ausencia registrada com sucesso.',
                    `Cargo aplicado: <@&${result.absence.roleId}>`,
                    `Fim da ausencia: ${formatAbsenceDate(result.absence.endsAt)}`,
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
            if (interaction.isButton() && (interaction.customId === 'avisos_send_guild' || interaction.customId === 'avisos_send_global')) {
                return await avisos.handleButton(interaction);
            }
            if (interaction.isModalSubmit() && (interaction.customId === 'avisos_modal_guild' || interaction.customId === 'avisos_modal_global')) {
                return await avisos.handleModal(interaction);
            }
        }

        // Interações do Painel
        const painel = client.commands.get('painel');
        if (painel) {
            if (interaction.isButton() && (interaction.customId.startsWith('tab_') || ['config_set', 'config_avisos', 'toggle_maint', 'toggle_channel_logs', 'toggle_dm_logs', 'toggle_notice_dms', 'toggle_absence_end_message', 'test_notice', 'clear_point_user', 'correct_point_close', 'show_all_points', 'set_absence_role', 'change_absence_return'].includes(interaction.customId))) {
                return await painel.handleButton(interaction);
            }
            if (interaction.isStringSelectMenu() && interaction.customId === 'select_log') {
                return await painel.handleSelectMenu(interaction);
            }
            if (interaction.isChannelSelectMenu() && ['select_log', 'select_point_action_channel', 'select_point_adjust_category'].includes(interaction.customId)) {
                return await painel.handleSelectMenu(interaction);
            }
            if (interaction.isStringSelectMenu() && interaction.customId === 'select_command_permission_target') {
                return await painel.handleSelectMenu(interaction);
            }
            if (interaction.isRoleSelectMenu() && ['select_notice_mention_role', 'select_point_adjust_role', 'select_vortex_role_admin', 'select_vortex_role_medio', 'select_vortex_role_membro', 'select_command_permission_roles'].includes(interaction.customId)) {
                return await painel.handleSelectMenu(interaction);
            }
            if (interaction.isModalSubmit() && (interaction.customId === 'modal_clear_point_user' || interaction.customId === 'modal_correct_point_close' || interaction.customId === 'modal_absence_role' || interaction.customId === 'modal_absence_return')) {
                return await painel.handleModal(interaction);
            }
        }

        // Sistema de Recrutamento (/set)
        if (interaction.isButton() && interaction.customId === 'Vortex_set_start') {
            // Limitação de pedidos simultâneos removida conforme solicitado pelo usuário.

            const select = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('Vortex_select_tipo').setPlaceholder('Tipo de Set').addOptions([
                    { label: 'Morador', value: 'Morador', emoji: '🏠' },
                    { label: 'Membro', value: 'Membro', emoji: '👤' }
                ])
            );
            return interaction.reply({ content: 'Selecione o tipo de set:', components: [select], ephemeral: true });
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'Vortex_select_tipo') {
            const modal = new ModalBuilder().setCustomId(`Vortex_modal_${interaction.values[0]}`).setTitle(`Vortex | ${interaction.values[0]}`);
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id_game').setLabel('ID EM GAME').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nome_game').setLabel('NOME EM GAME').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('numero_game').setLabel('NÚMERO EM GAME').setStyle(TextInputStyle.Short).setRequired(true))
            );
            return interaction.showModal(modal);
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith('Vortex_modal_')) {
            await interaction.deferReply({ ephemeral: true });
            const tipo = interaction.customId.split('_')[2];
            const idGame = interaction.fields.getTextInputValue('id_game').trim();
            const nomeGame = interaction.fields.getTextInputValue('nome_game').trim();
            const numeroGame = interaction.fields.getTextInputValue('numero_game').trim();

            const canal = await guild.channels.create({
                name: `set-${user.username}`,
                parent: config.recruitmentCategoryId,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] },
                    { id: SUPERIOR_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ]
            });

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('📋 Nova Solicitação de Set')
                .setDescription(`Uma nova solicitação de set foi aberta por <@${user.id}>.\n\nA staff deve analisar os dados abaixo e aprovar ou reprovar o pedido.`)
                .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
                .addFields(
                    { name: '👤 Usuário', value: `<@${user.id}>`, inline: true },
                    { name: '🆔 Discord ID', value: `\`${user.id}\``, inline: true },
                    { name: '📌 Tipo de Set', value: `\`${tipo}\``, inline: true },
                    { name: '🎮 ID em Game', value: `\`${idGame}\``, inline: true },
                    { name: '🏷️ Nome em Game', value: `\`${nomeGame}\``, inline: true },
                    { name: '📱 Número em Game', value: `\`${numeroGame}\``, inline: true },
                    { name: '📊 Status', value: '`Aguardando análise`', inline: true }
                )
                .setFooter({ text: 'Vortex System • Aguardando análise da staff' })
                .setTimestamp();

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`Vortex_app_${user.id}`).setLabel('Aprovar').setEmoji('✅').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`Vortex_rej_${user.id}`).setLabel('Reprovar').setEmoji('❌').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('Vortex_del').setLabel('Apagar').setEmoji('🗑️').setStyle(ButtonStyle.Secondary)
            );

            await canal.send({ content: `<@${user.id}> aguarde a análise da staff.`, embeds: [embed], components: [buttons] });
            await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#57F287').setTitle('✅ Solicitação enviada com sucesso').setDescription(`Canal criado: <#${canal.id}>`)] });

            const pedidosAtivos = loadJSON(PEDIDOS_PATH);
            pedidosAtivos[user.id] = {
                channelId: canal.id,
                tipo,
                idGame,
                nomeGame,
                numeroGame,
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
                userId: user.id
            });
            return;
        }

        // Botões de Recrutamento (Aprovar/Reprovar/Apagar)
        if (interaction.isButton()) {
            if (interaction.customId === 'Vortex_del') {
                if (!hasStaffPermission(member)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
                return interaction.channel.delete().catch(() => {});
            }

            if (interaction.customId.startsWith('Vortex_app_') || interaction.customId.startsWith('Vortex_rej_')) {
                if (!hasStaffPermission(member)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
                await interaction.deferReply();
                
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
                let dmSent = false;
                
                if (isApp) {
                    const target = await guild.members.fetch(targetId).catch(() => null);
                    if (target) {
                        const PENDENTE_ID = '1449514118292967578';
                        const APROVADO_ID = '1201235607549124639';
                        await target.roles.remove(PENDENTE_ID).catch(() => {});
                        await target.roles.add(APROVADO_ID).catch(() => {});
                        if (nomeGame && idGame) {
                            await target.setNickname(`${nomeGame} | ${idGame}`).catch(() => {});
                        }
                    }
                    dmSent = await sendRecruitmentResultDm(client, targetUser || target?.user, {
                        approved: true,
                        guild,
                        staffUser: user,
                        tipo: requestType,
                        idGame,
                        nomeGame,
                        numeroGame,
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
                    .setTitle(isApp ? '✅ Solicitação Aprovada' : '❌ Solicitação Reprovada')
                    .setDescription([
                        `Usuário: <@${targetId}>`,
                        `Resultado: ${isApp ? 'Aprovado' : 'Reprovado'}`,
                        `Staff: <@${user.id}>`,
                        `DM enviada: ${dmSent ? 'sim' : 'não'}`,
                        '',
                        isApp
                            ? 'Canal mantido. Use o botão Apagar para remover.'
                            : 'Canal será deletado em 1 minuto.',
                    ].join('\n'))
                    .setTimestamp();

                await interaction.editReply({ embeds: [resultEmbed] });

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
                    description: `**Staff:** <@${user.id}>\n**Candidato:** <@${targetId}>\n**Resultado:** ${isApp ? 'Aprovado' : 'Reprovado'}\n**DM enviada:** ${dmSent ? 'sim' : 'nao'}`,
                    color: isApp ? '#57F287' : '#FF0055',
                    type: 'RECRUTAMENTO',
                    userId: user.id // Log para o staff que realizou a ação
                });

                if (!isApp) {
                    setTimeout(() => interaction.channel.delete().catch(() => {}), 60000);
                }
            }
        }
    }
};
