const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    ChannelType
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { isGerencia } = require('../utils/permissions');
const { sendStaffLog, notifyError, sendUpdateLog } = require('../utils/notifications');
const { isMaintenanceMode, isStaffMember } = require('../utils/maintenanceManager');
// Caminho da config do painel
const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
// Arquivo para guardar os nomes originais dos candidatos antes do recrutamento
const NICKS_PATH = path.join(__dirname, '..', 'commands', 'nicks_originais.json');

function loadNicksOriginais() {
    try {
        if (fs.existsSync(NICKS_PATH)) return JSON.parse(fs.readFileSync(NICKS_PATH, 'utf8'));
    } catch {}
    return {};
}

function saveNicksOriginais(data) {
    try { fs.writeFileSync(NICKS_PATH, JSON.stringify(data, null, 2)); } catch {}
}

function salvarNickOriginal(membroId, nick) {
    const data = loadNicksOriginais();
    data[membroId] = nick;
    saveNicksOriginais(data);
}

function getNickOriginal(membroId) {
    const data = loadNicksOriginais();
    return data[membroId] || null;
}

function removerNickOriginal(membroId) {
    const data = loadNicksOriginais();
    delete data[membroId];
    saveNicksOriginais(data);
};

function loadPanelConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        }
    } catch (err) {
        console.error('Erro ao carregar config do painel:', err);
    }
    return {};
}

const CANAIS_AUTORIZADOS = [
    '1497749423407501312',
    '1497704725242581002',
    '1497685937868505129'
];

// ─── Embed de Manutenção exibida para usuários comuns ────────────────────────
function buildMaintenanceEmbed() {
    return new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🔧  Bot em Manutenção')
        .setDescription(
            '### ⚠️ O bot está em manutenção no momento!\n\n' +
            '> Estamos realizando melhorias e atualizações para oferecer uma experiência ainda melhor.\n\n' +
            '**Por favor, aguarde** enquanto a equipe conclui os trabalhos.\n\n' +
            'Se precisar de ajuda urgente, clique no botão abaixo para chamar um suporte.'
        )
        .setThumbnail('https://cdn-icons-png.flaticon.com/512/2920/2920349.png')
        .setFooter({ text: 'Size Management System • Manutenção' })
        .setTimestamp();
}

function buildMaintenanceRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('manutencao_suporte_btn')
            .setLabel('🆘 Chamar Suporte')
            .setStyle(ButtonStyle.Danger)
    );
}

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        const { client } = interaction;
        const panelConfig = loadPanelConfig();

        // IDs dinâmicos do painel (com fallbacks para os antigos se necessário)
        const CATEGORIA_ID       = panelConfig.CATEGORY_ID || '1497388763054342244';
        const CARGO_APROVADO     = panelConfig.CARGO_MORADOR_ID || '1490151003864043570';
        const CARGO_FORMULARIO   = '1497394597746315355';
        const CARGO_TESTE_ID     = '1497405005802635374';

        // ─── Botão: Chamar Suporte (Manutenção) ──────────────────────────────
        // Este botão é tratado ANTES da verificação de manutenção para funcionar em modo manutenção
        if (interaction.isButton() && interaction.customId === 'manutencao_suporte_btn') {
            await interaction.deferReply({ ephemeral: true });

             const { STAFF_ROLE_IDS } = require('../utils/maintenanceManager');
            // Notifica membros do servidor com cargo de staff sobre o pedido de suporte
            let enviados = 0;
            try {
                const allMembers = await interaction.guild.members.fetch();
                const staffMembers = allMembers.filter(m =>
                    !m.user.bot && STAFF_ROLE_IDS.some(rid => m.roles.cache.has(rid))
                );
                for (const [, staffMember] of staffMembers) {
                    try {
                        const embed = new EmbedBuilder()
                            .setColor('#FF6B00')
                            .setTitle('\uD83C\uDD98 Usu\u00e1rio Solicitando Suporte')
                            .setDescription(`O usu\u00e1rio <@${interaction.user.id}> est\u00e1 solicitando suporte durante o modo de manuten\u00e7\u00e3o.`)
                            .addFields(
                                { name: 'Usu\u00e1rio', value: `${interaction.user.tag} (\`${interaction.user.id}\`)`, inline: true },
                                { name: 'Servidor', value: interaction.guild?.name || 'N/A', inline: true }
                            )
                            .setTimestamp();
                        await staffMember.send({ embeds: [embed] });
                        enviados++;
                    } catch {}
                }
            } catch {}
            await interaction.editReply({
                content: `✅ **Suporte solicitado!** Nossa equipe foi notificada e entrará em contato em breve. Aguarde!`
            });
            return;
        }

        // ─── Verificação de Manutenção ────────────────────────────────────
        // Bloqueia TODAS as interações de usuários que não possuem cargo de staff
        if (isMaintenanceMode() && !isStaffMember(interaction.member)) {
            const isSlashCommand = interaction.isChatInputCommand();
            const isButton       = interaction.isButton();
            const isModal        = interaction.isModalSubmit();
            const isSelect       = interaction.isStringSelectMenu();
            if (isSlashCommand || isButton || isModal || isSelect) {
                try {
                    const embed = buildMaintenanceEmbed();
                    const row   = buildMaintenanceRow();
                    if (interaction.deferred || interaction.replied) {
                        await interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });
                    } else {
                        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
                    }
                } catch (err) {
                    console.error('[Maintenance] Erro ao enviar embed de manutenção:', err);
                }
                return;
            }
        }

        // ─── Logs de Comandos ────────────────────────────────────────────────
        if (interaction.isChatInputCommand()) {
            const restrictedCommands = new Set(['set', 'painel']);

            if (restrictedCommands.has(interaction.commandName) && !CANAIS_AUTORIZADOS.includes(interaction.channelId)) {
                await interaction.reply({
                    content: `❌ Este comando só pode ser utilizado nos canais de comandos autorizados: <#${CANAIS_AUTORIZADOS[0]}> ou <#${CANAIS_AUTORIZADOS[1]}>.`,
                    ephemeral: true
                });
                return;
            }

            // Log de uso de comando
            await sendStaffLog(client, '⌨️ Comando Utilizado', `O comando \`/${interaction.commandName}\` foi executado por <@${interaction.user.id}> no canal <#${interaction.channelId}>.`);

            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            try {
                await command.execute(interaction);
            } catch (err) {
                console.error(err);
                await notifyError(client, err, `Execução do comando /${interaction.commandName}`);
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp({ content: '❌ Ocorreu um erro ao executar este comando.', ephemeral: true });
                } else {
                    await interaction.reply({ content: '❌ Ocorreu um erro ao executar este comando.', ephemeral: true });
                }
            }
            return;
        }

        const painelCommand = client.commands.get('painel');

        // ─── Lida com Botões do Painel ────────────────────────────────────────
        if (interaction.isButton() && painelCommand && typeof painelCommand.handleButton === 'function') {
            const painelButtonIds = [
                'tab_stats', 'tab_roles', 'tab_config', 'tab_manutencao', 'tab_mensagens',
                'add_role_btn', 'list_roles_btn', 'remove_role_modal_btn',
                'edit_staff_channel', 'edit_cargo_morador', 'edit_cargo_membro', 'edit_category',
                'toggle_manutencao_btn', 'alert_manutencao_btn',
                'send_msg_canal_btn', 'test_bomdia_btn', 'test_todoMundoOn_btn',
                'toggle_scheduler_btn', 'add_auto_msg_btn', 'remove_auto_msg_btn',
                'test_system_btn'
            ];

            if (painelButtonIds.includes(interaction.customId)) {
                try {
                    await painelCommand.handleButton(interaction);
                } catch (err) {
                    await notifyError(client, err, 'Botão do Painel');
                }
                return;
            }
        }

        // ─── Lida com Modais do Painel ────────────────────────────────────────
        if (interaction.isModalSubmit() && painelCommand && typeof painelCommand.handleModal === 'function') {
            const painelModalIds = [
                'modal_add_role', 'modal_remove_role',
                'modal_edit_staff_channel', 'modal_edit_cargo_morador',
                'modal_edit_cargo_membro', 'modal_edit_category',
                'modal_alert_devs', 'modal_send_msg_canal',
                'modal_add_auto_msg'
            ];
            if (painelModalIds.includes(interaction.customId)) {
                try {
                    await painelCommand.handleModal(interaction);
                } catch (err) {
                    await notifyError(client, err, 'Modal do Painel');
                }
                return;
            }
        }

        // ─── Lida com Select Menus do Painel ──────────────────────────────────
        if (interaction.isStringSelectMenu() && painelCommand && typeof painelCommand.handleSelectMenu === 'function') {
            if (interaction.customId === 'remove_role_select' || interaction.customId === 'remove_auto_msg_select') {
                try {
                    await painelCommand.handleSelectMenu(interaction);
                } catch (err) {
                    await notifyError(client, err, 'Select Menu do Painel');
                }
                return;
            }
        }

        // ─── Botão: Iniciar Recrutamento ──────────────────────────────────────
        if (interaction.isButton() && interaction.customId === 'size_set_start') {
            await sendStaffLog(client, '📝 Formulário Iniciado', `O usuário <@${interaction.user.id}> iniciou o preenchimento do formulário.`, '#FEE75C');

            const modal = new ModalBuilder()
                .setCustomId('size_modal_form')
                .setTitle('🎮  Formulário: Morador');

            const fields = [
                { id: 'campo_nome', label: 'NOME (IC)', placeholder: 'Ex: Rafael' },
                { id: 'campo_id', label: 'ID NO GAME', placeholder: 'Ex: 222' },
                { id: 'campo_indicacao', label: 'QUEM TE INDICOU?', placeholder: 'Nick de quem te indicou' },
                { id: 'campo_idade', label: 'SUA IDADE', placeholder: 'Ex: 18' }
            ];

            fields.forEach(f => {
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setPlaceholder(f.placeholder).setStyle(TextInputStyle.Short).setRequired(true)
                ));
            });

            await interaction.showModal(modal);
            return;
        }

        // ─── Modal: Envio de Respostas ────────────────────────────────────────
        if (interaction.isModalSubmit() && interaction.customId === 'size_modal_form') {
            try {
                const nome      = interaction.fields.getTextInputValue('campo_nome');
                const id        = interaction.fields.getTextInputValue('campo_id');
                const novoNick  = `${id} ${nome}`;
                const membro    = interaction.member;

                await interaction.deferReply({ ephemeral: true });

                await sendStaffLog(client, '📩 Ficha Enviada', `O usuário <@${membro.id}> enviou a ficha.\n**Nick:** ${novoNick}`, '#57F287');
                // Salva o nome original ANTES de alterar
                salvarNickOriginal(membro.id, membro.nickname || membro.user.username);
                try { await membro.setNickname(novoNick); } catch {}
                try { await membro.roles.add(CARGO_FORMULARIO); } catch {}

                const canal = await interaction.guild.channels.create({
                    name: `📋・${id}-${nome}`.toLowerCase(),
                    type: ChannelType.GuildText,
                    parent: CATEGORIA_ID,
                    permissionOverwrites: [
                        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: membro.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
                    ]
                });

                const embedFicha = new EmbedBuilder()
                    .setColor('#5865F2')
                    .setAuthor({ name: 'Size — Ficha de Recrutamento', iconURL: interaction.guild.iconURL({ dynamic: true }) })
                    .setTitle(`📋  Ficha de ${novoNick}`)
                    .setDescription(`> Ficha enviada por <@${membro.id}>. Analise e tome uma decisão abaixo.`)
                    .addFields(
                        { name: '👤 Nome (IC)',     value: `\`${nome}\``,      inline: true },
                        { name: '🎮 ID no Game',    value: `\`${id}\``,        inline: true },
                        { name: '🆔 Discord',       value: `<@${membro.id}>`,  inline: true }
                    )
                    .setFooter({ text: 'Size Recrutamento' })
                    .setTimestamp();

                const rowDecisao = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`aprovar_${membro.id}`).setLabel('✅  Aprovar').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`reprovar_${membro.id}`).setLabel('❌  Reprovar').setStyle(ButtonStyle.Danger)
                );

                await canal.send({ embeds: [embedFicha], components: [rowDecisao] });
                await interaction.editReply({ content: `✅ Sua ficha foi enviada com sucesso! Aguarde a análise da staff.` });
            } catch (err) {
                await notifyError(client, err, 'Processamento de Formulário');
            }
            return;
        }

        // ─── Botões: Aprovar / Reprovar ───────────────────────────────────────
        if (interaction.isButton() && (interaction.customId.startsWith('aprovar_') || interaction.customId.startsWith('reprovar_'))) {
            try {
                if (!isGerencia(interaction)) {
                    await interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
                    return;
                }

                const action = interaction.customId.startsWith('aprovar_') ? 'Aprovada' : 'Reprovada';
                const color = action === 'Aprovada' ? '#57F287' : '#ED4245';
                const membroId = interaction.customId.split('_')[1];
                const membro   = await interaction.guild.members.fetch(membroId).catch(() => null);

                await interaction.deferUpdate();

                await sendStaffLog(client, `⚖️ Decisão de Recrutamento: ${action}`, `A ficha de <@${membroId}> foi **${action}** por <@${interaction.user.id}>.`, color);

                if (membro) {
                    try { await membro.roles.remove(CARGO_FORMULARIO); } catch {}
                    if (action === 'Aprovada') {
                        try { await membro.roles.add(CARGO_APROVADO); } catch {}
                        // Aprovado: remove o registro do nick original (não precisa restaurar)
                        removerNickOriginal(membro.id);
                    } else {
                        // Reprovado: restaura o nome original do usuário
                        const nickOriginal = getNickOriginal(membro.id);
                        if (nickOriginal !== null) {
                            try {
                                // Se o nick original era o username (sem apelido), remove o apelido
                                if (nickOriginal === membro.user.username) {
                                    await membro.setNickname(null);
                                } else {
                                    await membro.setNickname(nickOriginal);
                                }
                            } catch {}
                            removerNickOriginal(membro.id);
                        }
                    }
                    try {
                        const dmEmbed = new EmbedBuilder()
                            .setColor(color)
                            .setTitle(action === 'Aprovada' ? '✅ Parabéns!' : '❌ Resultado')
                            .setDescription(`Olá, **${membro.displayName}**! Sua ficha foi **${action.toLowerCase()}** pela staff da **Size**.`)
                            .setTimestamp();
                        await membro.send({ embeds: [dmEmbed] });
                    } catch {}
                }

                const embedResult = new EmbedBuilder()
                    .setColor(color)
                    .setTitle(`✅ Ficha ${action}`)
                    .setDescription(`<@${membroId}> foi ${action.toLowerCase()} por <@${interaction.user.id}>.`)
                    .setTimestamp();

                await interaction.message.edit({ embeds: [embedResult], components: [] });
                if (action === 'Reprovada') setTimeout(async () => { try { await interaction.channel.delete(); } catch {} }, 5000);
            } catch (err) {
                await notifyError(client, err, 'Aprovação/Reprovação');
            }
            return;
        }
    }
};
