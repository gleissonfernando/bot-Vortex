const {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { isGerencia } = require('../../utils/permissions');
const { sendUpdateLog, notifyError } = require('../../utils/notifications');
const {
  isMaintenanceMode,
  enableMaintenance,
  disableMaintenance,
  sendMaintenanceAlert,
  notifyAllStaffMembers,
  sendMaintenanceLog,
} = require('../../utils/maintenanceManager');

// ─── Caminhos dos arquivos de configuração ────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const STATS_PATH = path.join(__dirname, '..', 'stats.json');
// ─── Scheduler de mensagens automáticas ─────────────────────────────────────────────
const {
  sendBomdiaMessage,
  sendTodoMundoOnMessage,
  buildBomdiaEmbed: schedulerBomdiaEmbed,
  buildTodoMundoOnEmbed,
  addScheduledMessage,
  removeScheduledMessage,
  listScheduledMessages,
  isSchedulerAtivo,
  setSchedulerAtivo,
  CANAL_AUTO_ID,
  CARGO_MENCAO_ID,
  CARGO_BOM_DIA_ID,
  CARGO_DEV_ID,
} = require('../../utils/scheduler');
const AUTO_MSG_CHANNEL_ID = CANAL_AUTO_ID;
const AUTO_MSG_ROLE_ID    = CARGO_BOM_DIA_ID;
// Cargo dev que pode gerenciar mensagens automáticas
const DEV_CARGO_ID = CARGO_DEV_ID;
// ─── Helpers ──────────────────────────────────────────────────────────────────
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      const defaults = {
        STAFF_ROLES: [],
        STAFF_CHANNEL_ID: '',
        CARGO_MORADOR_ID: '',
        CARGO_MEMBRO_ID: '',
        CATEGORY_ID: '',
        MAINTENANCE_MODE: true,
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
      return defaults;
    }
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error('Erro ao carregar config:', err);
    return { STAFF_ROLES: [], STAFF_CHANNEL_ID: '1497703127074345040', CARGO_MORADOR_ID: '1201235607549124639', CARGO_MEMBRO_ID: '1201235607549124639', CATEGORY_ID: '1497749211775766538', MAINTENANCE_MODE: false };
  }
}

function saveConfig(data) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Erro ao salvar config:', err);
  }
}

function loadStats() {
  try {
    if (!fs.existsSync(STATS_PATH)) {
      const defaults = { pendentes: 0, aprovados: 0, recusados: 0 };
      fs.writeFileSync(STATS_PATH, JSON.stringify(defaults, null, 2));
      return defaults;
    }
    return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
  } catch (err) {
    console.error('Erro ao carregar stats:', err);
    return { pendentes: 0, aprovados: 0, recusados: 0 };
  }
}

// ─── Builders de cada aba ─────────────────────────────────────────────────────

function buildTabRow(activeTab) {
  const tabs = [
    { id: 'tab_stats',        label: 'Estatísticas',  emoji: '📊' },
    { id: 'tab_roles',        label: 'Cargos Staff',  emoji: '🛡️' },
    { id: 'tab_config',       label: 'Configurações', emoji: '⚙️' },
    { id: 'tab_manutencao',   label: 'Manutenção',    emoji: '🔧' },
    { id: 'tab_mensagens',    label: 'Mensagens',     emoji: '💬' },
  ];

  // Discord permite no máximo 5 botões por linha
  const row = new ActionRowBuilder();
  for (const t of tabs) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(t.id)
        .setLabel(t.label)
        .setEmoji(t.emoji)
        .setStyle(t.id === activeTab ? ButtonStyle.Primary : ButtonStyle.Secondary),
    );
  }
  return row;
}

// ─── ABA: Estatísticas ────────────────────────────────────────────────────────

function buildStatsEmbed() {
  const stats = loadStats();
  const total = stats.pendentes + stats.aprovados + stats.recusados;

  return new EmbedBuilder()
    .setTitle('📊  Painel de Controle — Central de Estatísticas')
    .setColor(0x5865F2)
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/1162/1162456.png')
    .setDescription(
      '### 📈 Resumo Geral\n' +
      'Acompanhe o desempenho do recrutamento em tempo real.\n\n' +
      `> **Total de Fichas:** \`${total}\``
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
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('test_system_btn')
      .setLabel('Testar Sistema')
      .setEmoji('🧪')
      .setStyle(ButtonStyle.Danger)
  );
  return [row];
}

// ─── ABA: Cargos Staff ────────────────────────────────────────────────────────

function buildRolesEmbed() {
  const config = loadConfig();
  const roles = config.STAFF_ROLES ?? [];

  const desc = roles.length === 0
    ? '⚠️ *Nenhum cargo autorizado foi configurado ainda.*'
    : roles.map(id => `> 🛡️ <@&${id}> \`(${id})\``).join('\n');

  return new EmbedBuilder()
    .setTitle('🛡️  Painel de Controle — Gestão de Acessos')
    .setColor(0xED4245)
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/1062/1062630.png')
    .setDescription(
      '### 👥 Permissões de Staff\n' +
      'Os cargos listados abaixo possuem permissão para **Aprovar** ou **Reprovar** recrutamentos.\n\n' +
      desc
    )
    .setFooter({ text: 'Vortex Management System • Segurança' })
    .setTimestamp();
}

