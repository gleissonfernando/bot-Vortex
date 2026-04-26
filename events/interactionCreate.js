const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const { sendStaffLog } = require('../utils/notifications');

const STATS_PATH = path.join(__dirname, '..', 'commands', 'stats.json');
const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const SUPERIOR_ID = '1497703127074345040';

function loadJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } }
function saveJSON(p, d) { try { fs.writeFileSync(p, JSON.stringify(d, null, 2)); } catch {} }

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        const { client, guild, user, member } = interaction;
        const conf = loadJSON(CONFIG_PATH);

        // Lógica Global de Manutenção
        if (conf.MAINTENANCE_MODE && !member.roles.cache.has(SUPERIOR_ID)) {
            const maintEmbed = new EmbedBuilder()
                .setTitle('⚠️ VORTEX | MANUTENÇÃO')
                .setColor('#FF0055')
                .setDescription('O bot está em manutenção no momento. Tente novamente mais tarde.')
                .setTimestamp();
            
            const maintBtn = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('Chamar Suporte').setStyle(ButtonStyle.Link).setURL('https://discord.gg/vortex')
            );

            if (interaction.isRepliable()) {
                return interaction.reply({ embeds: [maintEmbed], components: [maintBtn], ephemeral: true });
            }
            return;
        }

        if (interaction.isChatInputCommand()) {
            const cmd = client.commands.get(interaction.commandName);
            if (cmd) await cmd.execute(interaction);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'Vortex_set_start') {
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
                    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] }
                ]
            });

            const embed = new EmbedBuilder().setTitle('📋 VORTEX | SOLICITAÇÃO').setColor('#2F3136')
                .setDescription(`👤 **Candidato:** <@${user.id}>\n📌 **Tipo:** \`${tipo}\``)
                .addFields(
                    { name: '📱 Telefone', value: tel, inline: true },
                    { name: '🎮 ID Game', value: idG, inline: true },
                    { name: '🔗 Steam Hex', value: '`Automático`', inline: true },
                    { name: '👥 Indicou', value: ind, inline: true },
                    { name: '🎂 Idade', value: idade, inline: true }
                ).setFooter({ text: 'Vortex System' });

            const btn = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`Vortex_app_${user.id}_${tel}`).setLabel('Aprovar').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`Vortex_rej_${user.id}`).setLabel('Reprovar').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`Vortex_del`).setLabel('Apagar').setStyle(ButtonStyle.Secondary)
            );

            await canal.send({ content: `<@${user.id}> aguarde a staff.`, embeds: [embed], components: [btn] });
            await interaction.editReply(`✅ Enviado em <#${canal.id}>`);
            
            const stats = loadJSON(STATS_PATH);
            stats.pendentes = (stats.pendentes || 0) + 1;
            saveJSON(STATS_PATH, stats);
            await sendStaffLog(client, 'Novo Set', `<@${user.id}> abriu pedido em <#${canal.id}>`, '#3498DB');
        }

        if (interaction.isButton()) {
            if (interaction.customId === 'Vortex_del') {
                if (member.roles.cache.has(SUPERIOR_ID)) return interaction.channel.delete();
                return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
            }

            if (interaction.customId.startsWith('Vortex_app_') || interaction.customId.startsWith('Vortex_rej_')) {
                if (!member.roles.cache.has(SUPERIOR_ID)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
                
                const isApp = interaction.customId.startsWith('Vortex_app_');
                const targetId = interaction.customId.split('_')[2];
                const target = await guild.members.fetch(targetId).catch(() => null);
                
                if (isApp) {
                    const tel = interaction.customId.split('_')[3];
                    if (target) {
                        await target.roles.remove(config.pendingRoleId).catch(() => {});
                        await target.roles.add(config.approvedRoleId).catch(() => {});
                        await target.setNickname(`[${tel}] ${target.user.username}`).catch(() => {});
                    }
                }

                const stats = loadJSON(STATS_PATH);
                if (isApp) stats.aprovados = (stats.aprovados || 0) + 1;
                else stats.recusados = (stats.recusados || 0) + 1;
                if (stats.pendentes > 0) stats.pendentes--;
                saveJSON(STATS_PATH, stats);

                await interaction.reply({ content: isApp ? '✅ Aprovado!' : '❌ Reprovado!' });
                await sendStaffLog(client, isApp ? 'Aprovado' : 'Reprovado', `Staff: <@${user.id}> | Alvo: <@${targetId}>`, isApp ? '#57F287' : '#ED4245');
                setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
            }
        }

        const painel = client.commands.get('painel');
        if (painel) {
            if (interaction.isButton()) await painel.handleButton(interaction);
            if (interaction.isStringSelectMenu()) await painel.handleSelectMenu(interaction);
        }
    }
};
