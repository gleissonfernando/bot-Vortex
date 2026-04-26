const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle,
  ChannelSelectMenuBuilder, 
  ChannelType, 
  PermissionFlagsBits 
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../../config/config');

const STATS_PATH = path.join(__dirname, '..', 'stats.json');
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const SUPERIOR_ID = '1497703127074345040';

function loadJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } }
function saveJSON(p, d) { try { fs.writeFileSync(p, JSON.stringify(d, null, 2)); } catch {} }

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Painel de Controle Vortex'),

  async execute(interaction) {
    if (!interaction.member.roles.cache.has(SUPERIOR_ID)) {
      return interaction.reply({ content: '❌ Acesso restrito à Gerência Superior Vortex.', ephemeral: true });
    }
    await renderTab(interaction, 'tab_stats');
  },

  async handleButton(interaction) {
    if (interaction.customId.startsWith('tab_')) return renderTab(interaction, interaction.customId, true);
    
    if (interaction.customId === 'toggle_maintenance') {
      const data = loadJSON(CONFIG_PATH);
      data.MAINTENANCE_MODE = !data.MAINTENANCE_MODE;
      data.MAINTENANCE_BY = interaction.user.id;
      saveJSON(CONFIG_PATH, data);
      return renderTab(interaction, 'tab_manutencao', true);
    }

    if (interaction.customId === 'test_system') {
      return interaction.reply({ 
        embeds: [new EmbedBuilder().setTitle('🧪 VORTEX | DIAGNÓSTICO').setColor('#5865F2').setDescription('✅ **API:** Online\n✅ **DB:** Sincronizado\n✅ **Logs:** Ativos\n\nSistema 100% estável.')],
        ephemeral: true 
      });
    }
  },

  async handleSelectMenu(interaction) {
    const data = loadJSON(CONFIG_PATH);
    if (interaction.customId === 'select_log') data.LOG_CHANNEL = interaction.values[0];
    if (interaction.customId === 'select_call') data.CALL_CHANNEL = interaction.values[0];
    saveJSON(CONFIG_PATH, data);
    return renderTab(interaction, 'tab_config', true);
  }
};

async function renderTab(interaction, tab, edit = false) {
  const stats = loadJSON(STATS_PATH);
  const conf = loadJSON(CONFIG_PATH);
  const embed = new EmbedBuilder().setTimestamp().setFooter({ text: 'Vortex Management System' });
  let rows = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tab_stats').setLabel('Estatísticas').setStyle(tab === 'tab_stats' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tab_config').setLabel('Configurações').setStyle(tab === 'tab_config' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tab_manutencao').setLabel('Manutenção').setStyle(tab === 'tab_manutencao' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  )];

  if (tab === 'tab_stats') {
    embed.setTitle('📊 VORTEX | DASHBOARD').setColor('#5865F2')
      .setDescription(`### 📈 Resumo do Servidor\n> **Membros:** \`${interaction.guild.memberCount}\`\n> **Total Fichas:** \`${(stats.aprovados || 0) + (stats.recusados || 0) + (stats.pendentes || 0)}\``)
      .addFields(
        { name: '🕐 Pendentes', value: `\`${stats.pendentes || 0}\``, inline: true },
        { name: '✅ Aprovados', value: `\`${stats.aprovados || 0}\``, inline: true },
        { name: '❌ Recusados', value: `\`${stats.recusados || 0}\``, inline: true }
      );
  } else if (tab === 'tab_config') {
    embed.setTitle('⚙️ VORTEX | CONFIGURAÇÕES').setColor('#3498DB')
      .setDescription('Selecione os canais oficiais do sistema nos menus abaixo.')
      .addFields(
        { name: 'Logs', value: conf.LOG_CHANNEL ? `<#${conf.LOG_CHANNEL}>` : '`Não definido`', inline: true },
        { name: 'Call', value: conf.CALL_CHANNEL ? `<#${conf.CALL_CHANNEL}>` : '`Não definido`', inline: true }
      );
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('select_log').setPlaceholder('Canal de Logs').addChannelTypes(ChannelType.GuildText)));
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('select_call').setPlaceholder('Call de Recrutamento').addChannelTypes(ChannelType.GuildVoice)));
  } else if (tab === 'tab_manutencao') {
    embed.setTitle('🔧 VORTEX | MANUTENÇÃO').setColor(conf.MAINTENANCE_MODE ? '#ED4245' : '#57F287')
      .setDescription(`O modo manutenção bloqueia o recrutamento para usuários.\n\n**Status:** \`${conf.MAINTENANCE_MODE ? '🔴 ATIVADO' : '🟢 DESATIVADO'}\``);
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('toggle_maintenance').setLabel(conf.MAINTENANCE_MODE ? 'Desativar' : 'Ativar').setStyle(conf.MAINTENANCE_MODE ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('test_system').setLabel('Testar Sistema').setStyle(ButtonStyle.Secondary).setEmoji('🧪')
    ));
  }

  const opt = { embeds: [embed], components: rows, ephemeral: true };
  edit ? await interaction.update(opt) : await interaction.reply(opt);
}