function buildRolesRows() {
  const manageRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('add_role_btn')
      .setLabel('Adicionar Cargo')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('list_roles_btn')
      .setLabel('Lista & Remover')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('remove_role_modal_btn')
      .setLabel('Remover por ID')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger),
  );
  return [manageRow];
}

// ─── ABA: Configurações ───────────────────────────────────────────────────────

function buildConfigEmbed() {
  const config = loadConfig();
  const val = v => (v ? `<#${v}> \`(${v})\`` : '`⚠️ não definido`');
  const valRole = v => (v ? `<@&${v}> \`(${v})\`` : '`⚠️ não definido`');
  const valCat = v => (v ? `📂 \`${v}\`` : '`⚠️ não definido`');

  return new EmbedBuilder()
    .setTitle('⚙️  Painel de Controle — Configurações Gerais')
    .setColor(0xFEE75C)
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/900/900618.png')
    .setDescription(
      '### 🛠️ Ajustes do Sistema\n' +
      'Configure os canais e cargos fundamentais para o funcionamento do bot.\n\n' +
      `**📢 Canal de Solicitações:**\n> ${val(config.STAFF_CHANNEL_ID)}\n\n` +
      `**🏠 Cargo Morador:**\n> ${valRole(config.CARGO_MORADOR_ID)}\n\n` +
      `**👤 Cargo Membro:**\n> ${valRole(config.CARGO_MEMBRO_ID)}\n\n` +
      `**📁 Categoria dos Canais:**\n> ${valCat(config.CATEGORY_ID)}`
    )
    .setFooter({ text: 'Vortex Management System • Configurações' })
    .setTimestamp();
}

function buildConfigRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('edit_staff_channel')
      .setLabel('Canal Staff')
      .setEmoji('📢')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('edit_cargo_morador')
      .setLabel('Cargo Morador')
      .setEmoji('🏠')
      .setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('edit_cargo_membro')
      .setLabel('Cargo Membro')
      .setEmoji('👤')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('edit_category')
      .setLabel('Categoria')
      .setEmoji('📁')
      .setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2];
}

// ─── ABA: Manutenção ──────────────────────────────────────────────────────────

function buildManutencaoEmbed() {
  const manutencao = isMaintenanceMode();
  const config = loadConfig();

  const statusText = manutencao
    ? '🔴 **ATIVO** — O bot está em modo de manutenção. Todas as interações de usuários estão bloqueadas.'
    : '🟢 **INATIVO** — O bot está operando normalmente.';

  const ativadoPor = config.MAINTENANCE_ACTIVATED_BY
    ? `<@${config.MAINTENANCE_ACTIVATED_BY}>`
    : '`N/A`';

  const ativadoEm = config.MAINTENANCE_ACTIVATED_AT
    ? `<t:${Math.floor(new Date(config.MAINTENANCE_ACTIVATED_AT).getTime() / 1000)}:R>`
    : '`N/A`';

  return new EmbedBuilder()
    .setTitle('🔧  Painel de Controle — Modo Manutenção')
    .setColor(manutencao ? 0xED4245 : 0x57F287)
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/2920/2920349.png')
    .setDescription(
      '### 🛠️ Controle de Manutenção\n' +
      'Quando o modo de manutenção está ativo, qualquer interação de usuários comuns com o bot retornará uma mensagem informando que o bot está em manutenção.\n\n' +
      `**Status Atual:**\n> ${statusText}\n\n` +
      `**Última ativação por:** ${ativadoPor}\n` +
      `**Ativado:** ${ativadoEm}`
    )
    .addFields(
      {
        name: '📋 Como funciona',
        value: '> Ao ativar, usuários sem cargo de staff que tentarem usar o bot receberão uma mensagem de manutenção com botão para chamar suporte.',
        inline: false
      }
    )
    .setFooter({ text: 'Vortex Management System • Manutenção' })
    .setTimestamp();
}

function buildManutencaoRows() {
  const manutencao = isMaintenanceMode();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('toggle_manutencao_btn')
      .setLabel(manutencao ? '✅ Desativar Manutenção' : '🔴 Ativar Manutenção')
      .setEmoji(manutencao ? '🟢' : '🔴')
      .setStyle(manutencao ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('alert_manutencao_btn')
      .setLabel('🚨 Enviar Alerta para Devs')
      .setEmoji('🚨')
      .setStyle(ButtonStyle.Secondary),
  );

  return [row];
}

