const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ChannelSelectMenuBuilder, 
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const STATS_PATH = path.join(__dirname, '..', 'stats.json');
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
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
  data: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('VORTEX MANAGEMENT SYSTEM - Painel de Controle'),

  async execute(interaction) {
    if (!hasStaffPermission(interaction.member)) {
      return interaction.reply({ content: '❌ Você não tem acesso a este painel.', ephemeral: true });
    }
    return renderDashboard(interaction, 'tab_stats');
  },

  async handleButton(interaction) {
    if (!hasStaffPermission(interaction.member)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
    
    const customId = interaction.customId;
    const conf = loadJSON(CONFIG_PATH);

    if (customId.startsWith('tab_')) {
      return renderDashboard(interaction, customId, true);
    }
    
    if (customId === 'toggle_maint') {
      conf.MAINTENANCE_MODE = !conf.MAINTENANCE_MODE;
      conf.MAINTENANCE_BY = String(interaction.user.id);
      conf.MAINTENANCE_SINCE = Date.now();
      saveJSON(CONFIG_PATH, conf);
      return renderDashboard(interaction, 'tab_manutencao', true);
    }

    if (customId === 'test_notice') {
        return interaction.reply({
            content: '⚠️ **O bot está em manutenção. Tente novamente mais tarde.**',
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Chamar Suporte').setStyle(ButtonStyle.Link).setURL('https://discord.gg/vortex'))],
            ephemeral: true
        });
    }

    if (customId === 'reg_role' || customId === 'rem_role') {
        const modal = new ModalBuilder()
            .setCustomId(customId === 'reg_role' ? 'modal_reg_role' : 'modal_rem_role')
            .setTitle(customId === 'reg_role' ? 'Registrar Cargo Staff' : 'Remover Cargo Staff');
        
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('role_id')
                .setLabel('ID DO CARGO')
                .setPlaceholder('Cole o ID do cargo aqui')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
        ));
        
        return interaction.showModal(modal);
    }
  },

  async handleSelectMenu(interaction) {
    if (!hasStaffPermission(interaction.member)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
    
    const data = loadJSON(CONFIG_PATH);
    if (interaction.customId === 'select_log') {
        data.LOG_CHANNEL = String(interaction.values[0]);
        saveJSON(CONFIG_PATH, data);
        return renderDashboard(interaction, 'tab_config', true);
    }
  },

  async handleModal(interaction) {
    if (!hasStaffPermission(interaction.member)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
    
    const data = loadJSON(CONFIG_PATH);
    if (!data.STAFF_ROLES) data.STAFF_ROLES = [];
    const roleId = interaction.fields.getTextInputValue('role_id');

    if (interaction.customId === 'modal_reg_role') {
        if (!data.STAFF_ROLES.includes(roleId)) {
            data.STAFF_ROLES.push(roleId);
            saveJSON(CONFIG_PATH, data);
            await interaction.reply({ content: `✅ Cargo <@&${roleId}> registrado como Staff!`, ephemeral: true });
        } else {
            await interaction.reply({ content: '❌ Este cargo já está registrado.', ephemeral: true });
        }
    } else if (interaction.customId === 'modal_rem_role') {
        data.STAFF_ROLES = data.STAFF_ROLES.filter(id => id !== roleId);
        saveJSON(CONFIG_PATH, data);
        await interaction.reply({ content: `✅ Cargo <@&${roleId}> removido da Staff.`, ephemeral: true });
    }
  }
};

async function renderDashboard(interaction, tab, edit = false) {
  const stats = loadJSON(STATS_PATH);
  const conf = loadJSON(CONFIG_PATH);
  const guild = interaction.guild;
  
  const embed = new EmbedBuilder()
    .setTimestamp()
    .setFooter({ text: `Vortex Management System - ${String(tab).replace('tab_', '').toUpperCase()}` });

  const mainRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tab_stats').setLabel('📊 Estatísticas').setStyle(tab === 'tab_stats' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tab_roles').setLabel('🛡️ Cargos Staff').setStyle(tab === 'tab_roles' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tab_config').setLabel('⚙️ Configurações').setStyle(tab === 'tab_config' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tab_manutencao').setLabel('🔧 Manutenção').setStyle(tab === 'tab_manutencao' ? ButtonStyle.Primary : ButtonStyle.Secondary)
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
  } else if (tab === 'tab_roles') {
    embed.setAuthor({ name: '🛡️ VORTEX | GESTÃO DE ACESSOS', iconURL: guild.iconURL() || null })
      .setColor('#5865F2')
      .setDescription('### 🔐 Controle de Cargos Staff\n\n' + 
                      'Nesta aba você pode gerenciar os cargos que possuem acesso às funções administrativas do bot.\n\n' +
                      '**👑 Administrador Master:** <@&1497703127074345040>\n\n' +
                      '*Os cargos registrados abaixo têm permissão para usar o /painel e gerenciar o /set.*')
      .setFooter({ text: 'Vortex Management System • Gestão de Acessos' });

    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('reg_role').setLabel('🛡️ Registrar Cargo').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('rem_role').setLabel('❌ Remover Cargo').setStyle(ButtonStyle.Secondary)
    ));
  } else if (tab === 'tab_manutencao') {
    const since = conf.MAINTENANCE_SINCE ? `<t:${Math.floor(conf.MAINTENANCE_SINCE / 1000)}:R>` : 'N/A';
    embed.setAuthor({ name: '🛠️ Painel de Controle — Modo Manutenção', iconURL: guild.iconURL() || null })
      .setColor(conf.MAINTENANCE_MODE ? '#FF0055' : '#3498DB')
      .setDescription('### 🔧 Controle de Manutenção\n\n' + 
                      `**🔴 Status Atual:** ${conf.MAINTENANCE_MODE ? '🔴 ATIVO' : '🟢 DESATIVADO'}\n` +
                      `**👤 Ativado por:** <@${conf.MAINTENANCE_BY || 'N/A'}>\n` +
                      `**🕒 Tempo:** ${since}\n\n` +
                      '**🔐 Permissões Master:** <@&1497703127074345040>')
      .addFields({ name: '✅ Liberados', value: '`/painel`, `/set` (Staff)', inline: true });

    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('toggle_maint').setLabel(conf.MAINTENANCE_MODE ? '🟢 Desativar Manutenção' : '🔴 Ativar Manutenção').setStyle(conf.MAINTENANCE_MODE ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('test_notice').setLabel('🧪 Testar Aviso').setStyle(ButtonStyle.Secondary)
    ));
  } else if (tab === 'tab_config') {
    embed.setTitle('⚙️ CONFIGURAÇÕES').setColor('#00D9FF');
    rows.push(new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId('select_log').setPlaceholder('Selecione o Canal de Logs').addChannelTypes(ChannelType.GuildText)
    ));
  }

  const options = { embeds: [embed], components: rows, ephemeral: true };
  if (edit) {
    return interaction.update(options).catch(err => console.log('Erro ao atualizar painel:', err));
  } else {
    return interaction.reply(options).catch(err => console.log('Erro ao enviar painel:', err));
  }
}
