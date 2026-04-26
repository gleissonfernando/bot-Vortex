const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ChannelType,
    PermissionFlagsBits
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const { isGerencia, denyNotRegistered, isRegisteredUser } = require('../utils/permissions');
const { sendStaffLog, notifyError } = require('../utils/notifications');

// Arquivos de persistência
const NICKS_PATH = path.join(__dirname, '..', 'commands', 'nicks_originais.json');
const PEDIDOS_ATIVOS_PATH = path.join(__dirname, '..', 'commands', 'pedidos_ativos.json');
const STATS_PATH = path.join(__dirname, '..', 'commands', 'stats.json');

function loadJSON(filePath) {
    try {
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {}
    return {};
}

function saveJSON(filePath, data) {
    try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); } catch {}
}

function updateStats(type) {
    const stats = loadJSON(STATS_PATH);
    if (!stats.pendentes) stats.pendentes = 0;
    if (!stats.aprovados) stats.aprovados = 0;
    if (!stats.recusados) stats.recusados = 0;

    if (type === 'novo') stats.pendentes++;
    if (type === 'aprovado') {
        stats.aprovados++;
        if (stats.pendentes > 0) stats.pendentes--;
    }
    if (type === 'recusado') {
        stats.recusados++;
        if (stats.pendentes > 0) stats.pendentes--;
    }
    saveJSON(STATS_PATH, stats);
}

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        const { client, guild, user, member } = interaction;

        // 1. Comandos Protegidos
        if (interaction.isChatInputCommand()) {
            if (['set', 'painel'].includes(interaction.commandName)) {
                if (!isRegisteredUser(interaction)) {
                    return denyNotRegistered(interaction);
                }
            }
            const command = client.commands.get(interaction.commandName);
            if (!command) return;
            try { await command.execute(interaction); } catch (err) { console.error(err); }
            return;
        }

        // 2. Iniciar Recrutamento
        if (interaction.isButton() && interaction.customId === 'Vortex_set_start') {
            const pedidosAtivos = loadJSON(PEDIDOS_ATIVOS_PATH);
            if (pedidosAtivos[user.id]) {
                return interaction.reply({ content: '❌ Você já possui uma solicitação em andamento.', ephemeral: true });
            }
            const select = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('Vortex_select_tipo')
                    .setPlaceholder('Selecione o tipo de set')
                    .addOptions([
                        { label: 'Morador', value: 'Morador', emoji: '🏠' },
                        { label: 'Membro', value: 'Membro', emoji: '👤' }
                    ])
            );
            await interaction.reply({ content: 'Escolha o tipo de set que deseja solicitar:', components: [select], ephemeral: true });
            return;
        }

        // 3. Select Menu
        if (interaction.isStringSelectMenu() && interaction.customId === 'Vortex_select_tipo') {
            const tipo = interaction.values[0];
            const modal = new ModalBuilder().setCustomId(`Vortex_modal_${tipo}`).setTitle(`Formulário: ${tipo}`);
            const campos = [
                { id: 'nome_ic', label: 'NOME (IC)', placeholder: 'Seu nome no jogo' },
                { id: 'id_game', label: 'ID NO GAME', placeholder: 'Seu ID' },
                { id: 'steam_hex', label: 'STEAM HEX', placeholder: 'Ex: steam:110000100000000' },
                { id: 'indicacao', label: 'QUEM TE INDICOU?', placeholder: 'Nick de quem te indicou' },
                { id: 'idade', label: 'SUA IDADE', placeholder: 'Sua idade real' }
            ];
            campos.forEach(c => {
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId(c.id).setLabel(c.label).setPlaceholder(c.placeholder).setStyle(TextInputStyle.Short).setRequired(true)
                ));
            });
            await interaction.showModal(modal);
            return;
        }

        // 4. Envio do Modal
        if (interaction.isModalSubmit() && interaction.customId.startsWith('Vortex_modal_')) {
            const tipo = interaction.customId.replace('Vortex_modal_', '');
            const nomeIC = interaction.fields.getTextInputValue('nome_ic');
            const idGame = interaction.fields.getTextInputValue('id_game');
            const steamHex = interaction.fields.getTextInputValue('steam_hex');
            const indicacao = interaction.fields.getTextInputValue('indicacao');
            const idade = interaction.fields.getTextInputValue('idade');

            await interaction.deferReply({ ephemeral: true });

            try {
                const canal = await guild.channels.create({
                    name: `set-${nomeIC}`.toLowerCase().replace(/\s+/g, '-'),
                    type: ChannelType.GuildText,
                    parent: config.recruitmentCategoryId,
                    permissionOverwrites: [
                        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
                    ]
                });

                const pedidosAtivos = loadJSON(PEDIDOS_ATIVOS_PATH);
                pedidosAtivos[user.id] = canal.id;
                saveJSON(PEDIDOS_ATIVOS_PATH, pedidosAtivos);

                const nicks = loadJSON(NICKS_PATH);
                nicks[user.id] = member.nickname || user.username;
                saveJSON(NICKS_PATH, nicks);
                
                updateStats('novo');

                const embed = new EmbedBuilder()
                    .setColor('#2F3136')
                    .setTitle('📋 Nova solicitação de set')
                    .setDescription(`👤 **Usuário:** <@${user.id}>\n🆔 **Discord ID:** \`${user.id}\`\n📌 **Tipo:** \`${tipo}\``)
                    .addFields(
                        { name: '📝 Nome IC:', value: `\`${nomeIC}\``, inline: true },
                        { name: '🎮 ID no game:', value: `\`${idGame}\``, inline: true },
                        { name: '🔗 Steam Hex:', value: `\`${steamHex}\``, inline: true },
                        { name: '👥 Indicou:', value: `\`${indicacao}\``, inline: true },
                        { name: '🎂 Idade:', value: `\`${idade}\``, inline: true }
                    )
                    .setFooter({ text: `Hoje às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`Vortex_approve_${user.id}_${nomeIC}`).setLabel('Aprovar').setStyle(ButtonStyle.Success).setEmoji('✅'),
                    new ButtonBuilder().setCustomId(`Vortex_reject_${user.id}`).setLabel('Reprovar').setStyle(ButtonStyle.Danger).setEmoji('❌'),
                    new ButtonBuilder().setCustomId(`Vortex_delete_channel`).setLabel('Apagar Canal').setStyle(ButtonStyle.Secondary).setEmoji('🗑️')
                );

                await canal.send({ content: `<@${user.id}> sua solicitação foi enviada! Aguarde a staff.`, embeds: [embed], components: [row] });
                await interaction.editReply({ content: `✅ Sua solicitação foi enviada! Veja aqui: <#${canal.id}>` });
            } catch (err) { console.error(err); }
            return;
        }

        // 5. Botões
        if (interaction.isButton()) {
            if (interaction.customId === 'Vortex_delete_channel') {
                if (!member.roles.cache.has('1497703127074345040')) {
                    return interaction.reply({ content: '❌ Apenas a Gerência Superior pode apagar este canal manualmente.', ephemeral: true });
                }
                await interaction.reply({ content: '🗑️ Apagando canal em 3 segundos...' });
                setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
                return;
            }

            if (interaction.customId.startsWith('Vortex_approve_') || interaction.customId.startsWith('Vortex_reject_')) {
                if (!isGerencia(interaction)) {
                    return interaction.reply({ content: '❌ Você não tem permissão para aprovar/reprovar.', ephemeral: true });
                }

                const isApprove = interaction.customId.startsWith('Vortex_approve_');
                const parts = interaction.customId.split('_');
                const targetId = parts[2];
                const targetMember = await guild.members.fetch(targetId).catch(() => null);

                await interaction.deferUpdate();
                const nicks = loadJSON(NICKS_PATH);
                const originalNick = nicks[targetId] || (targetMember ? targetMember.user.username : 'N/A');

                if (isApprove) {
                    const nomeIC = parts[3];
                    if (targetMember) {
                        try {
                            await targetMember.roles.remove(config.pendingRoleId);
                            await targetMember.roles.add(config.approvedRoleId);
                            await targetMember.setNickname(nomeIC);
                            
                            const approveEmbed = new EmbedBuilder()
                                .setColor('#57F287')
                                .setTitle('✅ Solicitação Aprovada!')
                                .setDescription(`Olá, **${targetMember.user.username}**!\n\nSua solicitação de set na **Vortex** foi aprovada por <@${user.id}>.\n\nSeus cargos foram aplicados e seu nickname foi alterado para \`${nomeIC}\`.\n\nSeja bem-vindo(a)!`)
                                .setThumbnail(guild.iconURL({ dynamic: true }))
                                .setTimestamp();
                            await targetMember.send({ embeds: [approveEmbed] }).catch(() => {});
                        } catch (err) {}
                    }
                    updateStats('aprovado');
                    await interaction.channel.send({ content: `✅ Aprovado por <@${user.id}>` });
                } else {
                    if (targetMember) {
                        try {
                            if (originalNick === targetMember.user.username) await targetMember.setNickname(null);
                            else await targetMember.setNickname(originalNick);

                            const rejectEmbed = new EmbedBuilder()
                                .setColor('#ED4245')
                                .setTitle('❌ Solicitação Reprovada')
                                .setDescription(`Olá, **${targetMember.user.username}**.\n\nInfelizmente sua solicitação de set na **Vortex** foi reprovada após análise da staff.`)
                                .setThumbnail(guild.iconURL({ dynamic: true }))
                                .setTimestamp();
                            await targetMember.send({ embeds: [rejectEmbed] }).catch(() => {});
                        } catch (err) {}
                    }
                    updateStats('recusado');
                    await interaction.channel.send({ content: `❌ Reprovado por <@${user.id}>` });
                }

                const logEmbed = new EmbedBuilder()
                    .setTitle(isApprove ? '✅ Set Aprovado' : '❌ Set Reprovado')
                    .setColor(isApprove ? '#57F287' : '#ED4245')
                    .addFields(
                        { name: 'Usuário', value: `<@${targetId}>`, inline: true },
                        { name: 'Staff', value: `<@${user.id}>`, inline: true },
                        { name: 'Canal', value: `#${interaction.channel.name}`, inline: true }
                    ).setTimestamp();
                await client.channels.cache.get(config.logsChannelId)?.send({ embeds: [logEmbed] });

                const pedidosAtivos = loadJSON(PEDIDOS_ATIVOS_PATH);
                delete pedidosAtivos[targetId];
                saveJSON(PEDIDOS_ATIVOS_PATH, pedidosAtivos);
                delete nicks[targetId];
                saveJSON(NICKS_PATH, nicks);

                setTimeout(() => interaction.channel.delete().catch(() => {}), 10000);
                return;
            }
        }

        const painelCommand = client.commands.get('painel');
        if (interaction.isButton() && painelCommand?.handleButton) await painelCommand.handleButton(interaction);
        if (interaction.isModalSubmit() && painelCommand?.handleModal) await painelCommand.handleModal(interaction);
        if (interaction.isStringSelectMenu() && painelCommand?.handleSelectMenu) await painelCommand.handleSelectMenu(interaction);
    }
};