// ─── ABA: Mensagens ─────────────────────────────────────────────────────
function buildMensagensEmbed() {
  const schedulerOn = isSchedulerAtivo();
  const msgs = listScheduledMessages();

  const diasNomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  let listaMsgs = '';
  if (msgs.length === 0) {
    listaMsgs = '> _Nenhuma mensagem personalizada cadastrada._';
  } else {
    listaMsgs = msgs.map((m, i) => {
      const diasStr = Array.isArray(m.dias)
        ? (m.dias.includes('escolha') ? 'os dias' : m.dias.map(d => diasNomes[d]).join(', '))
        : 'Todos os dias';
      return `**${i + 1}. ${m.hora}** | ${diasStr} | <#${m.canal_id}>\n> ${m.texto.slice(0, 60)}${m.texto.length > 60 ? '...' : ''}`;
    }).join('\n\n');
  }

  return new EmbedBuilder()
    .setTitle('💬  Painel de Controle — Central de Mensagens')
    .setColor(0x5865F2)
    .setDescription(
      `### 🤖 Status do Agendador: ${schedulerOn ? '🟢 **Ativo**' : '🔴 **Pausado**'}\n\n` +
      `**📢 Canal fixo de mensagens automáticas:** <#${AUTO_MSG_CHANNEL_ID}>\n` +
      `**🏷️ Cargo mencionado (Todo Mundo On):** <@&${CARGO_MENCAO_ID}>\n` +
      `**☀️ Cargo mencionado (Bom Dia):** <@&${AUTO_MSG_ROLE_ID}>\n\n` +
      `**🕒 Mensagens Fixas:**\n` +
      `> 🌅 **Bom Dia** — 08:00 BRT todos os dias — <#${AUTO_MSG_CHANNEL_ID}>\n` +
      `> 🟢 **Todo Mundo On** — 18:00 BRT (Seg–Sex) — <#${AUTO_MSG_CHANNEL_ID}>\n\n` +
      `**📝 Mensagens Personalizadas (${msgs.length}):**\n${listaMsgs}`
    )
    .setFooter({ text: 'Vortex Management System • Mensagens | Somente DEV pode ativar/desativar' })
    .setTimestamp();
}

function buildMensagensRows(member) {
  const isDev = member && member.roles && member.roles.cache.has(DEV_CARGO_ID);
  const schedulerOn = isSchedulerAtivo();

  // Linha 1: Envio manual + testes
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('send_msg_canal_btn')
      .setLabel('Enviar Mensagem em Canal')
      .setEmoji('📤')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('test_bomdia_btn')
      .setLabel('Testar Bom Dia')
      .setEmoji('🌅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('test_todoMundoOn_btn')
      .setLabel('Testar Todo Mundo On')
      .setEmoji('🟢')
      .setStyle(ButtonStyle.Success),
  );

  // Linha 2: Gerenciar mensagens (só DEV)
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('add_auto_msg_btn')
      .setLabel('Adicionar Mensagem Programada')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isDev),
    new ButtonBuilder()
      .setCustomId('remove_auto_msg_btn')
      .setLabel('Remover Mensagem')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!isDev),
  );

  // Linha 3: Ativar/Desativar agendador (só DEV)
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('toggle_scheduler_btn')
      .setLabel(schedulerOn ? 'Pausar Mensagens Automáticas' : 'Iniciar Mensagens Automáticas')
      .setEmoji(schedulerOn ? '⏸️' : '▶️')
      .setStyle(schedulerOn ? ButtonStyle.Danger : ButtonStyle.Success)
      .setDisabled(!isDev),
  );

  return [row1, row2, row3];
}

// ─── Render Principal ─────────────────────────────────────────────────────────

async function renderTab(interaction, tab, edit = false) {
  let embed;
  let extraRows;

  if (tab === 'tab_stats') {
    embed = buildStatsEmbed();
    extraRows = buildStatsRows();
  } else if (tab === 'tab_roles') {
    embed = buildRolesEmbed();
    extraRows = buildRolesRows();
  } else if (tab === 'tab_manutencao') {
    embed = buildManutencaoEmbed();
    extraRows = buildManutencaoRows();
  } else if (tab === 'tab_mensagens') {
    embed = buildMensagensEmbed();
    extraRows = buildMensagensRows(interaction.member);
  } else {
    embed = buildConfigEmbed();
    extraRows = buildConfigRows();
  }

  const tabRow = buildTabRow(tab);
  const components = [tabRow, ...extraRows];

  try {
    if (edit) {
      await interaction.editReply({ embeds: [embed], components });
    } else {
      await interaction.reply({ embeds: [embed], components, ephemeral: true });
    }
  } catch (error) {
    console.error(`Erro ao renderizar aba ${tab}:`, error);
  }
}

function canUsePanel(interaction) {
  return isGerencia(interaction);
}

// ─── Função para construir a mensagem de Bom Dia ──────────────────────────────

function buildBomdiaMessage() {
  const now = new Date();
  const hora = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  const data = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

  const embed = new EmbedBuilder()
    .setTitle('🌅  Bom Dia, Vortex!')
    .setColor(0xFEE75C)
    .setDescription(
      `### ☀️ Bom dia a todos!\n\n` +
      `> Que hoje seja um dia incrível para toda a família **Vortex**!\n\n` +
      `📅 **${data}** — 🕐 ${hora}\n\n` +
      `<@&${AUTO_MSG_ROLE_ID}> — Bom dia a todos os membros! 🎉`
    )
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/869/869869.png')
    .setFooter({ text: 'Vortex — Bom Dia Automático' })
    .setTimestamp();

  return embed;
}

