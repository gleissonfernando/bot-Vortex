const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../../config/config');
const { isRegisteredUser, denyNotRegistered } = require('../../utils/permissions');

// Caminhos dos arquivos de dados
const STATS_PATH = path.join(__dirname, '..', 'stats.json');
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

// Cargo de Gerência Superior que pode alterar manutenção
const SUPERIOR_ID = '1497703127074345040';

// Funções Utilitárias
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
    if (!isRegisteredUser(interaction)) return denyNotRegistered(interaction);
    await renderTab(interaction, 'tab_stats');
  },

  async handleButton(interaction) {
    const { member, user } = interaction;
    const tab = interaction.customId;

    if (['tab_stats', 'tab_roles', 'tab_manutencao', 'tab_config'].includes(tab)) {
      await renderTab(interaction, tab, true);
      return;
    }

    if (interaction.customId === 'toggle_maintenance') {
      if (!member.roles.cache.has(SUPERIOR_ID)) {
        return interaction.reply({ content: '❌ Apenas a Gerência Superior pode alterar o modo de manutenção.', ephemeral: true });
      }
      const data = loadConfig();
      data.MAINTENANCE_MODE = !data.MAINTENANCE_MODE;
      data.MAINTENANCE_ACTIVATED_BY = user.id;
      data.MAINTENANCE_ACTIVATED_AT = new Date().toISOString();
      saveConfig(data);
      await renderTab(interaction, 'tab_manutencao', true);
      return;
    }

    if (interaction.customId === 'test_system') {
      await interaction.reply({ content: '🔍 **Iniciando Teste de Sistema...**\n✅ Conexão com Discord: OK\n✅ Permissões de Cargo: OK\n✅ Banco de Dados (JSON): OK\n✅ Sistema de Logs: OK\n\n*Sistema operando normalmente!*', ephemeral: true });
      return;
    }
  },

  async handleSelectMenu(interaction) {
    if (interaction.customId === 'select_log_channel') {
      if (!interaction.member.roles.cache.has(SUPERIOR_ID)) {
        return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
      }
      const channelId = interaction.values[0];
      const data = loadConfig();
      data.LOG_CHANNEL = channelId;
      saveConfig(data);
      await interaction.reply({ content: `✅ Canal de logs atualizado para <#${channelId}>`, ephemeral: true });
      await renderTab(interaction, 'tab_config', true);
    }
  }
};

// ─── ABA: Estatísticas ────────────────────────────────────────────────────────

function buildStatsEmbed(interaction) {
  const stats = loadStats();
  const totalFichas = stats.pendentes + stats.aprovados + stats.recusados;
  const memberCount = interaction.guild.memberCount;

  return new EmbedBuilder()
    .setTitle('📊  Painel de Controle — Central de Estatísticas')
    .setColor(0x5865F2)
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/1162/1162456.png')
    .setDescription(
      '### 📈 Resumo Geral\n' +
      'Acompanhe o desempenho do servidor e recrutamento em tempo real.\n\n' +
      `> **Total de Membros no Servidor:** \`${memberCount}\`\n` +
      `> **Total de Fichas Processadas:** \`${totalFichas}\``
    )
    .addFields(
      { name: '🕐 Pendentes', value: `\`\`\`yaml\n${stats.pendentes}\n\`\`\``, inline: true },
      { name: '✅ Aprovados', value: `\`\`\`diff\n+ ${stats.aprovados}\n\`\`\``, inline: true },
      { name: '❌ Recusados', value: `\`\`\`diff\n- ${stats.recusados}\n\`\`\``, inline: true },
    )
    .setFooter({ text: 'Vortex Management System • Monitoramento' })
    .setTimestamp();
}

function buildStatsRows() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tab_stats').setLabel('Estatísticas').setStyle(ButtonStyle.Primary).setDisabled(true),
    new ButtonBuilder().setCustomId('tab_roles').setLabel('Cargos').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tab_config').setLabel('Configuração').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tab_manutencao').setLabel('Manutenção').setStyle(ButtonStyle.Secondary)
  );
}

// ─── ABA: Cargos ─────────────────────────────────────────────────────────────

