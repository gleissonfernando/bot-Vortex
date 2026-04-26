const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
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

/**
 * Verifica se o membro tem permissão para acessar o painel.
 */
function hasPanelPermission(member) {
    if (member.roles.cache.has(SUPERIOR_ID)) return true;
    const conf = loadJSON(CONFIG_PATH);
    if (conf.STAFF_ROLES && Array.isArray(conf.STAFF_ROLES)) {
        return conf.STAFF_ROLES.some(roleId => member.roles.cache.has(roleId));
    }
    return false;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('VORTEX MANAGEMENT SYSTEM - Painel de Controle'),

  async execute(interaction) {
    if (!hasPanelPermission(interaction.member)) {
      return interaction.reply({ content: '❌ Você não tem acesso a este painel.', ephemeral: true });
    }
    await renderDashboard(interaction, 'tab_stats');
  },

  async handleButton(interaction) {
    if (!hasPanelPermission(interaction.member)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
    
    const conf = loadJSON(CONFIG_PATH);

    if (interaction.customId.startsWith('tab_')) return renderDashboard(interaction, interaction.customId, true);
    
    if (interaction.customId === 'toggle_maint') {
      conf.MAINTENANCE_MODE = !conf.MAINTENANCE_MODE;
      conf.MAINTENANCE_BY = String(interaction.user.id);
      conf.MAINTENANCE_SINCE = Date.now();
      saveJSON(CONFIG_PATH, conf);
      return renderDashboard(interaction, 'tab_manutencao', true);
    }

    if (interaction.customId === 'test_notice') {
        return interaction.reply({
            content: '⚠️ **O bot está em manutenção. Tente novamente mais tarde.**',
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Chamar Suporte').setStyle(ButtonStyle.Link).setURL('https://discord.gg/vortex'))],
            ephemeral: true
        });
    }
  },

  async handleSelectMenu(interaction) {
    const data = loadJSON(CONFIG_PATH);
    if (interaction.customId === 'select_log') data.LOG_CHANNEL = String(interaction.values[0]);
    saveJSON(CONFIG_PATH, data);
    return renderDashboard(interaction, 'tab_config', true);
  }
};

async function renderDashboard(interaction, tab, edit = false) {
  const stats = loadJSON(STATS_PATH);
  const conf = loadJSON(CONFIG_PATH);
  const guild = interaction.guild;
  
  const embed = new EmbedBuilder()
    .setTimestamp()
    .setFooter({ text: `Vortex Management System - ${String(tab).replace('tab_', '')}` });

  const mainRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tab_stats').setLabel('📊 Estatísticas').setStyle(tab === 'tab_stats' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tab_config').setLabel('⚙️ Configurações').setStyle(tab === 'tab_config' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tab_manutencao').setLabel('🔧 Manutenção').setStyle(tab === 'tab_manutencao' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tab_logs').setLabel('📁 Registros').setStyle(tab === 'tab_logs' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  let rows = [mainRow];

  if (tab === 'tab_stats') {
    embed.setAuthor({ name: 'VORTEX | DASHBOARD', iconURL: guild.iconURL() || null }).setColor('#7000FF')
      .setDescription('### 📊 Resumo em Tempo Real\n*Painel geral de estatísticas do servidor*')
      .addFields(
        { name: '👤 Membros', value: String(guild.memberCount), inline: true },
        { name: '📋 Fichas', value: String((stats.aprovados || 0) + (stats.recusados || 0) + (stats.pendentes || 0)), inline: true },
        { name: '🟢 Status', value: conf.MAINTENANCE_MODE ? '🔴 Em Manutenção' : '🟢 Online', inline: true }
      );
  } else if (tab === 'tab_manutencao') {
    const since = conf.MAINTENANCE_SINCE ? `<t:${Math.floor(conf.MAINTENANCE_SINCE / 1000)}:R>` : 'N/A';
    embed.setAuthor({ name: '🛠️ Painel de Controle — Modo Manutenção', iconURL: guild.iconURL() || null })
      .setColor(conf.MAINTENANCE_MODE ? '#FF0055' : '#3498DB')
      .setDescription('### 🔧 Controle de Manutenção\nQuando ativo, interações de usuários comuns são bloqueadas.\n\n' + 
                      `**🔴 Status Atual:** ${conf.MAINTENANCE_MODE ? '🔴 ATIVO' : '🟢 DESATIVADO'}\n` +
                      `**👤 Quem ativou:** <@${conf.MAINTENANCE_BY || 'N/A'}>\n` +
                      `**🕒 Tempo:** ${since}\n\n` +
                      '**📖 Como Funciona:** Usuários sem cargo staff receberão um aviso de manutenção com botão para suporte.')
      .addFields(
        { name: '🔐 Permissões', value: `<@&${SUPERIOR_ID}>`, inline: true },
        { name: '✅ Liberados', value: '`/painel`, `/set` (Staff)', inline: true }
      );

    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('toggle_maint').setLabel(conf.MAINTENANCE_MODE ? '🟢 Desativar Manutenção' : '🔴 Ativar Manutenção').setStyle(conf.MAINTENANCE_MODE ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('test_notice').setLabel('🧪 Testar Aviso').setStyle(ButtonStyle.Secondary)
    ));
    
    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('reg_role').setLabel('🛡️ Registrar Cargo').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('rem_role').setLabel('❌ Remover Cargo').setStyle(ButtonStyle.Secondary)
    ));
  } else if (tab === 'tab_config') {
    embed.setTitle('⚙️ CONFIGURAÇÕES').setColor('#00D9FF');
    rows.push(new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId('select_log').setPlaceholder('Canal de Logs').addChannelTypes(ChannelType.GuildText)
    ));
  }

  const options = { embeds: [embed], components: rows, ephemeral: true };
  edit ? await interaction.update(options) : await interaction.reply(options);
}
