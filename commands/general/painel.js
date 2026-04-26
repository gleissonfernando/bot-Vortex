const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ChannelSelectMenuBuilder, 
  ChannelType 
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
    .setDescription('VORTEX MANAGEMENT SYSTEM - Dashboard'),

  async execute(interaction) {
    if (!interaction.member.roles.cache.has(SUPERIOR_ID)) {
      return interaction.reply({ content: '❌ Você não tem acesso a este painel.', ephemeral: true });
    }
    await renderDashboard(interaction, 'tab_stats');
  },

  async handleButton(interaction) {
    if (!interaction.member.roles.cache.has(SUPERIOR_ID)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
    
    if (interaction.customId.startsWith('tab_')) return renderDashboard(interaction, interaction.customId, true);
    
    if (interaction.customId === 'toggle_maint') {
      const data = loadJSON(CONFIG_PATH);
      data.MAINTENANCE_MODE = !data.MAINTENANCE_MODE;
      saveJSON(CONFIG_PATH, data);
      return renderDashboard(interaction, 'tab_manutencao', true);
    }
  },

  async handleSelectMenu(interaction) {
    const data = loadJSON(CONFIG_PATH);
    if (interaction.customId === 'select_log') data.LOG_CHANNEL = interaction.values[0];
    saveJSON(CONFIG_PATH, data);
    return renderDashboard(interaction, 'tab_config', true);
  }
};

async function renderDashboard(interaction, tab, edit = false) {
  const stats = loadJSON(STATS_PATH);
  const conf = loadJSON(CONFIG_PATH);
  const guild = interaction.guild;
  
  // Cálculo de usuários online (precisa de Presence Intent ativa)
  const onlineMembers = guild.members.cache.filter(m => m.presence?.status && m.presence.status !== 'offline').size || 'N/A';
  
  const embed = new EmbedBuilder()
    .setAuthor({ name: 'VORTEX | DASHBOARD', iconURL: guild.iconURL() })
    .setTimestamp()
    .setFooter({ text: 'Vortex Management System' });

  const mainRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tab_stats').setLabel('📊 Estatísticas').setStyle(tab === 'tab_stats' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tab_config').setLabel('⚙️ Configurações').setStyle(tab === 'tab_config' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tab_manutencao').setLabel('🔧 Manutenção').setStyle(tab === 'tab_manutencao' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tab_logs').setLabel('📁 Registros').setStyle(tab === 'tab_logs' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  let rows = [mainRow];

  if (tab === 'tab_stats') {
    embed.setColor('#7000FF') // Roxo Neon
      .setDescription('### 📊 Resumo em Tempo Real\n*Painel geral de estatísticas do servidor*')
      .addFields(
        { name: '👤 Membros no servidor', value: `\`${guild.memberCount}\``, inline: true },
        { name: '🟢 Usuários online', value: `\`${onlineMembers}\``, inline: true },
        { name: '📋 Total de fichas', value: `\`${(stats.aprovados || 0) + (stats.recusados || 0) + (stats.pendentes || 0)}\``, inline: true },
        { name: '\u200B', value: '### 📌 Status das Solicitações' },
        { name: '⏳ Pendentes', value: `\`${stats.pendentes || 0}\``, inline: true },
        { name: '✅ Aprovadas', value: `\`${stats.aprovados || 0}\``, inline: true },
        { name: '❌ Recusadas', value: `\`${stats.recusados || 0}\``, inline: true },
        { name: '\u200B', value: '### 🛡️ Informações do Sistema' },
        { name: '🟢 Status', value: conf.MAINTENANCE_MODE ? '🔴 Em Manutenção' : '🟢 Online', inline: true },
        { name: 'Cargo Staff', value: `<@&${SUPERIOR_ID}>`, inline: true },
        { name: 'Servidor', value: `\`${guild.name}\``, inline: true }
      );
  } else if (tab === 'tab_config') {
    embed.setTitle('⚙️ CONFIGURAÇÕES DO SISTEMA').setColor('#00D9FF') // Azul Neon
      .setDescription('Ajuste os canais de operação da Vortex.');
    rows.push(new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId('select_log').setPlaceholder('Selecione o Canal de Logs').addChannelTypes(ChannelType.GuildText)
    ));
  } else if (tab === 'tab_manutencao') {
    embed.setTitle('🔧 MODO DE MANUTENÇÃO').setColor(conf.MAINTENANCE_MODE ? '#FF0055' : '#57F287')
      .setDescription(`Status Atual: **${conf.MAINTENANCE_MODE ? 'ATIVADO' : 'DESATIVADO'}**\n\nQuando ativado, usuários comuns não podem abrir solicitações.`);
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('toggle_maint').setLabel(conf.MAINTENANCE_MODE ? 'Desativar Manutenção' : 'Ativar Manutenção').setStyle(conf.MAINTENANCE_MODE ? ButtonStyle.Success : ButtonStyle.Danger)
    ));
  } else if (tab === 'tab_logs') {
    embed.setTitle('📁 REGISTROS DE APROVAÇÃO').setColor('#FFFFFF')
      .setDescription('Histórico recente de atividades do sistema.');
  }

  const options = { embeds: [embed], components: rows, ephemeral: true };
  edit ? await interaction.update(options) : await interaction.reply(options);
}
