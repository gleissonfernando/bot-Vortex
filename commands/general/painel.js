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
  return { STAFF_ROLES: [], MAINTENANCE_MODE: false, LOG_CHANNEL: null, RECRUITMENT_CATEGORY: null };
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

    // Lógica do botão de manutenção (Restrito)
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

    // Botão de Teste de Sistema (Agora dentro de Manutenção)
    if (interaction.customId === 'test_system') {
      if (!member.roles.cache.has(SUPERIOR_ID)) {
        return interaction.reply({ content: '❌ Apenas a Gerência Superior pode realizar testes.', ephemeral: true });
      }
      await interaction.reply({ content: '🧪 **VORTEX | TESTE DE SISTEMA**\n\n🔍 Analisando módulos...\n✅ Conexão Discord API\n✅ Permissões Administrativas\n✅ Banco de Dados JSON\n✅ Fluxo de Logs\n\n✨ **Sistema operando 100%!**', ephemeral: true });
      return;
    }

    // Botão para abrir Modal de Configuração de Canal
    if (interaction.customId === 'open_channel_modal') {
      if (!member.roles.cache.has(SUPERIOR_ID)) {
        return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
      }
      
      const modal = new ModalBuilder()
        .setCustomId('modal_config_channel')
        .setTitle('Configurar Canal de Texto');

      const channelInput = new TextInputBuilder()
        .setCustomId('channel_id_input')
        .setLabel('ID do Canal')
        .setPlaceholder('Cole o ID do canal onde a mensagem será enviada')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const firstActionRow = new ActionRowBuilder().addComponents(channelInput);
      modal.addComponents(firstActionRow);

      await interaction.showModal(modal);
      return;
    }
  },

  async handleModal(interaction) {
    if (interaction.customId === 'modal_config_channel') {
      const channelId = interaction.fields.getTextInputValue('channel_id_input');
      
      // Validar se o canal existe
      const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) {
        return interaction.reply({ content: '❌ ID de canal inválido ou o canal não é de texto.', ephemeral: true });
      }

      const data = loadConfig();
      data.LOG_CHANNEL = channelId;
      saveConfig(data);

      await interaction.reply({ content: `✅ Canal de logs configurado com sucesso: <#${channelId}>`, ephemeral: true });
      await renderTab(interaction, 'tab_config', true);
    }
  },

  async handleSelectMenu(interaction) {
    if (interaction.customId === 'select_log_channel_scroll') {
      if (!interaction.member.roles.cache.has(SUPERIOR_ID)) {
        return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
      }
      const channelId = interaction.values[0];
      const data = loadConfig();
      data.LOG_CHANNEL = channelId;
      saveConfig(data);
      await interaction.reply({ content: `✅ Canal atualizado via menu: <#${channelId}>`, ephemeral: true });
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
    .setTitle('📊 VORTEX | CENTRAL DE ESTATÍSTICAS')
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
    .setFooter({ text: 'Vortex Management System' })
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
    .setTitle('🛡️ VORTEX | CONFIGURAÇÃO DE CARGOS')
    .setColor(0xFEE75C)
    .setDescription('Visualize os cargos principais vinculados ao sistema Vortex.')
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

// ─── ABA: Configuração ───────────────────────────────────────────────────────

function buildConfigEmbed() {
  const data = loadConfig();
  return new EmbedBuilder()
    .setTitle('⚙️ VORTEX | CONFIGURAÇÕES DE CANAIS')
    .setColor(0x3498DB)
    .setDescription('Escolha como deseja configurar os canais de texto do sistema.\n\n**Opção 1:** Usar o Menu de Rolagem abaixo.\n**Opção 2:** Clicar no botão para inserir o ID manualmente.')
    .addFields(
      { name: 'Canal de Logs Atual', value: data.LOG_CHANNEL ? `<#${data.LOG_CHANNEL}>` : '`Não configurado`', inline: true }
    );
}

function buildConfigRows() {
  const selectLog = new ChannelSelectMenuBuilder()
    .setCustomId('select_log_channel_scroll')
    .setPlaceholder('Selecione um canal (Menu com Rolagem)')
    .addChannelTypes(ChannelType.GuildText);

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tab_stats').setLabel('Estatísticas').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tab_roles').setLabel('Cargos').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tab_config').setLabel('Configuração').setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId('tab_manutencao').setLabel('Manutenção').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('open_channel_modal')
        .setLabel('Configurar por ID (Modal)')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📝')
    ),
    new ActionRowBuilder().addComponents(selectLog)
  ];
}

// ─── ABA: Manutenção ─────────────────────────────────────────────────────────

function buildManutencaoEmbed() {
  const data = loadConfig();
  const status = data.MAINTENANCE_MODE ? '🔴 ATIVADO (Sistema Bloqueado)' : '🟢 DESATIVADO (Sistema Online)';
  
  return new EmbedBuilder()
    .setTitle('🔧 VORTEX | MODO DE MANUTENÇÃO')
    .setColor(data.MAINTENANCE_MODE ? 0xED4245 : 0x57F287)
    .setDescription(`O modo de manutenção bloqueia o acesso de usuários comuns ao sistema.\n\n**Status Atual:** \`${status}\``)
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
