const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require('discord.js');

const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');

const PANEL_THEME_TARGETS = [
  { key: 'global', label: 'Todos os painéis', description: 'Padrao usado quando o painel nao tem estilo proprio' },
  { key: 'painel', label: '/painel', description: 'Painel administrativo principal' },
  { key: 'set', label: '/set', description: 'Painel de cadastro' },
  { key: 'avisos', label: '/avisos', description: 'Painel e mensagens de avisos' },
  { key: 'mirrorMessages', label: 'Mensagens em painel', description: 'Mensagens reenviadas pelo bot nos canais ativados' },
  { key: 'ausencia', label: '/ausencia', description: 'Painel de ausencia' },
  { key: 'exibir', label: '/exibir', description: 'Apresentacao dos paineis' },
  { key: 'facHierarchy', label: 'Hierarquia FAC', description: 'Painel automatico de cargos' },
  { key: 'bau', label: 'Bau', description: 'Painel de estoque dos membros e gerencia' },
];

const DEFAULT_VISUALS = {
  color: '#7000FF',
  bannerUrl: '',
  bannerRatio: '16:9',
};

function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function normalizeHexColor(value, fallback = '') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const hex = raw.replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return fallback;
  return `#${hex.toUpperCase()}`;
}

function parseColor(value, fallback = 0x7000FF) {
  const color = normalizeHexColor(value);
  return color ? parseInt(color.slice(1), 16) : fallback;
}

function normalizeBannerRatio(value, fallback = '16:9') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  const match = text.match(/^(\d{1,3})\s*[:xX/]\s*(\d{1,3})$/);
  if (!match) return fallback;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return fallback;
  return `${width}:${height}`;
}

function normalizeBannerUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^attachment:\/\/[^\s/\\]+$/i.test(text)) return text;
  if (/^https?:\/\/\S+$/i.test(text)) return text;
  return '';
}

function ensurePanelVisuals(config = readConfig()) {
  if (!config.PANEL_VISUALS || typeof config.PANEL_VISUALS !== 'object') {
    config.PANEL_VISUALS = {};
  }

  if (!config.PANEL_VISUALS.defaults || typeof config.PANEL_VISUALS.defaults !== 'object') {
    config.PANEL_VISUALS.defaults = {};
  }

  config.PANEL_VISUALS.defaults.color = normalizeHexColor(config.PANEL_VISUALS.defaults.color, DEFAULT_VISUALS.color);
  config.PANEL_VISUALS.defaults.bannerUrl = normalizeBannerUrl(config.PANEL_VISUALS.defaults.bannerUrl);
  config.PANEL_VISUALS.defaults.bannerRatio = normalizeBannerRatio(config.PANEL_VISUALS.defaults.bannerRatio, DEFAULT_VISUALS.bannerRatio);

  if (!config.PANEL_VISUALS.targets || typeof config.PANEL_VISUALS.targets !== 'object') {
    config.PANEL_VISUALS.targets = {};
  }

  for (const target of PANEL_THEME_TARGETS.filter((item) => item.key !== 'global')) {
    const current = config.PANEL_VISUALS.targets[target.key];
    if (!current || typeof current !== 'object') {
      config.PANEL_VISUALS.targets[target.key] = {};
      continue;
    }

    if (current.color !== undefined) current.color = normalizeHexColor(current.color, '');
    if (current.bannerUrl !== undefined) current.bannerUrl = normalizeBannerUrl(current.bannerUrl);
    if (current.bannerRatio !== undefined) current.bannerRatio = normalizeBannerRatio(current.bannerRatio, '');
  }

  return config.PANEL_VISUALS;
}

function getPanelTargetMeta(targetKey) {
  return PANEL_THEME_TARGETS.find((target) => target.key === targetKey) || PANEL_THEME_TARGETS[0];
}

function getPanelVisualTheme(targetKey = 'global', config = readConfig()) {
  const visuals = ensurePanelVisuals(config);
  const defaults = visuals.defaults;
  const target = targetKey === 'global' ? {} : (visuals.targets[targetKey] || {});

  return {
    key: targetKey,
    color: normalizeHexColor(target.color, defaults.color),
    bannerUrl: target.bannerUrl !== undefined ? normalizeBannerUrl(target.bannerUrl) : defaults.bannerUrl,
    bannerRatio: target.bannerRatio !== undefined ? normalizeBannerRatio(target.bannerRatio, defaults.bannerRatio) : defaults.bannerRatio,
    hasOwnColor: Boolean(target.color),
    hasOwnBanner: target.bannerUrl !== undefined && target.bannerUrl !== '',
    hasOwnRatio: Boolean(target.bannerRatio),
  };
}