// ─── Módulo exportado ─────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Abre o painel de controle do bot Vortex.'),

  async execute(interaction) {
    if (!canUsePanel(interaction)) {
      await interaction.reply({
        content: '❌ **Acesso Negado:** Apenas a Staff autorizada pode acessar o painel de controle.',
        ephemeral: true
      });
      return;
    }
    await renderTab(interaction, 'tab_stats', false);
  },

  async handleButton(interaction) {
    const { customId, client } = interaction;

    if (!canUsePanel(interaction)) {
      await interaction.reply({
        content: '❌ **Acesso Negado:** Apenas a gerencia autorizada pode interagir com os controles administrativos.',
        ephemeral: true
      });
      return;
    }

    // ─── Navegação entre abas ──────────────────────────────────────────────────
    if (['tab_stats', 'tab_roles', 'tab_config', 'tab_manutencao', 'tab_mensagens'].includes(customId)) {
      await interaction.deferUpdate();
      return renderTab(interaction, customId, true);
    }

     // ─── Botão: Ativar/Desativar Manutenção ───────────────────────────────────
    if (customId === 'toggle_manutencao_btn') {
      await interaction.deferUpdate();
      const manutencaoAtiva = isMaintenanceMode();
      const guild = interaction.guild;

      if (manutencaoAtiva) {
        // ── Desativar ──
        disableMaintenance(interaction.user.id);

        // Log no canal + menção aos cargos
        await sendMaintenanceLog(client, guild, interaction.user.id, true);

        // DM para todos os membros com cargo staff
        const { enviados, falhas } = await notifyAllStaffMembers(client, guild, interaction.user.id, false);

        await interaction.followUp({
          content: `✅ **Manutenção Desativada:** O bot voltou a operar normalmente.\n📨 **${enviados}** membro(s) da staff foram notificados via DM.`,
          ephemeral: true
        });
      } else {
        // ── Ativar ──
        enableMaintenance(interaction.user.id);

        // Log no canal + menção aos cargos
        await sendMaintenanceLog(client, guild, interaction.user.id, true);

        // DM para todos os membros com cargo staff
        const { enviados, falhas } = await notifyAllStaffMembers(client, guild, interaction.user.id, true);

        await interaction.followUp({
          content: `🔧 **Manutenção Ativada:** O bot está agora em modo de manutenção.\n📨 **${enviados}** membro(s) da staff foram notificados via DM${falhas > 0 ? ` (${falhas} não puderam receber DM)` : ''}.`,
          ephemeral: true
        });
      }
      return renderTab(interaction, 'tab_manutencao', true);
    }

    // ─── Botão: Alerta para Devs ──────────────────────────────────────────────
    if (customId === 'alert_manutencao_btn') {
      const modal = new ModalBuilder()
        .setCustomId('modal_alert_devs')
        .setTitle('🚨 Enviar Alerta para Desenvolvedores');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('alert_message_input')
            .setLabel('Mensagem do Alerta')
            .setPlaceholder('Descreva o problema ou motivo do alerta...')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(500),
        ),
      );
      return interaction.showModal(modal);
    }

    // ─── Botão: Enviar Mensagem em Canal ──────────────────────────────────────
    if (customId === 'send_msg_canal_btn') {
      const modal = new ModalBuilder()
        .setCustomId('modal_send_msg_canal')
        .setTitle('📤 Enviar Mensagem em Canal');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('canal_id_input')
            .setLabel('ID do Canal')
            .setPlaceholder('Cole o ID do canal onde a mensagem será enviada')
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('mensagem_canal_input')
            .setLabel('Mensagem')
            .setPlaceholder('Digite a mensagem que o bot irá enviar...')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(2000),
        ),
      );
      return interaction.showModal(modal);
    }

    // ─── Botão: Testar Bom Dia ────────────────────────────────────────────
    if (customId === 'test_bomdia_btn') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const ok = await sendBomdiaMessage(client);
        if (!ok) return interaction.editReply({ content: `❌ **Erro:** Não encontrei o canal <#${AUTO_MSG_CHANNEL_ID}>. Verifique se o bot tem acesso.` });
        await sendUpdateLog(client, 'Teste Bom Dia', `Mensagem de bom dia enviada manualmente por <@${interaction.user.id}>.`, '#FEE75C');
        await interaction.editReply({ content: `✅ **Sucesso:** Mensagem de bom dia enviada em <#${AUTO_MSG_CHANNEL_ID}>!` });
      } catch (err) {
        await notifyError(client, err, 'Botão Testar Bom Dia');
        await interaction.editReply({ content: '❌ **Erro:** Ocorreu um erro ao enviar a mensagem de bom dia.' });
      }
      return;
    }
    // ─── Botão: Testar Todo Mundo On ──────────────────────────────────────
    if (customId === 'test_todoMundoOn_btn') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const ok = await sendTodoMundoOnMessage(client);
        if (!ok) return interaction.editReply({ content: `❌ **Erro:** Não encontrei o canal <#${AUTO_MSG_CHANNEL_ID}>. Verifique se o bot tem acesso.` });
        await sendUpdateLog(client, 'Teste Todo Mundo On', `Mensagem de todo mundo on enviada manualmente por <@${interaction.user.id}>.`, '#57F287');
        await interaction.editReply({ content: `✅ **Sucesso:** Mensagem de todo mundo on enviada em <#${AUTO_MSG_CHANNEL_ID}>!` });
      } catch (err) {
        await notifyError(client, err, 'Botão Testar Todo Mundo On');
        await interaction.editReply({ content: '❌ **Erro:** Ocorreu um erro ao enviar a mensagem.' });
      }
      return;
    }
    // ─── Botão: Ativar/Pausar Agendador (só DEV) ────────────────────────────
    if (customId === 'toggle_scheduler_btn') {
      if (!interaction.member.roles.cache.has(DEV_CARGO_ID)) {
        return interaction.reply({ content: '❌ **Acesso Negado:** Apenas desenvolvedores podem ativar/pausar as mensagens automáticas.', ephemeral: true });
      }
      await interaction.deferUpdate();
      const estaAtivo = isSchedulerAtivo();
      setSchedulerAtivo(!estaAtivo);
      const novoStatus = !estaAtivo;
      await sendUpdateLog(client,
        novoStatus ? '▶️ Mensagens Automáticas Iniciadas' : '⏸️ Mensagens Automáticas Pausadas',
        `O agendador foi **${novoStatus ? 'iniciado' : 'pausado'}** por <@${interaction.user.id}>.`,
        novoStatus ? '#57F287' : '#ED4245'
      );
      await interaction.followUp({
        content: novoStatus
          ? '▶️ **Mensagens automáticas iniciadas!** O bot vai enviar bom dia às 08:00 e todo mundo on às 18:00 (seg–sex).'
          : '⏸️ **Mensagens automáticas pausadas!** Nenhuma mensagem será enviada até ser reativado.',
        ephemeral: true
      });
      return renderTab(interaction, 'tab_mensagens', true);
    }
    // ─── Botão: Adicionar Mensagem Programada (só DEV) ───────────────────────
    if (customId === 'add_auto_msg_btn') {
      if (!interaction.member.roles.cache.has(DEV_CARGO_ID)) {
        return interaction.reply({ content: '❌ **Acesso Negado:** Apenas desenvolvedores podem adicionar mensagens programadas.', ephemeral: true });
      }
      const modal = new ModalBuilder()
        .setCustomId('modal_add_auto_msg')
        .setTitle('➕ Adicionar Mensagem Programada');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('auto_msg_canal')
            .setLabel('ID do Canal')
            .setPlaceholder('Cole o ID do canal onde a mensagem será enviada')
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('auto_msg_hora')
            .setLabel('Horário (HH:MM) — Horário de Brasília')
            .setPlaceholder('Ex: 09:00 ou 20:30')
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('auto_msg_dias')
            .setLabel('Dias da Semana')
            .setPlaceholder('todos | seg,ter,qua,qui,sex | dom,sab | seg,sex')
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('auto_msg_texto')
            .setLabel('Texto da Mensagem')
            .setPlaceholder('Digite a mensagem que o bot vai enviar...')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(2000),
        ),
      );
      return interaction.showModal(modal);
    }
    // ─── Botão: Remover Mensagem Programada (só DEV) ───────────────────────
    if (customId === 'remove_auto_msg_btn') {
      if (!interaction.member.roles.cache.has(DEV_CARGO_ID)) {
        return interaction.reply({ content: '❌ **Acesso Negado:** Apenas desenvolvedores podem remover mensagens programadas.', ephemeral: true });
      }
      const msgs = listScheduledMessages();
      if (msgs.length === 0) {
        return interaction.reply({ content: '❌ Não há mensagens programadas cadastradas.', ephemeral: true });
      }
      const select = new StringSelectMenuBuilder()
        .setCustomId('remove_auto_msg_select')
        .setPlaceholder('Selecione a mensagem para remover...')
        .setMinValues(1)
        .setMaxValues(1);
      msgs.forEach((m, i) => {
        const diasNomes = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        const diasStr = Array.isArray(m.dias)
          ? (m.dias.includes('todos') ? 'Todos os dias' : m.dias.map(d => diasNomes[d]).join(','))
          : 'Todos';
        select.addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(`${i + 1}. ${m.hora} | ${diasStr}`)
            .setDescription(m.texto.slice(0, 80))
            .setValue(m.id)
        );
      });
      const row = new ActionRowBuilder().addComponents(select);
      return interaction.reply({ content: '🗑️ Selecione a mensagem que deseja remover:', components: [row], ephemeral: true });
    }
    // ─── Botão: Adicionar Cargo ───────────────────────────────────────────────
    if (customId === 'add_role_btn') {
      const modal = new ModalBuilder()
        .setCustomId('modal_add_role')
        .setTitle('🛡️ Adicionar Cargo Autorizado');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('role_id_input')
            .setLabel('ID ou Menção do Cargo')
            .setPlaceholder('Cole o ID do cargo ou mencione @cargo')
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
      );
      return interaction.showModal(modal);
    }

    if (customId === 'list_roles_btn') {
      const config = loadConfig();
      const roles = config.STAFF_ROLES ?? [];

      if (roles.length === 0) {
        return interaction.reply({
          content: '📋 **Informação:** Não há cargos cadastrados no momento.',
          ephemeral: true
        });
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId('remove_role_select')
        .setPlaceholder('Selecione um cargo para remover...')
        .setMinValues(1)
        .setMaxValues(1);

      for (const id of roles) {
        const role = interaction.guild.roles.cache.get(id);
        const label = role ? role.name : `Cargo ID: ${id}`;
        select.addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(label)
            .setDescription(`Remover permissões do cargo ${id}`)
            .setValue(id)
            .setEmoji('🗑️')
        );
      }

      const row = new ActionRowBuilder().addComponents(select);

      return interaction.reply({
        content: '### 📋 Lista Interativa de Cargos\nSelecione um cargo no menu abaixo para **removê-lo** instantaneamente.',
        components: [row],
        ephemeral: true
      });
    }

    if (customId === 'remove_role_modal_btn') {
      const modal = new ModalBuilder()
        .setCustomId('modal_remove_role')
        .setTitle('🗑️ Remover Cargo Autorizado');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('role_id_remove_input')
            .setLabel('ID do Cargo para Remover')
            .setPlaceholder('Insira o ID numérico do cargo')
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
      );
      return interaction.showModal(modal);
    }

    // ─── Botão: Teste do Sistema ──────────────────────────────────────────────
    if (customId === 'test_system_btn') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const testEmbed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('🧪 Teste de Sistema')
          .setDescription('Esta é uma mensagem de teste enviada via Painel Administrativo.')
          .addFields({ name: 'Solicitado por', value: `${interaction.user.tag} (\`${interaction.user.id}\`)` })
          .setTimestamp();

        await interaction.user.send({ embeds: [testEmbed] });
        await sendUpdateLog(client, 'Teste de Sistema Executado', `O usuário <@${interaction.user.id}> executou um teste de sistema.`, '#FEE75C');
        await interaction.editReply({ content: '✅ **Sucesso:** A mensagem de teste foi enviada para o seu privado.' });
      } catch (err) {
        await interaction.editReply({ content: '❌ **Erro:** Não consegui enviar a mensagem para o seu privado. Verifique se suas DMs estão abertas.' });
        await notifyError(client, err, 'Botão de Teste do Sistema');
      }
      return;
    }

    const configModalMap = {
      edit_staff_channel: { modalId: 'modal_edit_staff_channel', title: '📢 Canal de Solicitações', label: 'Novo ID do Canal', placeholder: 'Ex: 1497685937868505129' },
      edit_cargo_morador: { modalId: 'modal_edit_cargo_morador', title: '🏠 Cargo Morador', label: 'Novo ID do Cargo', placeholder: 'Ex: 1490151003864043570' },
      edit_cargo_membro: { modalId: 'modal_edit_cargo_membro', title: '👤 Cargo Membro', label: 'Novo ID do Cargo', placeholder: 'Ex: 1490151003864043570' },
      edit_category: { modalId: 'modal_edit_category', title: '📁 Categoria dos Canais', label: 'Novo ID da Categoria', placeholder: 'Ex: 1497684838352949319' },
    };

    if (configModalMap[customId]) {
      const m = configModalMap[customId];
      const modal = new ModalBuilder().setCustomId(m.modalId).setTitle(m.title);
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('config_value_input')
            .setLabel(m.label)
            .setPlaceholder(m.placeholder)
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
      );
      return interaction.showModal(modal);
    }
  },

  async handleSelectMenu(interaction) {
    // ─── Select: Remover Mensagem Programada ───────────────────────────────────
    if (interaction.customId === 'remove_auto_msg_select') {
      if (!interaction.member.roles.cache.has(DEV_CARGO_ID)) {
        return interaction.reply({ content: '❌ **Acesso Negado:** Apenas desenvolvedores podem remover mensagens programadas.', ephemeral: true });
      }
      const msgId = interaction.values[0];
      removeScheduledMessage(msgId);
      await interaction.update({
        content: `✅ **Mensagem programada removida com sucesso!**`,
        components: [],
      });
      await sendUpdateLog(interaction.client, '🗑️ Mensagem Programada Removida',
        `<@${interaction.user.id}> removeu a mensagem programada com ID \`${msgId}\`.`
      );
      return;
    }
    if (interaction.customId === 'remove_role_select') {
      if (!canUsePanel(interaction)) {
        return interaction.reply({ content: '❌ Você não tem permissão.', ephemeral: true });
      }

      const roleId = interaction.values[0];
      const config = loadConfig();

      config.STAFF_ROLES = (config.STAFF_ROLES ?? []).filter(r => r !== roleId);
      saveConfig(config);

      await interaction.update({
        content: `✅ **Sucesso:** O cargo <@&${roleId}> foi removido das permissões.`,
        components: [],
      });

      await sendUpdateLog(interaction.client, 'Configuração Alterada', `O cargo <@&${roleId}> foi **removido** da lista de staff autorizada por <@${interaction.user.id}>.`);
    }
  },

  async handleModal(interaction) {
    const { customId, fields, client } = interaction;

    if (!canUsePanel(interaction)) {
      await interaction.reply({ content: '❌ **Erro:** Você não tem permissão para realizar esta ação.', ephemeral: true });
      return;
    }

    const config = loadConfig();

    // ─── Modal: Alerta para Devs ──────────────────────────────────────────────
    if (customId === 'modal_alert_devs') {
      const alertMsg = fields.getTextInputValue('alert_message_input').trim();

      await interaction.deferReply({ ephemeral: true });

      const { sendMaintenanceAlert } = require('../../utils/maintenanceManager');
      const { DEV_NOTIFY_USERS } = require('../../utils/maintenanceManager');
      const { EmbedBuilder } = require('discord.js');

      let enviados = 0;
      for (const userId of DEV_NOTIFY_USERS) {
        try {
          const user = await client.users.fetch(userId).catch(() => null);
          if (user) {
            const embed = new EmbedBuilder()
              .setColor('#FF6B00')
              .setTitle('🚨 Alerta Enviado pela Staff')
              .setDescription(alertMsg)
              .addFields(
                { name: 'Enviado por', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Servidor', value: interaction.guild?.name || 'N/A', inline: true }
              )
              .setTimestamp();
            await user.send({ embeds: [embed] });
            enviados++;
          }
        } catch (err) {
          console.error(`Erro ao enviar alerta para ${userId}:`, err);
        }
      }

      await sendUpdateLog(client, 'Alerta Enviado para Devs', `<@${interaction.user.id}> enviou um alerta para os desenvolvedores:\n> ${alertMsg}`, '#FF6B00');
      await interaction.editReply({ content: `✅ **Alerta enviado!** Notificação enviada para **${enviados}** desenvolvedor(es) via DM.` });
      return;
    }

    // ─── Modal: Enviar Mensagem em Canal ──────────────────────────────────────
    if (customId === 'modal_send_msg_canal') {
      const canalId = fields.getTextInputValue('canal_id_input').replace(/[<#>]/g, '').trim();
      const mensagem = fields.getTextInputValue('mensagem_canal_input').trim();

      if (!/^\d+$/.test(canalId)) {
        return interaction.reply({ content: '❌ **Erro:** O ID do canal deve conter apenas números.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        const canal = await client.channels.fetch(canalId).catch(() => null);
        if (!canal) {
          return interaction.editReply({ content: `❌ **Erro:** Canal \`${canalId}\` não encontrado. Verifique o ID e se o bot tem acesso.` });
        }

        await canal.send({ content: mensagem });

        await sendUpdateLog(client, 'Mensagem Enviada via Painel', `<@${interaction.user.id}> enviou uma mensagem no canal <#${canalId}>:\n> ${mensagem.slice(0, 200)}${mensagem.length > 200 ? '...' : ''}`, '#5865F2');
        await interaction.editReply({ content: `✅ **Sucesso:** Mensagem enviada com sucesso em <#${canalId}>!` });
      } catch (err) {
        await notifyError(client, err, 'Modal Enviar Mensagem em Canal');
        await interaction.editReply({ content: '❌ **Erro:** Não foi possível enviar a mensagem. Verifique as permissões do bot no canal.' });
      }
      return;
    }

       // ─── Modal: Adicionar Mensagem Programada ──────────────────────────────
    if (customId === 'modal_add_auto_msg') {
      if (!interaction.member.roles.cache.has(DEV_CARGO_ID)) {
        return interaction.reply({ content: '❌ **Acesso Negado:** Apenas desenvolvedores podem adicionar mensagens programadas.', ephemeral: true });
      }
      const canalId  = fields.getTextInputValue('auto_msg_canal').replace(/[<#>]/g, '').trim();
      const horaRaw  = fields.getTextInputValue('auto_msg_hora').trim();
      const diasRaw  = fields.getTextInputValue('auto_msg_dias').trim().toLowerCase();
      const texto    = fields.getTextInputValue('auto_msg_texto').trim();

      // Valida canal
      if (!/^\d+$/.test(canalId)) {
        return interaction.reply({ content: '❌ O ID do canal deve conter apenas números.', ephemeral: true });
      }
      // Valida horário
      if (!/^\d{1,2}:\d{2}$/.test(horaRaw)) {
        return interaction.reply({ content: '❌ Horário inválido. Use o formato HH:MM (ex: 09:00).', ephemeral: true });
      }
      const [h, m] = horaRaw.split(':').map(Number);
      if (h > 23 || m > 59) {
        return interaction.reply({ content: '❌ Horário inválido. Horas: 0-23, Minutos: 0-59.', ephemeral: true });
      }
      const horaFmt = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;

      // Converte dias
      const mapaDias = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, 's\u00e1b': 6, sab: 6 };
      let diasArr;
      if (diasRaw === 'todos') {
        diasArr = ['todos'];
      } else {
        diasArr = diasRaw.split(',').map(d => mapaDias[d.trim()]).filter(d => d !== undefined);
        if (diasArr.length === 0) {
          return interaction.reply({ content: '❌ Dias inválidos. Use: todos, seg, ter, qua, qui, sex, dom, sáb', ephemeral: true });
        }
      }

      const novaMsg = {
        id: `msg_${Date.now()}`,
        canal_id: canalId,
        hora: horaFmt,
        dias: diasArr,
        texto,
        embed: false,
        criado_por: interaction.user.id,
        criado_em: new Date().toISOString()
      };

      addScheduledMessage(novaMsg);

      await interaction.deferUpdate();
      await renderTab(interaction, 'tab_mensagens', true);
      await sendUpdateLog(client, '➕ Mensagem Programada Adicionada',
        `<@${interaction.user.id}> adicionou uma mensagem programada:\n` +
        `**Canal:** <#${canalId}> | **Horário:** ${horaFmt} | **Dias:** ${diasArr.join(',')}`
      );
      await interaction.followUp({
        content: `✅ **Mensagem programada adicionada!**\n🕒 Será enviada às **${horaFmt}** (BRT) nos dias: **${diasArr.includes('todos') ? 'Todos os dias' : diasArr.join(', ')}** no canal <#${canalId}>.`,
        ephemeral: true
      });
      return;
    }
    // ─── Modal: Adicionar Cargo ────────────────────────────────────────────
    if (customId === 'modal_add_role') {
      let roleId = fields.getTextInputValue('role_id_input').replace(/[<@&>]/g, '').trim();

      if (!/^\d+$/.test(roleId)) {
        return interaction.reply({ content: '❌ **Erro:** O ID do cargo deve conter apenas números.', ephemeral: true });
      }

      if (!config.STAFF_ROLES) config.STAFF_ROLES = [];
      if (!config.STAFF_ROLES.includes(roleId)) {
        config.STAFF_ROLES.push(roleId);
        saveConfig(config);
        await interaction.deferUpdate();
        await renderTab(interaction, 'tab_roles', true);

        await sendUpdateLog(client, 'Configuração Alterada', `O cargo <@&${roleId}> foi **adicionado** à lista de staff autorizada por <@${interaction.user.id}>.`);
        return interaction.followUp({ content: `✅ **Sucesso:** Cargo <@&${roleId}> adicionado com sucesso!`, ephemeral: true });
      } else {
        return interaction.reply({ content: '⚠️ **Aviso:** Este cargo já está na lista de autorizados.', ephemeral: true });
      }
    }

    // ─── Modal: Remover Cargo ─────────────────────────────────────────────────
    if (customId === 'modal_remove_role') {
      let roleId = fields.getTextInputValue('role_id_remove_input').replace(/[<@&>]/g, '').trim();

      if (!config.STAFF_ROLES || !config.STAFF_ROLES.includes(roleId)) {
        return interaction.reply({ content: '❌ **Erro:** Este ID de cargo não foi encontrado na lista.', ephemeral: true });
      }

      config.STAFF_ROLES = config.STAFF_ROLES.filter(r => r !== roleId);
      saveConfig(config);
      await interaction.deferUpdate();
      await renderTab(interaction, 'tab_roles', true);

      await sendUpdateLog(client, 'Configuração Alterada', `O cargo <@&${roleId}> foi **removido** da lista de staff autorizada por <@${interaction.user.id}>.`);
      return interaction.followUp({ content: '✅ **Sucesso:** O cargo foi removido das permissões.', ephemeral: true });
    }

    // ─── Modais de Configuração ───────────────────────────────────────────────
    const configUpdateMap = {
      modal_edit_staff_channel: '1497703127074345040',
      modal_edit_cargo_morador: '1497703127074345040',
      modal_edit_cargo_membro: '1497703127074345040',
      modal_edit_category: '1497703127074345040',
    };

    if (configUpdateMap[customId]) {
      const key = configUpdateMap[customId];
      const value = fields.getTextInputValue('config_value_input').trim();

      if (!/^\d+$/.test(value)) {
        return interaction.reply({ content: '❌ **Erro:** O ID deve conter apenas números.', ephemeral: true });
      }

      const oldValue = config[key];
      config[key] = value;
      saveConfig(config);
      await interaction.deferUpdate();
      await renderTab(interaction, 'tab_config', true);

      await sendUpdateLog(client, 'Configuração Alterada', `A configuração **${key}** foi alterada de \`${oldValue || 'vazio'}\` para \`${value}\` por <@${interaction.user.id}>.`);
      return interaction.followUp({ content: `✅ **Sucesso:** Configuração atualizada com sucesso!`, ephemeral: true });
    }
  },

  // Expõe a função buildBomdiaMessage para uso externo (agendador)
  buildBomdiaMessage,
  AUTO_MSG_CHANNEL_ID,
  AUTO_MSG_ROLE_ID,
};
