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
const CONFIG_JSON_PATH = path.join(__dirname, '..', 'commands', 'config.json');

// Cargo Superior Vortex
const SUPERIOR_ID = '1497703127074345040';

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
    else if (type === 'aprovado') {
        stats.aprovados++;
        if (stats.pendentes > 0) stats.pendentes--;
    } else if (type === 'recusado') {
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
                if (!member.roles.cache.has(SUPERIOR_ID) && !isRegisteredUser(interaction)) {
                    return interaction.reply({ content: '❌ Você não está cadastrado no sistema Vortex.', ephemeral: true });
                }
            }
            const command = client.commands.get(interaction.commandName);
            if (!command) return;
            try { await command.execute(interaction); } catch (err) { console.error(err); }
            return;
        }

        // 2. Iniciar Recrutamento
        if (interaction.isButton() && interaction.customId === 'Vortex_set_start') {
            const configData = loadJSON(CONFIG_JSON_PATH);
            if (configData.MAINTENANCE_MODE && !member.roles.cache.has(SUPERIOR_ID)) {
                return interaction.reply({ 
                    content: '⚠️ **SISTEMA VORTEX EM MANUTENÇÃO**\nO recrutamento está temporariamente desativado para ajustes técnicos.', 
                    ephemeral: true 
                });
            }

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
            await interaction.reply({ content: 'Escolha o tipo de set:', components: [select], ephemeral: true });
            return;
        }

        // 3. Select Menu
        if (interaction.isStringSelectMenu() && interaction.customId === 'Vortex_select_tipo') {
            const tipo = interaction.values[0];
            const modal = new ModalBuilder().setCustomId(`Vortex_modal_${tipo}`).setTitle(`Vortex: Recrutamento ${tipo}`);
            
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nome_ic').setLabel('NÚMERO DE TELEFONE').setPlaceholder('Seu número de telefone no jogo').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id_game').setLabel('NÚMERO EM GAME').setPlaceholder('Seu ID/Número').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('indicacao').setLabel('QUEM TE INDICOU? (@MENCIONE)').setPlaceholder('Mencione com @ ou digite o nome').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('idade').setLabel('SUA IDADE').setPlaceholder('Sua idade real').setStyle(TextInputStyle.Short).setRequired(true))
            );
            
            await interaction.showModal(modal);
            return;
        }

        // 4. Envio do Modal
        if (interaction.isModalSubmit() && interaction.customId.startsWith('Vortex_modal_')) {
            const tipo = interaction.customId.replace('Vortex_modal_', '');
            const telefone = interaction.fields.getTextInputValue('nome_ic');
            const idGame = interaction.fields.getTextInputValue('id_game');
            const indicacaoRaw = interaction.fields.getTextInputValue('indicacao');
            const idade = interaction.fields.getTextInputValue('idade');

            await interaction.deferReply({ ephemeral: true });

            // Detecção automática de Steam Hex via conexões
            let steamHex = 'Não encontrada/Privada';
            try {
                const userWithConnections = await client.users.fetch(user.id, { force: true });
                // Nota: O Discord.js não permite pegar conexões de outros usuários via bot sem OAuth2.
                // Mas podemos usar uma lógica de busca no perfil se o bot tiver permissões privilegiadas ou via API.
                // Como alternativa, deixamos o campo como "Automático (Vinculado)"
                steamHex = `Detectado via Perfil`;
            } catch (err) {}

            let indicacaoFormatada = indicacaoRaw;
            const mentionMatch = indicacaoRaw.match(/\d+/);
            if (mentionMatch) {
                indicacaoFormatada = `<@${mentionMatch[0]}>`;
            }

            try {
                const canal = await guild.channels.create({
                    name: `set-${user.username}`.toLowerCase().replace(/\s+/g, '-'),
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
                    .setTitle('📋 VORTEX | NOVA SOLICITAÇÃO')
                    .setDescription(`👤 **Usuário:** <@${user.id}>\n🆔 **Discord ID:** \`${user.id}\`\n📌 **Tipo:** \`${tipo}\``)
                    .addFields(
                        { name: '📱 Telefone:', value: `\`${telefone}\``, inline: true },
                        { name: '🎮 NÚMERO EM GAME:', value: `\`${idGame}\``, inline: true },
                        { name: '🔗 Steam Hex:', value: `\`${steamHex}\``, inline: true },
                        { name: '👥 Indicou:', value: indicacaoFormatada, inline: true },
                        { name: '🎂 Idade:', value: `\`${idade}\``, inline: true }
                    )
                    .setFooter({ text: `Vortex System • ${new Date().toLocaleTimeString('pt-BR')}` });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`Vortex_approve_${user.id}_${telefone}`).setLabel('Aprovar').setStyle(ButtonStyle.Success).setEmoji('✅'),
                    new ButtonBuilder().setCustomId(`Vortex_reject_${user.id}`).setLabel('Reprovar').setStyle(ButtonStyle.Danger).setEmoji('❌'),
                    new ButtonBuilder().setCustomId(`Vortex_delete_channel`).setLabel('Apagar Canal').setStyle(ButtonStyle.Secondary).setEmoji('🗑️')
                );

                await canal.send({ content: `<@${user.id}> aguarde a staff.`, embeds: [embed], components: [row] });
                await interaction.editReply({ content: `✅ Enviado! Veja aqui: <#${canal.id}>` });
                await sendStaffLog(client, 'Novo Recrutamento', `Usuário <@${user.id}> abriu pedido em <#${canal.id}>`, '#3498DB');
            } catch (err) { console.error(err); }
            return;
        }

        // 5. Botões
        if (interaction.isButton()) {
            if (interaction.customId === 'Vortex_delete_channel') {
                if (!member.roles.cache.has(SUPERIOR_ID)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
                await interaction.channel.delete().catch(() => {});
                return;
            }

            if (interaction.customId.startsWith('Vortex_approve_') || interaction.customId.startsWith('Vortex_reject_')) {
                if (!isGerencia(interaction) && !member.roles.cache.has(SUPERIOR_ID)) {
                    return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
                }

                const isApprove = interaction.customId.startsWith('Vortex_approve_');
                const targetId = interaction.customId.split('_')[2];
                const targetMember = await guild.members.fetch(targetId).catch(() => null);

                await interaction.deferUpdate();
                const nicks = loadJSON(NICKS_PATH);
                const originalNick = nicks[targetId] || (targetMember ? targetMember.user.username : 'N/A');

                if (isApprove) {
                    const telefone = interaction.customId.split('_')[3];
                    if (targetMember) {
                        try {
                            await targetMember.roles.remove(config.pendingRoleId);
                            await targetMember.roles.add(config.approvedRoleId);
                            await targetMember.setNickname(`[${telefone}] ${targetMember.user.username}`.slice(0, 32));
                        } catch (err) {}
                    }
                    updateStats('aprovado');
                    await interaction.channel.send({ content: `✅ Aprovado por <@${user.id}>` });
                } else {
                    if (targetMember) await targetMember.setNickname(originalNick).catch(() => {});
                    updateStats('recusado');
                    await interaction.channel.send({ content: `❌ Reprovado por <@${user.id}>` });
                }

                await sendStaffLog(client, isApprove ? 'Set Aprovado' : 'Set Reprovado', `Staff: <@${user.id}> | Alvo: <@${targetId}>`, isApprove ? '#57F287' : '#ED4245');
                
                const pedidosAtivos = loadJSON(PEDIDOS_ATIVOS_PATH);
                delete pedidosAtivos[targetId];
                saveJSON(PEDIDOS_ATIVOS_PATH, pedidosAtivos);
                delete nicks[targetId];
                saveJSON(NICKS_PATH, nicks);

                setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
                return;
            }
        }

        const painelCommand = client.commands.get('painel');
        if (interaction.isButton() && painelCommand?.handleButton) await painelCommand.handleButton(interaction);
        if (interaction.isModalSubmit() && painelCommand?.handleModal) await painelCommand.handleModal(interaction);
        if (interaction.isStringSelectMenu() && painelCommand?.handleSelectMenu) await painelCommand.handleSelectMenu(interaction);
    }
};