function setPanelVisualTheme(targetKey, patch = {}) {
  const key = PANEL_THEME_TARGETS.some((target) => target.key === targetKey) ? targetKey : 'global';
  const config = readConfig();
  const visuals = ensurePanelVisuals(config);
  const target = key === 'global'
    ? visuals.defaults
    : (visuals.targets[key] = visuals.targets[key] || {});

  if (Object.prototype.hasOwnProperty.call(patch, 'color')) {
    const color = normalizeHexColor(patch.color, '');
    if (color) target.color = color;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'bannerUrl')) {
    const bannerUrl = normalizeBannerUrl(patch.bannerUrl);
    target.bannerUrl = bannerUrl;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'bannerRatio')) {
    target.bannerRatio = normalizeBannerRatio(patch.bannerRatio, target.bannerRatio || visuals.defaults.bannerRatio);
  }

  writeConfig(config);
  return getPanelVisualTheme(key, config);
}

function clearPanelVisualTheme(targetKey) {
  const key = PANEL_THEME_TARGETS.some((target) => target.key === targetKey) ? targetKey : 'global';
  const config = readConfig();
  const visuals = ensurePanelVisuals(config);

  if (key === 'global') {
    visuals.defaults = { ...DEFAULT_VISUALS };
  } else {
    visuals.targets[key] = {};
  }

  writeConfig(config);
  return getPanelVisualTheme(key, config);
}

function getEmbedData(view) {
  if (!view) return {};
  if (typeof view.toJSON === 'function') return view.toJSON();
  return view;
}

function splitPanelText(text, maxLength = 3600) {
  const source = String(text || '').trim();
  if (!source) return [];
  const chunks = [];
  let remaining = source;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf('\n\n', maxLength);
    if (splitAt < maxLength * 0.55) splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt < maxLength * 0.55) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function formatFields(fields = []) {
  return fields
    .filter((field) => field?.name)
    .map((field) => {
      const value = String(field.value || 'N/A').trim() || 'N/A';
      return `**${field.name}**\n${value}`;
    })
    .join('\n\n');
}

function normalizeRows(rows = []) {
  return rows
    .filter(Boolean)
    .map((row) => {
      if (row instanceof ActionRowBuilder) return row;
      return row;
    });
}

function buildThemedPanelPayload(targetKey, view, options = {}) {
  const data = getEmbedData(view);
  const theme = getPanelVisualTheme(targetKey);
  const color = parseColor(theme.color, data.color || DEFAULT_VISUALS.color);
  const titleParts = [
    data.author?.name,
    data.title,
  ].filter(Boolean);
  const title = titleParts.length ? titleParts.join(' | ') : getPanelTargetMeta(targetKey).label;
  const description = [
    options.headerText,
    data.description,
  ].filter(Boolean).join('\n\n');
  const fieldText = formatFields(data.fields);
  const footerText = data.footer?.text || options.footerText || null;
  const bannerUrl = options.bannerUrl !== undefined ? normalizeBannerUrl(options.bannerUrl) : theme.bannerUrl;
  const components = normalizeRows(options.components);
  const container = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${title}`));

  if (bannerUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(bannerUrl)
          .setDescription(`Banner ${theme.bannerRatio || DEFAULT_VISUALS.bannerRatio}`)
      )
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  const maxChunks = Math.max(1, 10 - (2 + (bannerUrl ? 1 : 0) + (footerText ? 2 : 0)));
  const chunks = [
    ...splitPanelText(description),
    ...splitPanelText(fieldText),
  ].slice(0, maxChunks);

  for (const chunk of chunks) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk));
  }

  if (footerText) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footerText}`));
  }

  return {
    components: [container, ...components],
    flags: MessageFlags.IsComponentsV2 | (options.ephemeral ? MessageFlags.Ephemeral : 0),
    allowedMentions: options.allowedMentions || { parse: [] },
    embeds: [],
    files: options.files || [],
    attachments: options.attachments || [],
  };
}

module.exports = {
  PANEL_THEME_TARGETS,
  DEFAULT_VISUALS,
  clearPanelVisualTheme,
  ensurePanelVisuals,
  getPanelTargetMeta,
  getPanelVisualTheme,
  normalizeBannerRatio,
  normalizeBannerUrl,
  normalizeHexColor,
  parseColor,
  setPanelVisualTheme,
  buildThemedPanelPayload,
};