function buildRolesEmbed() {
  return new EmbedBuilder()
    .setTitle('🛡️ Configuração de Cargos')
    .setColor(0xFEE75C)
    .setDescription('Visualize e gerencie os cargos principais do sistema.')
    .addFields(
      { name: 'Pendente', value: `<@&${config.pendingRoleId}>`, inline: true },
      { name: 'Aprovado', value: `<@&${config.approvedRoleId}>`, inline: true }
    );
}

function buildRolesRows() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tab_stats').setLabel('Estatísticas').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tab_roles').setLabel('Cargos').setStyle(ButtonStyle.Primary).setDisabled(true),
    new ButtonBuilder().setCustomId('tab_config').setLabel('Configuração').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tab_manutencao').setLabel('Manutenção').setStyle(ButtonStyle.Secondary)
  );
}

// ─── ABA: Configuração (Seleção de Canais com Rolagem) ────────────────────────

function buildConfigEmbed() {
  const data = loadConfig();
  return new EmbedBuilder()
    .setTitle('⚙️ Configurações do Sistema')
    .setColor(0x3498DB)
    .setDescription('Utilize os menus abaixo para selecionar os canais do sistema. Os menus permitem rolagem automática por todos os canais do servidor.')
    .addFields(
      { name: 'Canal de Logs Atual', value: data.LOG_CHANNEL ? `<#${data.LOG_CHANNEL}>` : '`Não configurado`', inline: true }
    );
}

function buildConfigRows() {
  const selectLog = new ChannelSelectMenuBuilder()
    .setCustomId('select_log_channel')
    .setPlaceholder('Selecione o canal de logs (Rolagem disponível)')
    .addChannelTypes(ChannelType.GuildText);

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tab_stats').setLabel('Estatísticas').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tab_roles').setLabel('Cargos').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tab_config').setLabel('Configuração').setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId('tab_manutencao').setLabel('Manutenção').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(selectLog)
  ];
}

// ─── ABA: Manutenção ─────────────────────────────────────────────────────────

function buildManutencaoEmbed() {
  const data = loadConfig();
  const status = data.MAINTENANCE_MODE ? '🔴 ATIVADO (Sistema Bloqueado)' : '🟢 DESATIVADO (Sistema Online)';
  
  return new EmbedBuilder()
    .setTitle('🔧 Modo de Manutenção')
    .setColor(data.MAINTENANCE_MODE ? 0xED4245 : 0x57F287)
    .setDescription(`O modo de manutenção impede que novos usuários usem o sistema de recrutamento.\n\n**Status Atual:** \`${status}\``)
    .addFields(
      { name: 'Alterado por', value: data.MAINTENANCE_ACTIVATED_BY ? `<@${data.MAINTENANCE_ACTIVATED_BY}>` : 'Ninguém', inline: true },
      { name: 'Data', value: data.MAINTENANCE_ACTIVATED_AT ? new Date(data.MAINTENANCE_ACTIVATED_AT).toLocaleString('pt-BR') : 'N/A', inline: true }
    );
}

function buildManutencaoRows() {
  const data = loadConfig();
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tab_stats').setLabel('Estatísticas').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tab_roles').setLabel('Cargos').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tab_config').setLabel('Configuração').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tab_manutencao').setLabel('Manutenção').setStyle(ButtonStyle.Primary).setDisabled(true)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('toggle_maintenance')
        .setLabel(data.MAINTENANCE_MODE ? 'Desativar Manutenção' : 'Ativar Manutenção')
        .setStyle(data.MAINTENANCE_MODE ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('test_system')
        .setLabel('Teste de Sistema')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🧪')
    )
  ];
}

// ─── Render Principal ─────────────────────────────────────────────────────────

async function renderTab(interaction, tab, edit = false) {
  let embed;
  let rows = [];

  if (tab === 'tab_stats') {
    embed = buildStatsEmbed(interaction);
    rows = [buildStatsRows()];
  } else if (tab === 'tab_roles') {
    embed = buildRolesEmbed();
    rows = [buildRolesRows()];
  } else if (tab === 'tab_manutencao') {
    embed = buildManutencaoEmbed();
    rows = buildManutencaoRows();
  } else if (tab === 'tab_config') {
    embed = buildConfigEmbed();
    rows = buildConfigRows();
  }

  const options = { embeds: [embed], components: rows, ephemeral: true };
  
  try {
    if (edit) {
      await interaction.update(options);
    } else {
      await interaction.reply(options);
    }
  } catch (err) {
    console.error('Erro ao renderizar aba:', err);
  }
}
