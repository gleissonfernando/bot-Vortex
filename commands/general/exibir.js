const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { safeReply, safeUpdate } = require('../../utils/safeReply');

const EXIBIR_OWNER_ID = '1426287249020158018';

const PANEL_CARDS = [
  { key: 'dashboard', label: 'Dashboard', emoji: '📊', color: '#7000FF', summary: 'Visão geral do servidor, cadastros e acessos.' },
  { key: 'roles', label: 'Cargos Vortex', emoji: '🛡️', color: '#5865F2', summary: 'Níveis de acesso e cargos automáticos.' },
  { key: 'config', label: 'Configurações', emoji: '⚙️', color: '#00D9FF', summary: 'Ajustes gerais, logs e permissões.' },
  { key: 'points', label: 'Pontos', emoji: '🕒', color: '#ED4245', summary: 'Folhas, ajustes e automação de ponto.' },
  { key: 'absence', label: 'Ausências', emoji: '📆', color: '#7000FF', summary: 'Cargo, retorno e fluxo de ausência.' },
  { key: 'commands', label: 'Comandos', emoji: '⌨️', color: '#00D9FF', summary: 'Permissões de uso por comando.' },
  { key: 'logs', label: 'Logs', emoji: '🧾', color: '#00D9FF', summary: 'Canal principal e logs filtrados.' },
  { key: 'messages', label: 'Mensagens', emoji: '💬', color: '#005DFF', summary: 'Mensagens convertidas em painel anônimo.' },
  { key: 'faction', label: 'Hierarquia FAC', emoji: '🏛️', color: '#7000FF', summary: 'Hierarquia da fac atualizada automaticamente.' },
  { key: 'profiles', label: 'Perfis', emoji: '👤', color: '#00D9FF', summary: 'Perfis, cobranças e links do usuário.' },
  { key: 'maintenance', label: 'Manutenção', emoji: '🛠️', color: '#FF0055', summary: 'Modo manutenção e avisos do sistema.' },
  { key: 'reports', label: 'Relatórios', emoji: '📑', color: '#22c55e', summary: 'Relatórios de ponto e transcript web.' },
];

function isOwner(interaction) {
  return String(interaction.user?.id || '') === EXIBIR_OWNER_ID;
}

function getPanelCard(key) {
  return PANEL_CARDS.find((panel) => panel.key === key) || PANEL_CARDS[0];
}

function buildOverviewEmbed(interaction) {
  return new EmbedBuilder()
    .setColor('#005DFF')
    .setAuthor({
      name: 'VORTEX | EXIBIÇÃO',
      iconURL: interaction.guild?.iconURL?.() || interaction.client.user.displayAvatarURL(),
    })
    .setTitle('Painéis da Vortex')
    .setDescription([
      'A Vortex organiza seus sistemas em painéis de controle para administração, ponto, perfis, ausências e automações.',
      '',
      'Selecione um painel para ver o resumo do que ele faz.',
    ].join('\n'))
    .addFields(
      ...PANEL_CARDS.map((panel) => ({
        name: `${panel.emoji} ${panel.label}`,
        value: panel.summary,
        inline: true,
      })),
      {
        name: 'Como funciona',
        value: 'O sistema junta o painel do Discord com relatórios web, logs automáticos e configurações centralizadas no `/painel`.',
        inline: false,
      }
    )
    .setFooter({ text: `Solicitado por ${interaction.user.tag}` })
    .setTimestamp();
}

function buildPanelEmbed(interaction, panelKey) {
  const panel = getPanelCard(panelKey);
  return new EmbedBuilder()
    .setColor(panel.color)
    .setAuthor({
      name: `VORTEX | ${panel.label.toUpperCase()}`,
      iconURL: interaction.guild?.iconURL?.() || interaction.client.user.displayAvatarURL(),
    })
    .setTitle(`${panel.emoji} ${panel.label}`)
    .setDescription([
      panel.summary,
      '',
      'A Vortex usa esse painel para centralizar o fluxo operacional e manter tudo controlado pelo Discord.',
      '',
      'Use o seletor para trocar para outro painel de apresentação.',
    ].join('\n'))
    .addFields(
      { name: 'Objetivo', value: panel.summary, inline: false },
      { name: 'Categoria', value: panel.label, inline: true },
      { name: 'Identificação', value: `\`${panel.key}\``, inline: true }
    )
    .setFooter({ text: 'Vortex • Exibição de painéis' })
    .setTimestamp();
}

function buildComponents(panelKey = null) {
  const currentKey = panelKey || PANEL_CARDS[0].key;
  const select = new StringSelectMenuBuilder()
    .setCustomId('exibir_panel_select:1426287249020158018')
    .setPlaceholder('Escolha um painel da Vortex')
    .addOptions(PANEL_CARDS.map((panel) => ({
      label: panel.label,
      value: panel.key,
      description: panel.summary.slice(0, 100),
      emoji: panel.emoji,
      default: panel.key === currentKey,
    })));

  return [new ActionRowBuilder().addComponents(select)];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('exibir')
    .setDescription('Exibe os painéis e a apresentação da Vortex.')
    .setDMPermission(false),

  async execute(interaction) {
    if (!isOwner(interaction)) {
      return safeReply(interaction, {
        content: '❌ Você não tem permissão para usar este comando.',
        ephemeral: true,
      });
    }

    return safeReply(interaction, {
      embeds: [buildOverviewEmbed(interaction)],
      components: buildComponents(),
      ephemeral: true,
    });
  },

  async handleSelectMenu(interaction) {
    const [customBase, ownerId] = String(interaction.customId || '').split(':');
    if (customBase !== 'exibir_panel_select' || ownerId !== EXIBIR_OWNER_ID) return null;
    if (!isOwner(interaction)) {
      return safeReply(interaction, {
        content: '❌ Você não tem permissão para usar este seletor.',
        ephemeral: true,
      });
    }

    const selectedKey = interaction.values[0];
    const panel = getPanelCard(selectedKey);
    return safeUpdate(interaction, {
      embeds: [buildPanelEmbed(interaction, panel.key)],
      components: buildComponents(panel.key),
    });
  },
};
