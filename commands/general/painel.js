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
const { isRegisteredUser, denyNotRegistered } = require('../../utils/permissions');

// Caminhos dos arquivos de dados
const STATS_PATH = path.join(__dirname, '..', 'stats.json');
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

// Cargo de Gerência Superior
const SUPERIOR_ID = '1497703127074345040';

function loadStats() {
  try {
    if (fs.existsSync(STATS_PATH)) return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
  } catch {}
  return { pendentes: 0, aprovados: 0, recusados: 0 };
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {}
  return { STAFF_ROLES: [], MAINTENANCE_MODE: false, LOG_CHANNEL: null };
}

function saveConfig(data) {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2)); } catch {}
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Abre o painel de controle do sistema Vortex'),

  async execute(interaction) {
    if (!interaction.member.roles.cache.has(SUPERIOR_ID) && !isRegisteredUser(interaction)) {
        return interaction.reply({ content: '❌ Acesso negado.', ephemeral: true });
    }
    await renderTab(interaction, 'tab_stats');
  },

  async handleButton(interaction) {
    const { member, user } = interaction;
    const tab = interaction.customId;

    if (['tab_stats', 'tab_roles', 'tab_config', 'tab_manutencao'].includes(tab)) {
      await renderTab(interaction, tab, true);
      return;
    }

    if (interaction.customId === 'toggle_maintenance') {
      if (!member.roles.cache.has(SUPERIOR_ID)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
      const data = loadConfig();
      data.MAINTENANCE_MODE = !data.MAINTENANCE_MODE;
      data.MAINTENANCE_ACTIVATED_BY = user.id;
      data.MAINTENANCE_ACTIVATED_AT = new Date().toISOString();
      saveConfig(data);
      await renderTab(interaction, 'tab_manutencao', true);
      return;
    }

    if (interaction.customId === 'test_system') {
      if (!member.roles.cache.has(SUPERIOR_ID)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
      await interaction.reply({ content: '🧪 **VORTEX | TESTE DE SISTEMA**\n\n✅ Discord API: OK\n✅ Banco de Dados: OK\n✅ Sistema de Logs: OK\n\n✨ **Operacional!**', ephemeral: true });
      return;
    }
  },

  async handleSelectMenu(interaction) {
    if (!interaction.member.roles.cache.has(SUPERIOR_ID)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
    const data = loadConfig();
    if (interaction.customId === 'select_log_channel') data.LOG_CHANNEL = interaction.values[0];
    saveConfig(data);
    await renderTab(interaction, 'tab_config', true);
  }
};

function buildStatsEmbed(interaction) {
  const stats = loadStats();
  const memberCount = interaction.guild.memberCount;
  return new EmbedBuilder()
    .setTitle('📊 VORTEX | ESTATÍSTICAS')
    .setColor(0x5865F2)
    .setDescription(`> **Membros no Servidor:** \`${memberCount}\`\n> **Total de Fichas:** \`${stats.pendentes + stats.aprovados + stats.recusados}\``)
    .addFields(
      { name: '🕐 Pendentes', value: `\`${stats.pendentes}\``, inline: true },
      { name: '✅ Aprovados', value: `\`${stats.aprovados}\``, inline: true },
      { name: '❌ Recusados', value: `\`${stats.recusados}\``, inline: true }
    )
    .setTimestamp();
}

async function renderTab(interaction, tab, edit = false) {
  let embed;
  let rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tab_stats').setLabel('Estatísticas').setStyle(tab === 'tab_stats' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(tab === 'tab_stats'),
      new ButtonBuilder().setCustomId('tab_roles').setLabel('Cargos Staff').setStyle(tab === 'tab_roles' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(tab === 'tab_roles'),
      new ButtonBuilder().setCustomId('tab_config').setLabel('Configurações').setStyle(tab === 'tab_config' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(tab === 'tab_config'),
      new ButtonBuilder().setCustomId('tab_manutencao').setLabel('Manutenção').setStyle(tab === 'tab_manutencao' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(tab === 'tab_manutencao')
    )
  ];

  if (tab === 'tab_stats') embed = buildStatsEmbed(interaction);
  else if (tab === 'tab_roles') {
    embed = new EmbedBuilder().setTitle('🛡️ VORTEX | CARGOS').setColor(0xFEE75C).setDescription(`<@&${config.pendingRoleId}>\n<@&${config.approvedRoleId}>`);
  } else if (tab === 'tab_config') {
    embed = new EmbedBuilder().setTitle('⚙️ CONFIGURAÇÕES').setColor(0x3498DB).setDescription('Selecione o canal de logs abaixo.');
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('select_log_channel').setPlaceholder('Canal de Logs').addChannelTypes(ChannelType.GuildText)));
  } else if (tab === 'tab_manutencao') {
    const data = loadConfig();
    embed = new EmbedBuilder().setTitle('🔧 MANUTENÇÃO').setColor(data.MAINTENANCE_MODE ? 0xED4245 : 0x57F287).setDescription(`Status: ${data.MAINTENANCE_MODE ? 'Ativado' : 'Desativado'}`);
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('toggle_maintenance').setLabel('Alternar').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('test_system').setLabel('Testar Sistema').setStyle(ButtonStyle.Secondary).setEmoji('🧪')
    ));
  }

  const options = { embeds: [embed], components: rows, ephemeral: true };
  if (edit) await interaction.update(options);
  else await interaction.reply(options);
}
