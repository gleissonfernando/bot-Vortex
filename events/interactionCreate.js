const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const { sendVortexLog, notifyError } = require('../utils/notifications');

const STATS_PATH = path.join(__dirname, '..', 'commands', 'stats.json');
const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const PEDIDOS_PATH = path.join(__dirname, '..', 'commands', 'pedidos_ativos.json');
const SUPERIOR_ID = '1497703127074345040';

function loadJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } }
function saveJSON(p, d) { try { fs.writeFileSync(p, JSON.stringify(d, null, 2)); } catch {} }

function hasStaffPermission(member) {
    if (member.roles.cache.has(SUPERIOR_ID)) return true;
    const conf = loadJSON(CONFIG_PATH);
    if (conf.STAFF_ROLES && Array.isArray(conf.STAFF_ROLES)) {
        return conf.STAFF_ROLES.some(roleId => member.roles.cache.has(roleId));
    }
    return false;
}

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        const { client, guild, user, member } = interaction;
        const conf = loadJSON(CONFIG_PATH);

        // Bloqueio de Manutenção VORTEX
        if (conf.MAINTENANCE_MODE && !hasStaffPermission(member)) {
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
                return interaction.reply({ embeds: [maintEmbed], components: [maintBtn], ephemeral: true });
            }
            return;
        }

        // Slash Commands
        if (interaction.isChatInputCommand()) {
            const cmd = client.commands.get(interaction.commandName);
            if (cmd) await cmd.execute(interaction);
            return;
        }

        // Interações do Painel
        const painel = client.commands.get('painel');
        if (painel) {
            if (interaction.isButton() && (interaction.customId.startsWith('tab_') || ['toggle_maint', 'test_notice', 'reg_role', 'rem_role'].includes(interaction.customId))) {
                return await painel.handleButton(interaction);
            }
            if (interaction.isStringSelectMenu() && interaction.customId === 'select_log') {
                return await painel.handleSelectMenu(interaction);
            }
            if (interaction.isChannelSelectMenu() && interaction.customId === 'select_log') {
                return await painel.handleSelectMenu(interaction);
            }
            if (interaction.isModalSubmit() && (interaction.customId === 'modal_reg_role' || interaction.customId === 'modal_rem_role')) {
                return await painel.handleModal(interaction);
            }
        }

        // Sistema de Recrutamento (/set)
        if (interaction.isButton() && interaction.customId === 'Vortex_set_start') {
            // Adicionar cargo pendente ao iniciar a solicitação
            const PENDENTE_ID = '1449514118292967578';
            if (member) {
                await member.roles.add(PENDENTE_ID).catch(() => {});
            }

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
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tel').setLabel('NÚMERO DE TELEFONE').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id').setLabel('NÚMERO EM GAME').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ind').setLabel('QUEM INDICOU? (@)').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('idade').setLabel('SUA IDADE').setStyle(TextInputStyle.Short).setRequired(true))
            );
            return interaction.showModal(modal);
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith('Vortex_modal_')) {
            await interaction.deferReply({ ephemeral: true });
            const tipo = interaction.customId.split('_')[2];
            const tel = interaction.fields.getTextInputValue('tel');
            const idG = interaction.fields.getTextInputValue('id');
            const ind = interaction.fields.getTextInputValue('ind');
            const idade = interaction.fields.getTextInputValue('idade');

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
                    { name: '📱 Telefone', value: `\`${tel}\``, inline: true },
                    { name: '🎮 ID Game', value: `\`${idG}\``, inline: true },
                    { name: '🎂 Idade', value: `\`${idade}\``, inline: true },
                    { name: '👥 Indicação', value: ind.includes('@') ? ind : `\`${ind}\``, inline: true },
                    { name: '🔗 Steam Hex', value: '`Automático`', inline: true },
                    { name: '📊 Status', value: '`Aguardando análise`', inline: true }
                )
                .setFooter({ text: 'Vortex System • Aguardando análise da staff' })
                .setTimestamp();

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`Vortex_app_${user.id}_${tel}`).setLabel('Aprovar').setEmoji('✅').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`Vortex_rej_${user.id}`).setLabel('Reprovar').setEmoji('❌').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('Vortex_del').setLabel('Apagar').setEmoji('🗑️').setStyle(ButtonStyle.Secondary)
            );

            await canal.send({ content: `<@${user.id}> aguarde a análise da staff.`, embeds: [embed], components: [buttons] });
            await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#57F287').setTitle('✅ Solicitação enviada com sucesso').setDescription(`Canal criado: <#${canal.id}>`)] });

            const pedidosAtivos = loadJSON(PEDIDOS_PATH);
            pedidosAtivos[user.id] = canal.id;
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
                
                const isApp = interaction.customId.startsWith('Vortex_app_');
                const targetId = interaction.customId.split('_')[2];
                
                if (isApp) {
                    const tel = interaction.customId.split('_')[3];
                    const target = await guild.members.fetch(targetId).catch(() => null);
                    if (target) {
                        const PENDENTE_ID = '1449514118292967578';
                        const APROVADO_ID = '1201235607549124639';
                        await target.roles.remove(PENDENTE_ID).catch(() => {});
                        await target.roles.add(APROVADO_ID).catch(() => {});
                        await target.setNickname(`[${tel}] ${target.user.username}`).catch(() => {});
                        try { await target.send({ content: `✅ **VORTEX:** Sua solicitação foi **APROVADA** por <@${user.id}>.` }).catch(() => {}); } catch {}
                    }
                } else {
                    const target = await client.users.fetch(targetId).catch(() => null);
                    // Na reprovação, o cargo pendente (1449514118292967578) é mantido conforme solicitado pelo usuário.
                    if (target) { try { await target.send({ content: `❌ **VORTEX:** Sua solicitação foi **REPROVADA** por <@${user.id}>.` }).catch(() => {}); } catch {} }
                }

                const pedidosAtivos = loadJSON(PEDIDOS_PATH);
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
                    .setDescription(`Usuário: <@${targetId}>\nResultado: ${isApp ? 'Aprovado' : 'Reprovado'}\nStaff: <@${user.id}>\n\nCanal deletado em 5s.`)
                    .setTimestamp();

                await interaction.reply({ embeds: [resultEmbed] });
                
                await sendVortexLog(client, {
                    title: isApp ? 'Solicitação Aprovada' : 'Solicitação Reprovada',
                    description: `**Staff:** <@${user.id}>\n**Candidato:** <@${targetId}>\n**Resultado:** ${isApp ? 'Aprovado' : 'Reprovado'}`,
                    color: isApp ? '#57F287' : '#FF0055',
                    type: 'RECRUTAMENTO',
                    userId: user.id // Log para o staff que realizou a ação
                });

                setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
            }
        }
    }
};
