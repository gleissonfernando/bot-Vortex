const navItems = [
  ['overview', 'Visao geral', '/dashboard'],
  ['bot', 'Bot Vortex', '/dashboard/bot-vortex'],
  ['security', 'Anti-Abuso', '/dashboard/anti-abuse'],
  ['orders', 'Encomendas', '/dashboard/orders'],
  ['lives', 'Lives', '/dashboard/lives'],
  ['members', 'Membros', '/dashboard/members'],
  ['bau', 'Bau', '/dashboard/bau'],
  ['absences', 'Ausencias', '/dashboard/absences'],
];

const state = {
  route: 'overview',
  user: null,
  runtime: null,
  apiHealth: null,
  data: {},
  loading: false,
};

const el = {
  loginView: document.getElementById('login-view'),
  appView: document.getElementById('app-view'),
  loginAlert: document.getElementById('login-alert'),
  loginForm: document.getElementById('login-form'),
  discordLogin: document.getElementById('discord-login'),
  sideNav: document.getElementById('side-nav'),
  logout: document.getElementById('logout'),
  healthPill: document.getElementById('health-pill'),
  userPill: document.getElementById('user-pill'),
  viewTitle: document.getElementById('view-title'),
  content: document.getElementById('content'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? new Intl.NumberFormat('pt-BR').format(number) : '0';
}

function formatMoneyCents(value, currency = 'BRL') {
  const number = Number(value || 0) / 100;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(number);
}

function formatDate(value) {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('pt-BR');
}

function formatHours(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
}

function routeFromPath(pathname = window.location.pathname) {
  if (pathname.startsWith('/dashboard/bot-vortex')) return 'bot';
  if (pathname.startsWith('/dashboard/anti-abuse')) return 'security';
  if (pathname.startsWith('/dashboard/orders')) return 'orders';
  if (pathname.startsWith('/dashboard/lives')) return 'lives';
  if (pathname.startsWith('/dashboard/members')) return 'members';
  if (pathname.startsWith('/dashboard/bau')) return 'bau';
  if (pathname.startsWith('/dashboard/absences')) return 'absences';
  return 'overview';
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { ok: false, error: text.slice(0, 240) };
  }
  if (!response.ok) {
    const error = new Error(body?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function api(path, options = {}) {
  return request(`/api${path}`, {
    ...options,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
}

async function settle(map) {
  const entries = await Promise.all(Object.entries(map).map(async ([key, task]) => {
    try {
      return [key, { ok: true, value: await task() }];
    } catch (error) {
      return [key, { ok: false, error }];
    }
  }));
  return Object.fromEntries(entries);
}

function setVisible(target, visible) {
  target.hidden = !visible;
}

function setLoginAlert(message) {
  if (!message) {
    el.loginAlert.hidden = true;
    el.loginAlert.textContent = '';
    return;
  }
  el.loginAlert.textContent = message;
  el.loginAlert.hidden = false;
}

function showLogin(message = '') {
  setVisible(el.loginView, true);
  setVisible(el.appView, false);
  setLoginAlert(message || new URLSearchParams(window.location.search).get('error') || '');
}

function showApp() {
  setVisible(el.loginView, false);
  setVisible(el.appView, true);
}

function renderNav() {
  el.sideNav.innerHTML = navItems.map(([id, label, href]) => `
    <a class="nav-item ${state.route === id ? 'active' : ''}" href="${href}" data-route="${id}">
      <span>${label}</span>
    </a>
  `).join('');
}

function setHealth(runtime, apiHealth) {
  const runtimeOk = runtime?.ok === true;
  const apiOk = apiHealth?.ok === true;
  el.healthPill.className = `status-pill ${runtimeOk && apiOk ? 'ok' : runtimeOk || apiOk ? 'warn' : 'bad'}`;
  el.healthPill.textContent = runtimeOk && apiOk ? 'online' : runtimeOk || apiOk ? 'parcial' : 'offline';
}

function setUser(user) {
  const name = user?.name || user?.displayName || user?.email || user?.id || 'usuario';
  el.userPill.textContent = name;
}

async function loadSession() {
  const health = await settle({
    runtime: () => request('/health'),
    apiHealth: () => request('/api/health'),
  });
  state.runtime = health.runtime.value || null;
  state.apiHealth = health.apiHealth.value || null;
  setHealth(health.runtime.value, health.apiHealth.value);

  try {
    const me = await api('/auth/me');
    state.user = me.user;
    setUser(state.user);
    showApp();
    return true;
  } catch (error) {
    state.user = null;
    if (window.location.pathname !== '/login') {
      history.replaceState(null, '', '/login');
    }
    showLogin(error.status === 401 ? '' : error.message);
    return false;
  }
}

async function loadData() {
  state.loading = true;
  renderLoading();
  const results = await settle({
    metrics: () => api('/dashboard/metrics'),
    bot: () => api('/bot-vortex'),
    members: () => api('/members?limit=12'),
    lives: () => api('/lives'),
    liveOptions: () => api('/lives/discord-options'),
    orders: () => api('/orders?limit=12'),
    families: () => api('/orders/families'),
    inventory: () => api('/orders/inventory'),
    bau: () => api('/bau'),
    absences: () => api('/absences?limit=20'),
  });
  state.data = Object.fromEntries(Object.entries(results).map(([key, result]) => [key, result.ok ? result.value : { ok: false, error: result.error.message }]));
  state.loading = false;
}

function renderLoading() {
  el.content.innerHTML = '<div class="empty">Carregando dados do painel...</div>';
}

function renderError(message) {
  el.content.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
}

function stat(label, value, hint = '') {
  return `<section class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${hint ? `<small class="muted">${escapeHtml(hint)}</small>` : ''}</section>`;
}

function tag(value, type = 'ok') {
  return `<span class="tag ${type}">${escapeHtml(value)}</span>`;
}

function panel(title, body, action = '') {
  return `<section class="panel"><div class="toolbar"><h2>${escapeHtml(title)}</h2>${action}</div>${body}</section>`;
}

function rows(items, empty, renderItem) {
  if (!items?.length) return `<div class="empty">${escapeHtml(empty)}</div>`;
  return `<div class="rows">${items.map(renderItem).join('')}</div>`;
}

function table(headers, items, empty, renderItem) {
  if (!items?.length) return `<div class="empty">${escapeHtml(empty)}</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
        <tbody>${items.map(renderItem).join('')}</tbody>
      </table>
    </div>
  `;
}

function renderOverview() {
  const metrics = state.data.metrics?.metrics || {};
  const bot = state.data.bot || {};
  const lives = state.data.lives?.stats || {};
  const orders = state.data.orders?.stats || {};
  const maintenance = bot.maintenance || {};
  const runtimeConfig = state.runtime?.config || {};
  const runtimeChildren = state.data.bot?.ok ? 'API conectada' : 'API sem dados';

  return `
    <div class="grid stats">
      ${stat('Membros', formatNumber(metrics.total_members), `${formatNumber(metrics.active_members)} ativos`)}
      ${stat('Pontos abertos', formatNumber(metrics.open_points))}
      ${stat('Horas no mes', formatHours(metrics.month_seconds))}
      ${stat('Lives monitoradas', formatNumber(lives.totalMonitored))}
      ${stat('Encomendas', formatNumber(orders.totalOrders || orders.total || 0))}
      ${stat('Bau', formatNumber((state.data.bau?.chests || []).reduce((sum, chest) => sum + Number(chest.totalQuantity || 0), 0)), 'itens totais')}
      ${stat('Modo manutencao', maintenance.enabled ? 'Ativo' : 'Livre')}
      ${stat('Runtime', runtimeChildren)}
    </div>
    <div class="grid two">
      ${panel('Atividade recente', rows(state.data.metrics?.activity || [], 'Nenhuma atividade recente.', (item) => `
        <div class="row"><div><strong>${escapeHtml(item.title || item.action || 'Evento')}</strong><small>${escapeHtml(item.description || item.actor || '')}</small></div><small>${escapeHtml(formatDate(item.at || item.created_at))}</small></div>
      `))}
      ${panel('Operacao', `
        <div class="list">
          <div class="row"><div><strong>Bot Discord</strong><small>${escapeHtml(runtimeConfig.hasDiscordToken ? 'Token configurado' : 'Confira o token na hospedagem')}</small></div>${tag(bot.ok ? 'conectado' : 'indisponivel', bot.ok ? 'ok' : 'bad')}</div>
          <div class="row"><div><strong>Banco</strong><small>${escapeHtml(runtimeConfig.hasMongoDb ? 'MongoDB configurado' : 'Modo fallback')}</small></div>${tag(runtimeConfig.hasMongoDb ? 'ok' : 'warn', runtimeConfig.hasMongoDb ? 'ok' : 'warn')}</div>
          <div class="row"><div><strong>Manutencao</strong><small>${escapeHtml(maintenance.message || 'Sistema liberado')}</small></div>${tag(maintenance.enabled ? 'ativo' : 'livre', maintenance.enabled ? 'warn' : 'ok')}</div>
        </div>
      `)}
    </div>
  `;
}

function renderBot() {
  const bot = state.data.bot || {};
  const config = bot.config || {};
  const tools = bot.tools || [];
  return `
    <div class="grid two">
      ${panel('Controles principais', `
        <div class="list">
          <div class="row"><div><strong>Modo manutencao</strong><small>Bloqueia comandos, botoes e automacoes do bot.</small></div><button class="secondary" data-action="toggle-maintenance" type="button">${config.MAINTENANCE_MODE ? 'Desligar' : 'Ligar'}</button></div>
          <div class="row"><div><strong>Logs por canal</strong><small>DISABLE_CHANNEL_LOGS=${escapeHtml(config.DISABLE_CHANNEL_LOGS)}</small></div>${tag(config.DISABLE_CHANNEL_LOGS ? 'desligado' : 'ativo', config.DISABLE_CHANNEL_LOGS ? 'warn' : 'ok')}</div>
          <div class="row"><div><strong>Painel privado</strong><small>PANEL_PRIVATE_MODE=${escapeHtml(config.PANEL_PRIVATE_MODE)}</small></div>${tag(config.PANEL_PRIVATE_MODE ? 'privado' : 'normal', config.PANEL_PRIVATE_MODE ? 'warn' : 'ok')}</div>
        </div>
      `)}
      ${panel('Ferramentas', rows(tools, 'Nenhuma ferramenta carregada.', (tool) => `
        <div class="row"><div><strong>${escapeHtml(tool.label)}</strong><small>${escapeHtml(tool.description)}</small></div><span class="code">${escapeHtml(tool.id)}</span></div>
      `))}
    </div>
  `;
}

function renderSecurity() {
  const bot = state.data.bot || {};
  const config = bot.config?.ANTI_ABUSE || {};
  const protections = Object.entries(config.protections || {});
  const canManage = bot.permissions?.canManageAntiAbuse;
  return `
    <div class="grid two">
      ${panel('Anti-Abuso', `
        <div class="list">
          <div class="row"><div><strong>Status geral</strong><small>Modo blindado controlado pelo backend.</small></div>${canManage ? `<button class="secondary" data-action="toggle-anti-abuse" type="button">${config.enabled ? 'Desligar' : 'Ligar'}</button>` : tag(config.enabled ? 'ativo' : 'inativo', config.enabled ? 'ok' : 'warn')}</div>
          <div class="row"><div><strong>Anti desconectar</strong><small>shieldedDisconnect=${escapeHtml(config.shieldedDisconnect)}</small></div>${tag(config.shieldedDisconnect ? 'blindado' : 'padrao', config.shieldedDisconnect ? 'ok' : 'warn')}</div>
          <div class="row"><div><strong>Whitelist de cargos</strong><small>${escapeHtml((config.whitelist?.roles || []).join(', ') || 'nenhum cargo')}</small></div><span>${formatNumber((config.whitelist?.roles || []).length)}</span></div>
        </div>
      `)}
      ${panel('Protecoes', rows(protections, 'Nenhuma protecao configurada.', ([key, value]) => `
        <div class="row"><div><strong>${escapeHtml(key)}</strong><small>Punicao: ${escapeHtml(value.punishment || 'log')}</small></div>${tag(value.enabled ? 'ativo' : 'off', value.enabled ? 'ok' : 'warn')}</div>
      `))}
    </div>
    ${panel('Historico Anti-Abuso', table(['Acao', 'Alvo', 'Quando'], bot.antiAbuseHistory || [], 'Sem eventos recentes.', (item) => `
      <tr><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.target_id || '-')}</td><td>${escapeHtml(formatDate(item.created_at))}</td></tr>
    `))}
  `;
}

function renderOrders() {
  const orders = state.data.orders || {};
  const families = state.data.families?.families || [];
  const inventory = state.data.inventory?.inventory || [];
  return `
    <div class="grid stats">
      ${stat('Pedidos', formatNumber(orders.stats?.totalOrders || orders.orders?.length || 0))}
      ${stat('Pendentes', formatNumber(orders.stats?.pending || 0))}
      ${stat('Familias', formatNumber(families.length))}
      ${stat('Estoque ativo', formatNumber(inventory.length))}
    </div>
    ${panel('Encomendas recentes', table(['ID', 'Familia', 'Status', 'Valor'], orders.orders || [], 'Nenhuma encomenda encontrada.', (order) => `
      <tr><td>#${escapeHtml(order.orderNumber || order.id || '-')}</td><td>${escapeHtml(order.familyName || '-')}</td><td>${escapeHtml(order.status || '-')}</td><td>${escapeHtml(formatMoneyCents(order.finalValueCents ?? order.totalValueCents ?? 0, order.currency || 'BRL'))}</td></tr>
    `), '<button class="secondary" data-action="export-orders" type="button">Exportar CSV</button>')}
    <div class="grid two">
      ${panel('Familias', rows(families.slice(0, 8), 'Nenhuma familia cadastrada.', (family) => `
        <div class="row"><div><strong>${escapeHtml(family.name)}</strong><small>${escapeHtml(family.leaderName || 'Sem lider')}</small></div>${tag(family.active ? 'ativa' : 'inativa', family.active ? 'ok' : 'warn')}</div>
      `))}
      ${panel('Estoque', rows(inventory.slice(0, 8), 'Nenhum item no estoque.', (item) => `
        <div class="row"><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category || 'item')}</small></div><span>${formatNumber(item.quantityAvailable)}</span></div>
      `))}
    </div>
  `;
}

function renderLives() {
  const lives = state.data.lives || {};
  const options = state.data.liveOptions || {};
  return `
    <div class="grid two">
      ${panel('Cadastrar live', `
        <form id="live-form" class="form-grid">
          <label class="full">URL ou usuario<input name="url" placeholder="https://www.twitch.tv/canal" required></label>
          <label>Canal de alerta${selectFrom('discordChannelId', options.channels || [], 'Selecione um canal')}</label>
          <label>Cargo mencionado${selectFrom('discordRoleId', options.roles || [], '@everyone ou sem cargo', true)}</label>
          <button class="primary full" type="submit">Salvar live</button>
          ${options.error ? `<p class="muted full">${escapeHtml(options.error)}</p>` : ''}
        </form>
      `)}
      ${panel('Resumo', `
        <div class="grid stats">
          ${stat('Monitoradas', formatNumber(lives.stats?.totalMonitored || 0))}
          ${stat('Detectadas hoje', formatNumber(lives.stats?.detectedToday || 0))}
          ${stat('Plataformas', formatNumber(lives.stats?.connectedPlatforms || 0))}
          ${stat('Ultimo envio', formatDate(lives.stats?.lastLiveSent))}
        </div>
      `)}
    </div>
    ${panel('Lives cadastradas', rows(lives.lives || [], 'Nenhuma live cadastrada.', (live) => `
      <div class="row"><div><strong>${escapeHtml(live.streamerName || live.channelUrl)}</strong><small>${escapeHtml(live.channelUrl || '')}</small></div>${tag(live.lastStatus || 'unknown', live.lastStatus === 'online' ? 'ok' : 'warn')}</div>
    `))}
  `;
}

function selectFrom(name, items, placeholder, optional = false) {
  return `
    <select name="${name}" ${optional ? '' : 'required'}>
      <option value="">${escapeHtml(placeholder)}</option>
      ${items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || item.label || item.id)}</option>`).join('')}
    </select>
  `;
}

function renderMembers() {
  const members = state.data.members?.members || [];
  return panel('Membros sincronizados', table(['Membro', 'Cargo', 'Status', 'Tempo'], members, 'Nenhum membro sincronizado.', (member) => `
    <tr>
      <td><strong>${escapeHtml(member.display_name || member.username || member.discord_user_id || member.id)}</strong><br><small>${escapeHtml(member.discord_user_id || member.id || '')}</small></td>
      <td>${escapeHtml(member.role || member.primary_role || '-')}</td>
      <td>${escapeHtml(member.status || '-')}</td>
      <td>${escapeHtml(formatHours(member.month_seconds || member.total_seconds || 0))}</td>
    </tr>
  `));
}

function renderBau() {
  const bau = state.data.bau || {};
  return `
    <div class="grid two">
      ${(bau.chests || []).map((chest) => panel(chest.label || chest.id, `
        <p class="muted">${escapeHtml(chest.description || '')}</p>
        <div class="grid stats">
          ${stat('Itens', formatNumber(chest.totalItems))}
          ${stat('Quantidade', formatNumber(chest.totalQuantity))}
        </div>
        ${rows((chest.items || []).slice(0, 12), 'Bau vazio.', (item) => `
          <div class="row"><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(formatDate(item.updatedAt || item.createdAt))}</small></div><span>${formatNumber(item.quantity)}</span></div>
        `)}
      `)).join('')}
    </div>
    ${panel('Eventos do bau', table(['Usuario', 'Acao', 'Quando'], bau.events || [], 'Nenhum evento de bau.', (event) => `
      <tr><td>${escapeHtml(event.actorName || event.userTag || '-')}</td><td>${escapeHtml(event.action || event.type || '-')}</td><td>${escapeHtml(formatDate(event.createdAt || event.at))}</td></tr>
    `))}
  `;
}

function renderAbsences() {
  const absences = state.data.absences || {};
  return `
    <div class="grid stats">
      ${stat('Total', formatNumber(absences.metrics?.total || 0))}
      ${stat('Ativas', formatNumber(absences.metrics?.active || 0))}
      ${stat('Agendadas', formatNumber(absences.metrics?.scheduled || 0))}
      ${stat('Pendentes', formatNumber(absences.metrics?.pending || 0))}
    </div>
    ${panel('Ausencias', table(['Usuario', 'Status', 'Inicio', 'Fim'], absences.records || absences.active || [], 'Nenhuma ausencia registrada.', (absence) => `
      <tr><td>${escapeHtml(absence.userName || absence.userId || '-')}</td><td>${escapeHtml(absence.status || '-')}</td><td>${escapeHtml(formatDate(absence.startsAt || absence.startAt))}</td><td>${escapeHtml(formatDate(absence.endsAt || absence.endAt))}</td></tr>
    `))}
  `;
}

function renderRoute() {
  renderNav();
  const item = navItems.find(([id]) => id === state.route) || navItems[0];
  el.viewTitle.textContent = item[1];
  const renderers = {
    overview: renderOverview,
    bot: renderBot,
    security: renderSecurity,
    orders: renderOrders,
    lives: renderLives,
    members: renderMembers,
    bau: renderBau,
    absences: renderAbsences,
  };
  el.content.innerHTML = (renderers[state.route] || renderOverview)();
}

async function refresh() {
  const authenticated = await loadSession();
  if (!authenticated) return;
  state.route = routeFromPath();
  renderNav();
  await loadData();
  renderRoute();
}

async function mutateBotConfig(patch) {
  await api('/bot-vortex/config', {
    method: 'PUT',
    body: { patch },
  });
  await refresh();
}

document.addEventListener('click', async (event) => {
  const nav = event.target.closest('[data-route]');
  if (nav) {
    event.preventDefault();
    const route = nav.getAttribute('data-route');
    const item = navItems.find(([id]) => id === route);
    if (item) {
      state.route = item[0];
      history.pushState(null, '', item[2]);
      renderRoute();
    }
    return;
  }

  const action = event.target.closest('[data-action]')?.getAttribute('data-action');
  if (!action) return;
  event.preventDefault();
  try {
    if (action === 'refresh') await refresh();
    if (action === 'toggle-maintenance') {
      const current = Boolean(state.data.bot?.config?.MAINTENANCE_MODE);
      await mutateBotConfig({ MAINTENANCE_MODE: !current });
    }
    if (action === 'toggle-anti-abuse') {
      const current = state.data.bot?.config?.ANTI_ABUSE || {};
      await mutateBotConfig({ ANTI_ABUSE: { ...current, enabled: !current.enabled } });
    }
    if (action === 'export-orders') {
      window.location.href = '/api/orders/export?format=csv';
    }
  } catch (error) {
    renderError(error.message || 'Falha ao executar acao.');
  }
});

el.logout.addEventListener('click', async () => {
  try {
    await api('/auth/logout', { method: 'POST', body: {} });
  } catch {}
  history.replaceState(null, '', '/login');
  showLogin('');
});

el.discordLogin.addEventListener('click', () => {
  window.location.href = '/api/auth/discord/start?next=/dashboard';
});

el.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setLoginAlert('');
  const form = new FormData(el.loginForm);
  try {
    await api('/auth/login', {
      method: 'POST',
      body: {
        email: String(form.get('email') || ''),
        password: String(form.get('password') || ''),
      },
    });
    history.replaceState(null, '', '/dashboard');
    await refresh();
  } catch (error) {
    setLoginAlert(error.message || 'Login recusado.');
  }
});

document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'live-form') return;
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    await api('/lives', {
      method: 'POST',
      body: {
        url: String(form.get('url') || ''),
        discordChannelId: String(form.get('discordChannelId') || ''),
        discordRoleId: String(form.get('discordRoleId') || ''),
      },
    });
    await refresh();
  } catch (error) {
    renderError(error.message || 'Nao foi possivel salvar a live.');
  }
});

window.addEventListener('popstate', () => {
  state.route = routeFromPath();
  renderRoute();
});

refresh().catch((error) => {
  showLogin(error.message || 'Nao foi possivel abrir o painel.');
});
