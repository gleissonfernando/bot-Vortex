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

// Arquivo para guardar os nomes originais
const NICKS_PATH = path.join(__dirname, '..', 'commands', 'nicks_originais.json');
const PEDIDOS_ATIVOS_PATH = path.join(__dirname, '..', 'commands', 'pedidos_ativos.json');

function loadJSON(filePath) {
    try {
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {}
    return {};
}

function saveJSON(filePath, data) {
    try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); } catch {}
}

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        const { client, guild, user, member } = interaction;

        // 1. Comandos Protegidos (/set e /painel)
        if (interaction.isChatInputCommand()) {
            if (['set', 'painel'].includes(interaction.commandName)) {
                if (!isRegisteredUser(interaction)) {
                    return denyNotRegistered(interaction);
                }
            }

            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            try {
                await command.execute(interaction);
            } catch (err) {
                console.error(err);
                await notifyError(client, err, `Execução do comando /${interaction.commandName}`);
            }
            return;
        }

        // 2. Botão Iniciar Recrutamento -> Abre Select Menu
        if (interaction.isButton() && interaction.customId === 'Vortex_set_start') {
            // Impedir múltiplos pedidos simultâneos
            const pedidosAtivos = loadJSON(PEDIDOS_ATIVOS_PATH);
            if (pedidosAtivos[user.id]) {
                return interaction.reply({ content: '❌ Você já possui uma solicitação em andamento.', ephemeral: true });
            }

            const select = new StringSelectMenuBuilder()
                .setCustomId('Vortex_select_tipo')
                .setPlaceholder('Selecione o tipo de set')
                .addOptions([
                    { label: 'Morador', value: 'Morador', emoji: '🏠' },
                    { label: 'Membro', value: 'Membro', emoji: '👤' }
                ]);

            const row = new ActionRowBuilder().addComponents(select);
            await interaction.reply({ content: 'Escolha o tipo de set que deseja solicitar:', components: [row], ephemeral: true });
            return;
        }

        // 3. Select Menu -> Abre Modal
        if (interaction.isStringSelectMenu() && interaction.customId === 'Vortex_select_tipo') {
            const tipo = interaction.values[0];
            const modal = new ModalBuilder()
                .setCustomId(`Vortex_modal_${tipo}`)
                .setTitle(`Formulário: ${tipo}`);

            const campos = [
                { id: 'nome_ic', label: 'NOME (IC)', placeholder: 'Seu nome no jogo' },
                { id: 'id_game', label: 'ID NO GAME', placeholder: 'Seu ID' },
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

        // 4. Envio do Modal -> Cria Canal e Envia Painel Staff
        if (interaction.isModalSubmit() && interaction.customId.startsWith('Vortex_modal_')) {
            const tipo = interaction.customId.replace('Vortex_modal_', '');
            const nomeIC = interaction.fields.getTextInputValue('nome_ic');
            const idGame = interaction.fields.getTextInputValue('id_game');
            const indicacao = interaction.fields.getTextInputValue('indicacao');
            const idade = interaction.fields.getTextInputValue('idade');

            await interaction.deferReply({ ephemeral: true });

            try {
                // Criar canal privado
                const canal = await guild.channels.create({
                    name: `set-${nomeIC}`.toLowerCase().replace(/\s+/g, '-'),
                    type: ChannelType.GuildText,
                    parent: config.recruitmentCategoryId,
                    permissionOverwrites: [
                        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
                    ]
                });

                // Salvar pedido ativo e nick original
                const pedidosAtivos = loadJSON(PEDIDOS_ATIVOS_PATH);
                pedidosAtivos[user.id] = canal.id;
                saveJSON(PEDIDOS_ATIVOS_PATH, pedidosAtivos);

                const nicks = loadJSON(NICKS_PATH);
                nicks[user.id] = member.nickname || user.username;
                saveJSON(NICKS_PATH, nicks);

                const embed = new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle('📋 Nova solicitação de set')
                    .setDescription(`👤 Usuário: <@${user.id}>\n🆔 Discord ID: \`${user.id}\`\n📌 Tipo: **${tipo}**`)
                    .addFields(
                        { name: '📝 Nome IC:', value: nomeIC, inline: true },
                        { name: '🎮 ID no game:', value: idGame, inline: true },
                        { name: '👥 Indicou:', value: indicacao, inline: true },
                        { name: '🎂 Idade:', value: idade, inline: true }
                    )
                    .setTimestamp();

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`Vortex_approve_${user.id}_${nomeIC}`).setLabel('Aprovar').setStyle(ButtonStyle.Success).setEmoji('✅'),
                    new ButtonBuilder().setCustomId(`Vortex_reject_${user.id}`).setLabel('Reprovar').setStyle(ButtonStyle.Danger).setEmoji('❌')
                );

                await canal.send({ content: `<@${user.id}> sua solicitação foi enviada! Aguarde a staff.`, embeds: [embed], components: [row] });
                
                // Log de solicitação
                await client.channels.cache.get(config.logsChannelId)?.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('📝 Nova Solicitação')
                        .setColor('#FEE75C')
                        .addFields(
                            { name: 'Usuário', value: `${user.tag} (${user.id})` },
                            { name: 'Tipo', value: tipo },
                            { name: 'Canal', value: `<#${canal.id}>` }
                        )
                        .setTimestamp()]
                });

                await interaction.editReply({ content: `✅ Sua solicitação foi enviada! Veja aqui: <#${canal.id}>` });
            } catch (err) {
                console.error(err);
                await interaction.editReply({ content: '❌ Erro ao criar canal de solicitação. Verifique as permissões do bot.' });
            }
            return;
        }

        // 5. Aprovação / Reprovação
        if (interaction.isButton() && (interaction.customId.startsWith('Vortex_approve_') || interaction.customId.startsWith('Vortex_reject_'))) {
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
                    } catch (err) { console.error('Erro ao aplicar cargos/nick:', err); }
                }
                await interaction.channel.send({ content: `✅ Aprovado por <@${user.id}>` });
            } else {
                if (targetMember) {
                    try {
                        // Reprovado: Mantém cargo pendente, não adiciona aprovado, restaura nick
                        if (originalNick === targetMember.user.username) {
                            await targetMember.setNickname(null);
                        } else {
                            await targetMember.setNickname(originalNick);
                        }
                    } catch (err) { console.error('Erro ao restaurar nick:', err); }
                }
                await interaction.channel.send({ content: `❌ Reprovado por <@${user.id}>` });
            }

            // Logs detalhados
            const logEmbed = new EmbedBuilder()
                .setTitle(isApprove ? '✅ Set Aprovado' : '❌ Set Reprovado')
                .setColor(isApprove ? '#57F287' : '#ED4245')
                .addFields(
                    { name: 'Usuário', value: `<@${targetId}> (\`${targetId}\`)`, inline: true },
                    { name: 'Staff', value: `<@${user.id}>`, inline: true },
                    { name: 'Tipo', value: isApprove ? 'Aprovado' : 'Reprovado', inline: true },
                    { name: 'Cargos Alterados', value: isApprove ? `Removido: <@&${config.pendingRoleId}>\nAdicionado: <@&${config.approvedRoleId}>` : 'Nenhum', inline: false },
                    { name: 'Canal', value: `#${interaction.channel.name}`, inline: true },
                    { name: 'Data/Hora', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                )
                .setTimestamp();

            await client.channels.cache.get(config.logsChannelId)?.send({ embeds: [logEmbed] });

            // Limpar dados e fechar canal após alguns segundos
            const pedidosAtivos = loadJSON(PEDIDOS_ATIVOS_PATH);
            delete pedidosAtivos[targetId];
            saveJSON(PEDIDOS_ATIVOS_PATH, pedidosAtivos);
            delete nicks[targetId];
            saveJSON(NICKS_PATH, nicks);

            setTimeout(() => interaction.channel.delete().catch(() => {}), 10000);
            return;
        }

        // Encaminhar outras interações para o painel se necessário
        const painelCommand = client.commands.get('painel');
        if (interaction.isButton() && painelCommand?.handleButton) await painelCommand.handleButton(interaction);
        if (interaction.isModalSubmit() && painelCommand?.handleModal) await painelCommand.handleModal(interaction);
        if (interaction.isStringSelectMenu() && painelCommand?.handleSelectMenu) await painelCommand.handleSelectMenu(interaction);
    }
};
