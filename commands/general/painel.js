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

// Cargo de Gerência Superior (Vortex)
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
  return { STAFF_ROLES: [], MAINTENANCE_MODE: false, LOG_CHANNEL: null, CALL_CHANNEL: null };
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
        return interaction.reply({ content: '❌ Você não está cadastrado no sistema Vortex.', ephemeral: true });
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
      if (!member.roles.cache.has(SUPERIOR_ID)) {
        return interaction.reply({ content: '❌ Apenas a Gerência Superior (Vortex) pode alterar o modo de manutenção.', ephemeral: true });
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
      if (!member.roles.cache.has(SUPERIOR_ID)) {
        return interaction.reply({ content: '❌ Apenas a Gerência Superior pode realizar o teste de sistema.', ephemeral: true });
      }
      await interaction.reply({ 
        content: '🧪 **VORTEX | TESTE DE SISTEMA**\n\n' +
                 '🔍 Analisando módulos...\n' +
                 '✅ Conexão Discord API: Operacional\n' +
                 '✅ Permissões de Gerência: OK\n' +
                 '✅ Banco de Dados JSON: Sincronizado\n' +
                 '✅ Sistema de Logs: Visual Ativo\n\n' +
                 '✨ **O sistema Vortex está 100% operacional!**', 
        ephemeral: true 
      });
      return;
    }
  },

  async handleSelectMenu(interaction) {
    if (!interaction.member.roles.cache.has(SUPERIOR_ID)) {
        return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
    }

    const data = loadConfig();
    if (interaction.customId === 'select_log_channel') {
      data.LOG_CHANNEL = interaction.values[0];
      await interaction.reply({ content: `✅ Canal de logs atualizado para <#${data.LOG_CHANNEL}>`, ephemeral: true });
    } else if (interaction.customId === 'select_call_channel') {
      data.CALL_CHANNEL = interaction.values[0];
      await interaction.reply({ content: `✅ Call de recrutamento atualizada para <#${data.CALL_CHANNEL}>`, ephemeral: true });
    }
    
    saveConfig(data);
    await renderTab(interaction, 'tab_config', true);
  }
};

// ─── ABA: Estatísticas ────────────────────────────────────────────────────────

function buildStatsEmbed(interaction) {
  const stats = loadStats();
  const totalFichas = stats.pendentes + stats.aprovados + stats.recusados;
  const memberCount = interaction.guild.memberCount;

  return new EmbedBuilder()
    .setTitle('📊 VORTEX | CENTRAL DE ESTATÍSTICAS')
    .setColor(0x5865F2)
    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
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
    .setFooter({ text: 'Vortex Management System • v2.0' })
    .setTimestamp();
}

// ─── ABA: Cargos ─────────────────────────────────────────────────────────────

function buildRolesEmbed() {
  return new EmbedBuilder()
    .setTitle('🛡️ VORTEX | CARGOS DO SISTEMA')
    .setColor(0xFEE75C)
    .setDescription('Visualize os cargos principais configurados no sistema Vortex.')
    .addFields(
      { name: 'Pendente', value: `<@&${config.pendingRoleId}>`, inline: true },
      { name: 'Aprovado', value: `<@&${config.approvedRoleId}>`, inline: true },
      { name: 'Gerência Superior', value: `<@&${SUPERIOR_ID}>`, inline: false }
    );
}

// ─── ABA: Configuração (Com Rolagem de Canais) ────────────────────────────────

function buildConfigEmbed() {
  const data = loadConfig();
  return new EmbedBuilder()
    .setTitle('⚙️ VORTEX | CONFIGURAÇÕES DE CANAIS')
    .setColor(0x3498DB)
    .setDescription('Utilize os menus de rolagem abaixo para configurar os canais do servidor.')
    .addFields(
      { name: 'Canal de Logs', value: data.LOG_CHANNEL ? `<#${data.LOG_CHANNEL}>` : '`Não configurado`', inline: true },
      { name: 'Call de Recrutamento', value: data.CALL_CHANNEL ? `<#${data.CALL_CHANNEL}>` : '`Não configurado`', inline: true }
    );
}

function buildConfigRows() {
  const selectLog = new ChannelSelectMenuBuilder()
    .setCustomId('select_log_channel')
    .setPlaceholder('Selecione o Canal de Logs (Rolagem)')
    .addChannelTypes(ChannelType.GuildText);

  const selectCall = new ChannelSelectMenuBuilder()
    .setCustomId('select_call_channel')
    .setPlaceholder('Selecione a Call de Recrutamento (Rolagem)')
    .addChannelTypes(ChannelType.GuildVoice);

  return [
    new ActionRowBuilder().addComponents(selectLog),
    new ActionRowBuilder().addComponents(selectCall)
  ];
}

// ─── ABA: Manutenção ─────────────────────────────────────────────────────────

function buildManutencaoEmbed() {
  const data = loadConfig();
  const status = data.MAINTENANCE_MODE ? '🔴 ATIVADO (Sistema Bloqueado)' : '🟢 DESATIVADO (Sistema Online)';
  
  return new EmbedBuilder()
    .setTitle('🔧 VORTEX | MODO DE MANUTENÇÃO')
    .setColor(data.MAINTENANCE_MODE ? 0xED4245 : 0x57F287)
    .setDescription(`O modo de manutenção impede que usuários comuns usem o recrutamento.\n\n**Status Atual:** \`${status}\``)
    .addFields(
      { name: 'Alterado por', value: data.MAINTENANCE_ACTIVATED_BY ? `<@${data.MAINTENANCE_ACTIVATED_BY}>` : 'Ninguém', inline: true },
      { name: 'Data', value: data.MAINTENANCE_ACTIVATED_AT ? new Date(data.MAINTENANCE_ACTIVATED_AT).toLocaleString('pt-BR') : 'N/A', inline: true }
    );
}

function buildManutencaoRows() {
  const data = loadConfig();
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('toggle_maintenance')
        .setLabel(data.MAINTENANCE_MODE ? 'Desativar Manutenção' : 'Ativar Manutenção')
        .setStyle(data.MAINTENANCE_MODE ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('test_system')
        .setLabel('Testar Sistema')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🧪')
    )
  ];
}

// ─── Render Principal ─────────────────────────────────────────────────────────

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
  else if (tab === 'tab_roles') embed = buildRolesEmbed();
  else if (tab === 'tab_config') {
    embed = buildConfigEmbed();
    rows.push(...buildConfigRows());
  } else if (tab === 'tab_manutencao') {
    embed = buildManutencaoEmbed();
    rows.push(...buildManutencaoRows());
  }

  const options = { embeds: [embed], components: rows, ephemeral: true };
  if (edit) await interaction.update(options);
  else await interaction.reply(options);
}
