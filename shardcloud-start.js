const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
require('./utils/safeConsole').patchConsole();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0'
  ? '1'
  : (process.env.NODE_TLS_REJECT_UNAUTHORIZED || '1');

const rootDir = __dirname;

function loadRootEnv() {
  const envPath = path.join(rootDir, '.env');
  try {
    require('dotenv').config({ path: envPath });
    return;
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error;
  }

  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

loadRootEnv();

function isFalseValue(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value || '').trim().toLowerCase());
}

function setRuntimeDefault(name, value) {
  if (process.env[name] === undefined || process.env[name] === '') {
    process.env[name] = value;
  }
}

function setRuntimeAlias(target, sources) {
  if (process.env[target] !== undefined && process.env[target] !== '') return;
  for (const source of sources) {
    const value = process.env[source];
    if (value !== undefined && value !== '') {
      process.env[target] = value;
      return;
    }
  }
}

function isStrongRuntimeSecret(value, minLength) {
  const text = String(value || '').trim();
  return text.length >= minLength && !/^(change-this|replace-|put-your-)/i.test(text);
}

function ensureEphemeralSecret(name, minLength) {
  if (isStrongRuntimeSecret(process.env[name], minLength)) return;

  if (isFalseValue(process.env.SHARDCLOUD_BOOTSTRAP_SECRETS)) {
    console.warn(`[shardcloud] ${name} ausente/fraco. Configure esta variavel na ShardCloud para a API iniciar.`);
    return;
  }

  process.env[name] = crypto.randomBytes(Math.max(24, Math.ceil(minLength / 2))).toString('hex');
  console.warn(`[shardcloud] ${name} ausente/fraco. Usando segredo efemero forte para manter o runtime online; configure um valor fixo na ShardCloud para sessoes estaveis.`);
}

function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function readMemoryLimitMbFromCgroup() {
  const candidates = [
    '/sys/fs/cgroup/memory.max',
    '/sys/fs/cgroup/memory/memory.limit_in_bytes'
  ];

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      if (!raw || raw === 'max') continue;
      const bytes = toPositiveNumber(raw);
      if (!bytes || bytes > 1024 ** 5) continue;
      return Math.floor(bytes / 1024 / 1024);
    } catch {
      // Ignore host-specific cgroup files; environment/os fallback below handles it.
    }
  }

  return null;
}

function detectAvailableMemoryMb() {
  const values = [
    toPositiveNumber(process.env.MEMORY),
    toPositiveNumber(process.env.SHARDCLOUD_MEMORY_MB),
    toPositiveNumber(process.env.CONTAINER_MEMORY_MB),
    readMemoryLimitMbFromCgroup(),
    Math.floor(os.totalmem() / 1024 / 1024)
  ].filter((value) => Number.isFinite(value) && value > 0);

  return values.length ? Math.min(...values) : 1024;
}

function applyShardCloudRuntimeDefaults() {
  setRuntimeDefault('NODE_ENV', 'production');
  setRuntimeDefault('SHARDCLOUD_DEPLOY_MODE', 'git');
  setRuntimeDefault('BUILD_API_ON_STARTUP', 'true');
  setRuntimeDefault('BUILD_WEB_ON_STARTUP', 'false');
  setRuntimeDefault('REQUIRE_BUILT_ASSETS', 'false');
  setRuntimeDefault('REGISTER_COMMANDS_ON_STARTUP', 'true');
  // Calcular NODE_OPTIONS com base na memoria atribuida pela ShardCloud (process.env.MEMORY)
  // Usamos um teto conservador porque a ShardCloud roda proxy + API + bot
  // no mesmo container. Em 1GB, heaps grandes demais derrubam a porta publica.
  try {
    const detectedMem = detectAvailableMemoryMb();
    let calculated = Math.floor(detectedMem * 0.45);
    // Nunca exceder a memoria fisica minus uma margem (64MB)
    if (calculated > detectedMem - 64) calculated = Math.max(Math.floor(detectedMem - 64), 256);
    if (detectedMem <= 1024) calculated = Math.min(calculated, 256);
    calculated = Math.max(192, calculated);
    setRuntimeDefault('NODE_OPTIONS', `--max-old-space-size=${calculated}`);

    if (detectedMem <= 1024) {
      process.env.BUILD_API_ON_STARTUP = 'false';
      process.env.BUILD_WEB_ON_STARTUP = 'false';
      process.env.START_FREQUENCY_WEB = 'false';
      // favor a lightweight bot mode and reduce expensive startup tasks
      setRuntimeDefault('BOT_LIGHT_MODE', 'true');
      setRuntimeDefault('START_DISCORD_BOT', 'true');
      process.env.REGISTER_COMMANDS_ON_STARTUP = 'false';
      setRuntimeDefault('DISCORD_BOT_START_DELAY_MS', '0');
      setRuntimeDefault('DISCORD_BOT_NODE_OPTIONS', '--max-old-space-size=160');
      setRuntimeDefault('FREQUENCY_API_NODE_OPTIONS', '--max-old-space-size=160');

      // aggressive cache/interval defaults to save RAM/CPU
      setRuntimeDefault('DISCORD_CACHE_MAX_MESSAGES', '0');
      setRuntimeDefault('DISCORD_CACHE_MAX_GUILD_MEMBERS', '10');
      setRuntimeDefault('DISCORD_CACHE_MAX_PRESENCES', '0');
      setRuntimeDefault('LIVE_ALERT_CHECK_INTERVAL_MS', process.env.LIVE_ALERT_CHECK_INTERVAL_MS || '3600000');
      setRuntimeDefault('FREQUENCY_MEMBER_SYNC_INTERVAL_MS', process.env.FREQUENCY_MEMBER_SYNC_INTERVAL_MS || '3600000');
      setRuntimeDefault('POINT_AUTOMATION_INTERVAL_MS', process.env.POINT_AUTOMATION_INTERVAL_MS || '3600000');
    }
  } catch (err) {
    setRuntimeDefault('NODE_OPTIONS', '--max-old-space-size=768');
  }
  setRuntimeDefault('START_PUBLIC_PROXY', 'true');
  setRuntimeDefault('SHARDCLOUD_REQUIRE_PORT_80', 'true');
  setRuntimeDefault('START_DISCORD_BOT', 'true');
  setRuntimeDefault('START_FREQUENCY_API', 'true');
  setRuntimeDefault('START_FREQUENCY_WEB', 'false');
  if (process.env.START_FREQUENCY_WEB && !isFalseValue(process.env.START_FREQUENCY_WEB)) {
    console.warn('[shardcloud] START_FREQUENCY_WEB ignorado: runtime Node-only nao inicia web separado.');
  }
  process.env.START_FREQUENCY_WEB = 'false';
  process.env.BUILD_WEB_ON_STARTUP = 'false';
  console.log('[shardcloud] Node-only ativo: web build/start desabilitado.');
  setRuntimeDefault('BOT_LIGHT_MODE', 'true');
  setRuntimeDefault('FIVEM_SYSTEM_ENABLED', 'true');
  setRuntimeDefault('MONGODB_REQUIRED', 'false');
  setRuntimeDefault('BOT_MONGODB_REQUIRED', 'false');
  setRuntimeAlias('DISCORD_TOKEN', ['DISCORD_BOT_TOKEN', 'TOKEN']);
  setRuntimeAlias('DISCORD_CLIENT_ID', ['CLIENT_ID', 'VITE_DISCORD_CLIENT_ID']);
  setRuntimeAlias('DISCORD_CLIENT_SECRET', ['CLIENT_SECRET', 'DISCORD_OAUTH_CLIENT_SECRET', 'VITE_DISCORD_CLIENT_SECRET']);
  setRuntimeAlias('DISCORD_GUILD_ID', ['GUILD_ID', 'VITE_DISCORD_GUILD_ID']);
  setRuntimeAlias('MONGODB_URI', ['MONGO_URI', 'DATABASE_URL']);

  ensureEphemeralSecret('JWT_SECRET', 32);
  ensureEphemeralSecret('INGEST_SECRET', 32);
  setRuntimeDefault('BOT_INGEST_SECRET', process.env.INGEST_SECRET || '');

  // Conservative cache and interval defaults to lower CPU/RAM usage
  setRuntimeDefault('DISCORD_CACHE_MAX_MESSAGES', '5');
  setRuntimeDefault('DISCORD_CACHE_MAX_GUILD_MEMBERS', '20');
  setRuntimeDefault('DISCORD_CACHE_MAX_PRESENCES', '0');
  setRuntimeDefault('LIVE_ALERT_CHECK_INTERVAL_MS', process.env.LIVE_ALERT_CHECK_INTERVAL_MS || '300000');
  setRuntimeDefault('FREQUENCY_MEMBER_SYNC_INTERVAL_MS', process.env.FREQUENCY_MEMBER_SYNC_INTERVAL_MS || '1800000');
  setRuntimeDefault('POINT_AUTOMATION_INTERVAL_MS', process.env.POINT_AUTOMATION_INTERVAL_MS || '1800000');
}

applyShardCloudRuntimeDefaults();

const panelDir = path.join(rootDir, 'frequency-panel');
let apiPort = String(process.env.INTERNAL_API_PORT || process.env.FREQUENCY_API_PORT || 4100);
const webPort = String(process.env.PORT || process.env.WEB_PORT || 80);
const botApiPort = String(process.env.BOT_API_PORT || 3000);
const apiDist = path.join(panelDir, 'apps', 'api', 'dist', 'index.js');
const publicBaseUrl = (
  process.env.PUBLIC_BASE_URL
  || process.env.VORTEX_TRANSCRIPT_BASE_URL
  || process.env.APP_URL
  || 'https://bot-vortex.shardweb.app'
).replace(/\/+$/, '');
const childRestartState = new Map();
const childStatuses = new Map();
const managedChildren = new Set();
let shuttingDown = false;
const hasExplicitInternalApiUrl = Boolean(process.env.INTERNAL_API_URL);

function envFlag(name, fallback = true) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return !isFalseValue(value);
}

function envValue(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function uniquePortList(values) {
  const ports = [];
  for (const value of values) {
    const port = Number(value);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;
    const text = String(port);
    if (!ports.includes(text)) ports.push(text);
  }
  return ports;
}

function shouldForcePublicProxy() {
  return !envFlag('SHARDCLOUD_ALLOW_PUBLIC_PROXY_DISABLE', false);
}

function shouldBindPort80() {
  return envFlag('SHARDCLOUD_REQUIRE_PORT_80', true)
    || envFlag('SHARDCLOUD_BIND_PORT_80_FALLBACK', true);
}

function getPublicProxyPorts() {
  return uniquePortList([
    webPort,
    shouldBindPort80() ? '80' : null,
  ]);
}

function canConnect(port, host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: Number(port), host });
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function isPortBusy(port) {
  const value = Number(port);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) return false;
  return (await canConnect(value, '127.0.0.1')) || (await canConnect(value, '::1'));
}

function getJson(url, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 4096) req.destroy();
      });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode || 0, data: JSON.parse(body) });
        } catch {
          resolve({ statusCode: res.statusCode || 0, data: null });
        }
      });
    });

    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

function safeJoinStatic(baseDir, requestPath) {
  const decoded = decodeURIComponent(String(requestPath || '')).replace(/\\/g, '/');
  const cleanPath = decoded.replace(/^\/+/, '');
  const target = path.resolve(baseDir, cleanPath);
  const root = path.resolve(baseDir);
  return target === root || target.startsWith(`${root}${path.sep}`) ? target : null;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }[ext] || 'application/octet-stream';
}

function serveStaticFile(req, res, baseDir, relativePath, cacheControl = 'public, max-age=3600') {
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) return false;
  const filePath = safeJoinStatic(baseDir, relativePath);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;

  res.writeHead(200, {
    'Content-Type': contentTypeFor(filePath),
    'Cache-Control': cacheControl,
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }

  fs.createReadStream(filePath).pipe(res);
  return true;
}

function serveRuntimeStatic(req, res, pathname) {
  if (pathname === '/favicon.ico') {
    return serveStaticFile(req, res, path.join(rootDir, 'frequency-panel', 'apps', 'web', 'dist'), 'favicon.ico')
      || serveStaticFile(req, res, path.join(rootDir, 'frequency-panel', 'apps', 'web', 'public'), 'favicon.ico');
  }

  if (pathname === '/vortex-logo.png') {
    return serveStaticFile(req, res, path.join(rootDir, 'frequency-panel', 'apps', 'web', 'dist'), 'vortex-logo.png')
      || serveStaticFile(req, res, path.join(rootDir, 'frequency-panel', 'apps', 'web', 'public'), 'vortex-logo.png');
  }

  if (pathname.startsWith('/transcripts/')) {
    return serveStaticFile(
      req,
      res,
      path.join(rootDir, 'public', 'transcripts'),
      pathname.slice('/transcripts/'.length),
      'no-store'
    );
  }

  if (pathname.startsWith('/assets/')) {
    const assetPath = pathname.slice('/assets/'.length);
    return serveStaticFile(req, res, path.join(rootDir, 'frequency-panel', 'apps', 'web', 'dist', 'assets'), assetPath)
      || serveStaticFile(req, res, path.join(rootDir, 'public', 'assets'), assetPath)
      || serveStaticFile(req, res, path.join(rootDir, 'foto'), assetPath);
  }

  if (pathname.startsWith('/vendor/fontawesome/')) {
    return serveStaticFile(
      req,
      res,
      path.join(rootDir, 'node_modules', '@fortawesome', 'fontawesome-free'),
      pathname.slice('/vendor/fontawesome/'.length)
    );
  }

  return false;
}

function siteCsp() {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: https:",
    "connect-src 'self' https://bot-vortex.shardweb.app",
    "font-src 'self' https: data:",
    "form-action 'self'",
  ].join('; ');
}

function serveSiteIndex(req, res) {
  const indexPath = path.join(rootDir, 'frequency-panel', 'apps', 'web', 'dist', 'index.html');
  if (!fs.existsSync(indexPath)) return false;

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': siteCsp(),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });

  if (req.method === 'HEAD') {
    res.end();
    return true;
  }

  fs.createReadStream(indexPath).pipe(res);
  return true;
}

function serveNodeSite(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    res.writeHead(405, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
    return true;
  }

  if (serveSiteIndex(req, res)) return true;

  const health = runtimeHealth();
  const apiStatus = health.children['frequency-api']?.status || 'starting';
  const botStatus = health.children['discord-bot']?.status || (health.config.hasDiscordToken ? 'starting' : 'missing token');
  const safePath = pathname === '/' ? '/' : pathname.replace(/[<>&"]/g, '');
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Vortex</title>
  <style>
    body{margin:0;min-height:100vh;background:#0b1220;color:#e5e7eb;font-family:Arial,sans-serif;display:grid;place-items:center}
    main{width:min(760px,calc(100% - 32px));padding:28px;border:1px solid rgba(148,163,184,.24);border-radius:10px;background:#111827}
    h1{margin:0 0 8px;font-size:26px}
    p{color:#cbd5e1;line-height:1.5}
    dl{display:grid;grid-template-columns:130px 1fr;gap:10px 14px;margin:22px 0}
    dt{color:#94a3b8}
    dd{margin:0;font-weight:700}
    a{color:#67e8f9}
    code{color:#fde68a}
  </style>
</head>
<body>
  <main>
    <h1>Vortex Online</h1>
    <p>Runtime Node-only ativo. O bot, a API e os arquivos publicos estao no proprio Node.</p>
    <dl>
      <dt>Rota</dt><dd><code>${safePath}</code></dd>
      <dt>Bot</dt><dd>${botStatus}</dd>
      <dt>API</dt><dd>${apiStatus}</dd>
      <dt>Modo</dt><dd>${health.mode}</dd>
    </dl>
    <p><a href="/health">/health</a> · <a href="/api/health">/api/health</a> · <a href="/api/auth/discord/start?next=/dashboard">entrar com Discord</a></p>
  </main>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  res.end(html);
  return true;
}

async function isFrequencyApiHealthy(port) {
  const result = await getJson(`http://127.0.0.1:${port}/health`);
  return Boolean(result?.statusCode === 200 && result.data?.ok && result.data?.service === 'vortex-frequency-api');
}

async function findFreePort(startPort, attempts = 20) {
  let current = Number(startPort);
  if (!Number.isInteger(current) || current <= 0 || current > 65535) current = 4100;

  for (let offset = 0; offset < attempts; offset += 1) {
    const candidate = current + offset;
    if (candidate > 65535) break;
    if (!(await isPortBusy(candidate))) return String(candidate);
  }

  return null;
}

function run(command, args, options = {}) {
  console.log(`[shardcloud] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || rootDir,
    env: { ...process.env, ...(options.env || {}) },
    shell: process.platform === 'win32',
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    if (options.fatal === false) return false;
    process.exit(result.status || 1);
  }

  return true;
}

function start(name, command, args, options = {}) {
  console.log(`[shardcloud] starting ${name}: ${command} ${args.join(' ')}`);
  const startedAt = Date.now();
  setChildStatus(name, 'starting', { command, args });
  const child = spawn(command, args, {
    cwd: options.cwd || rootDir,
    env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1', ...(options.env || {}) },
    shell: process.platform === 'win32',
    stdio: 'inherit'
  });
  managedChildren.add(child);

  child.once('spawn', () => {
    setChildStatus(name, 'running', { pid: child.pid, command, args });
  });

  child.once('error', (error) => {
    setChildStatus(name, 'failed', { error: error.message, command, args });
  });

  child.on('exit', (code, signal) => {
    managedChildren.delete(child);
    setChildStatus(name, 'stopped', { code, signal: signal || null, command, args });
    console.error(`[shardcloud] ${name} stopped (${signal || code})`);
    if (options.fatal !== false) process.exit(code || 1);
    if (!options.restart || shuttingDown) return;

    const state = childRestartState.get(name) || { attempts: 0 };
    if (Date.now() - startedAt > 60 * 1000) state.attempts = 0;
    state.attempts += 1;
    const delayMs = Math.min(60 * 1000, 1000 * (2 ** Math.min(state.attempts - 1, 6)));
    childRestartState.set(name, state);
    console.error(`[shardcloud] restarting ${name} in ${Math.round(delayMs / 1000)}s (attempt ${state.attempts})`);
    const timer = setTimeout(() => {
      state.timer = null;
      start(name, command, args, options);
    }, delayMs);
    if (typeof timer.unref === 'function') timer.unref();
    state.timer = timer;
  });

  return child;
}

function setChildStatus(name, status, details = {}) {
  childStatuses.set(name, {
    status,
    updatedAt: new Date().toISOString(),
    ...details,
  });
}

function stopManagedChildren(signal) {
  shuttingDown = true;
  for (const state of childRestartState.values()) {
    if (state.timer) clearTimeout(state.timer);
  }
  childRestartState.clear();
  for (const child of managedChildren) {
    child.kill(signal);
  }
}

process.env.PUBLIC_BASE_URL ||= publicBaseUrl;
process.env.API_ORIGIN ||= publicBaseUrl || `http://localhost:${webPort}`;
process.env.SITE_ORIGIN ||= publicBaseUrl || 'https://bot-vortex.shardweb.app';
process.env.DISCORD_OAUTH_REDIRECT_URI ||= `${process.env.SITE_ORIGIN.replace(/\/+$/, '')}/api/auth/discord/callback`;
process.env.INTERNAL_API_URL ||= `http://127.0.0.1:${apiPort}`;

function runtimeHealth() {
  return {
    ok: true,
    service: 'vortex-shardcloud-runtime',
    mode: process.env.SHARDCLOUD_DEPLOY_MODE || 'git',
    publicBaseUrl,
    ports: {
      public: getPublicProxyPorts(),
      api: apiPort,
      botApi: botApiPort,
    },
    config: {
      startPublicProxy: shouldStartPublicProxy,
      startDiscordBot: shouldStartDiscordBot,
      startFrequencyApi: shouldStartFrequencyApi,
      startFrequencyWeb: shouldStartFrequencyWeb,
      hasDiscordToken: Boolean(process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || process.env.TOKEN),
      hasMongoDb: Boolean(process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL),
    },
    children: Object.fromEntries(childStatuses.entries()),
  };
}

function createProxyServer(port, { fatalOnError = true } = {}) {
  const server = http.createServer((req, res) => {
    const pathname = String(req.url || '/').split('?')[0];
    if (pathname === '/health' || pathname === '/_shardcloud/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(runtimeHealth()));
      return;
    }

    if (serveRuntimeStatic(req, res, pathname)) return;

    const isApi = req.url?.startsWith('/api/');
    if (!isApi) {
      serveNodeSite(req, res, pathname);
      return;
    }

    const target = new URL(process.env.INTERNAL_API_URL);
    const targetPath = req.url.slice(4) || '/';
    const forwardedFor = forwardedForHeader(req);
    const realIp = firstForwardedAddress(forwardedFor);
    const upstream = http.request({
      hostname: target.hostname,
      port: target.port,
      path: targetPath,
      method: req.method,
      headers: {
        ...req.headers,
        host: target.host,
        'x-forwarded-host': req.headers.host || target.host,
        'x-forwarded-proto': 'https',
        ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
        ...(realIp ? { 'x-real-ip': realIp } : {}),
      }
    }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    });

    upstream.on('error', (error) => {
      console.error('[shardcloud] proxy error:', error.message);
      if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, error: 'Vortex API unavailable' }));
    });

    req.pipe(upstream);
  });

  server.listen(Number(port), '0.0.0.0', () => {
    console.log(`[shardcloud] proxy listening on 0.0.0.0:${port}`);
    setChildStatus(`public-proxy:${port}`, 'running', { port });
  });

  server.on('error', (error) => {
    if (error?.code === 'EADDRINUSE') {
      const message = `[shardcloud] public port ${port} is already in use.`;
      if (fatalOnError) {
        setChildStatus(`public-proxy:${port}`, 'failed', { reason: 'port busy', port });
        console.error(`${message} Exiting to let ShardCloud recycle the runtime instead of serving stale files.`);
        process.exit(1);
      }
      setChildStatus(`public-proxy:${port}`, 'skipped', { reason: 'port busy', port });
      console.warn(`${message} Continuing because this is only the port 80 fallback.`);
      return;
    }
    if (fatalOnError) {
      setChildStatus(`public-proxy:${port}`, 'failed', { reason: error.message, port });
      console.error('[shardcloud] proxy failed:', error);
      process.exit(1);
    }
    setChildStatus(`public-proxy:${port}`, 'failed', { reason: error.message, port });
    console.warn(`[shardcloud] optional proxy on port ${port} failed: ${error.message}`);
  });

  return server;
}

function forwardedForHeader(req) {
  const current = Array.isArray(req.headers['x-forwarded-for'])
    ? req.headers['x-forwarded-for'].join(', ')
    : String(req.headers['x-forwarded-for'] || '').trim();
  const remote = String(req.socket?.remoteAddress || '').trim();
  return [current, remote].filter(Boolean).join(', ');
}

function firstForwardedAddress(value) {
  return String(value || '').split(',')[0]?.trim() || '';
}

function startProxy() {
  const ports = getPublicProxyPorts();
  return ports.map((port, index) => createProxyServer(port, {
    fatalOnError: port === '80' || ports.length === 1 || (index === 0 && !shouldBindPort80()),
  }));
}

function newestMtimeMs(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;

  let newest = stat.mtimeMs;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    newest = Math.max(newest, newestMtimeMs(path.join(target, entry.name)));
  }
  return newest;
}

function shouldBuildApi() {
  if (process.env.FORCE_API_BUILD === 'true') return true;
  if (!envFlag('BUILD_API_ON_STARTUP', false)) return false;
  if (process.env.SHARDCLOUD_DEPLOY_MODE === 'git') return true;
  if (!fs.existsSync(apiDist)) return true;

  const distMtime = fs.statSync(apiDist).mtimeMs;
  const sourceMtime = Math.max(
    newestMtimeMs(path.join(panelDir, 'apps', 'api', 'src')),
    newestMtimeMs(path.join(panelDir, 'apps', 'api', 'package.json')),
    newestMtimeMs(path.join(panelDir, 'apps', 'api', 'tsconfig.json')),
    newestMtimeMs(path.join(panelDir, 'package.json'))
  );
  return sourceMtime > distMtime;
}

const shouldStartDiscordBot = envFlag('START_DISCORD_BOT', true);
const shouldStartFrequencyApi = envFlag('START_FREQUENCY_API', true);
const shouldStartFrequencyWeb = envFlag('START_FREQUENCY_WEB', false);
const shouldStartPublicProxy = shouldForcePublicProxy() || envFlag('START_PUBLIC_PROXY', true);
const requireBuiltAssets = envFlag('REQUIRE_BUILT_ASSETS', false);

let proxyServers = [];

function exitMissingBuiltAsset(label, relativePath) {
  console.error(`[shardcloud] ${label} nao encontrado: ${relativePath}`);
  console.error('[shardcloud] Rode npm run deploy:check antes de subir ou envie o pacote gerado pelo workflow do GitHub.');
  process.exit(1);
}

async function main() {
  if (shouldStartPublicProxy) {
    if (shouldForcePublicProxy() && isFalseValue(process.env.START_PUBLIC_PROXY)) {
      console.warn('[shardcloud] START_PUBLIC_PROXY=false ignorado; defina SHARDCLOUD_ALLOW_PUBLIC_PROXY_DISABLE=true apenas se quiser desligar a porta publica.');
    }
    proxyServers = startProxy();
  } else {
    console.log('[shardcloud] Public proxy disabled by START_PUBLIC_PROXY=false.');
    setChildStatus('public-proxy', 'disabled', { reason: 'START_PUBLIC_PROXY=false' });
  }

  if (shouldStartDiscordBot && (process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || process.env.TOKEN)) {
    if (await isPortBusy(botApiPort)) {
      console.warn(`[shardcloud] discord-bot skipped: port ${botApiPort} is already in use.`);
      setChildStatus('discord-bot', 'skipped', { reason: `port ${botApiPort} busy` });
    } else {
      const botLightMode = envFlag('BOT_LIGHT_MODE', true);
      const fivemSystemEnabled = envFlag('FIVEM_SYSTEM_ENABLED', true);
      const startDiscordBot = () => {
        if (shuttingDown) return;
        start('discord-bot', 'node', ['index.js'], {
          env: {
            NODE_OPTIONS: process.env.DISCORD_BOT_NODE_OPTIONS || process.env.NODE_OPTIONS,
            API_PORT: botApiPort,
            API_HOST: '0.0.0.0',
            ENABLE_PRESENCE_FEATURES: fivemSystemEnabled ? 'true' : (botLightMode ? 'false' : (process.env.ENABLE_PRESENCE_FEATURES || 'true')),
            REGISTER_COMMANDS_ON_STARTUP: envValue('REGISTER_COMMANDS_ON_STARTUP', 'true'),
            FIVEM_STARTUP_SCAN_ENABLED: fivemSystemEnabled ? (process.env.FIVEM_STARTUP_SCAN_ENABLED || 'true') : 'false',
            FIVEM_STARTUP_FETCH_PRESENCES: fivemSystemEnabled ? (process.env.FIVEM_STARTUP_FETCH_PRESENCES || (botLightMode ? 'false' : 'true')) : 'false',
            POINT_AUTOMATION_SCAN_FIVEM: fivemSystemEnabled ? (process.env.POINT_AUTOMATION_SCAN_FIVEM || 'true') : 'false',
            POINT_AUTOMATION_FETCH_PRESENCES: fivemSystemEnabled ? (process.env.POINT_AUTOMATION_FETCH_PRESENCES || (botLightMode ? 'false' : 'true')) : 'false',
            POINT_AUTOMATION_INTERVAL_MS: process.env.POINT_AUTOMATION_INTERVAL_MS || String(botLightMode ? 60 * 60 * 1000 : 30 * 60 * 1000),
            PONTO_PANEL_FETCH_PRESENCES: fivemSystemEnabled ? (process.env.PONTO_PANEL_FETCH_PRESENCES || (botLightMode ? 'false' : 'true')) : 'false',
            PONTO_PANEL_INTERVAL_MS: process.env.PONTO_PANEL_INTERVAL_MS || String(botLightMode ? 5 * 60 * 1000 : 60 * 1000),
            PROFILE_ACCESS_REVIEW_ENABLED: botLightMode ? 'false' : (process.env.PROFILE_ACCESS_REVIEW_ENABLED || 'true'),
            PROFILE_SYNC_CHANNELS_ON_STARTUP: botLightMode ? 'false' : (process.env.PROFILE_SYNC_CHANNELS_ON_STARTUP || 'true'),
            SYNC_CHANNEL_ACCESS_ON_READY: botLightMode ? 'false' : (process.env.SYNC_CHANNEL_ACCESS_ON_READY || 'true'),
            DISCORD_CACHE_MAX_MESSAGES: process.env.DISCORD_CACHE_MAX_MESSAGES || (botLightMode ? '10' : '25'),
            DISCORD_CACHE_MAX_GUILD_MEMBERS: process.env.DISCORD_CACHE_MAX_GUILD_MEMBERS || (botLightMode ? '50' : '100'),
            DISCORD_CACHE_MAX_PRESENCES: process.env.DISCORD_CACHE_MAX_PRESENCES || (fivemSystemEnabled ? '100' : (botLightMode ? '0' : '500')),
            MONGODB_REQUIRED: process.env.BOT_MONGODB_REQUIRED || 'false'
          },
          fatal: false,
          restart: true
        });
      };
      const botStartDelayMs = Math.max(0, Number(process.env.DISCORD_BOT_START_DELAY_MS) || 0);
      if (botStartDelayMs > 0) {
        console.log(`[shardcloud] discord-bot delayed by ${botStartDelayMs}ms to reduce startup memory pressure.`);
        setChildStatus('discord-bot', 'delayed', { delayMs: botStartDelayMs });
        const timer = setTimeout(startDiscordBot, botStartDelayMs);
        if (typeof timer.unref === 'function') timer.unref();
      } else {
        startDiscordBot();
      }
    }
  } else if (shouldStartDiscordBot) {
    console.error('[shardcloud] DISCORD_TOKEN/DISCORD_BOT_TOKEN/TOKEN not configured. Discord bot will not start.');
    setChildStatus('discord-bot', 'skipped', { reason: 'missing DISCORD_TOKEN/DISCORD_BOT_TOKEN/TOKEN' });
  } else {
    console.log('[shardcloud] Discord bot disabled by START_DISCORD_BOT=false.');
    setChildStatus('discord-bot', 'disabled', { reason: 'START_DISCORD_BOT=false' });
  }

  if (shouldStartFrequencyApi) {
    if (await isPortBusy(apiPort)) {
      if (await isFrequencyApiHealthy(apiPort)) {
        console.warn(`[shardcloud] frequency-api skipped: healthy API already running on port ${apiPort}.`);
      } else if (hasExplicitInternalApiUrl) {
        console.warn(`[shardcloud] frequency-api skipped: port ${apiPort} is busy and INTERNAL_API_URL is explicit.`);
      } else {
        const nextPort = await findFreePort(Number(apiPort) + 1);
        if (!nextPort) {
          console.warn(`[shardcloud] frequency-api skipped: port ${apiPort} is busy and no fallback port is available.`);
        } else {
          console.warn(`[shardcloud] port ${apiPort} is busy but not a healthy frequency API. Starting frequency-api on ${nextPort}.`);
          apiPort = nextPort;
          process.env.INTERNAL_API_URL = `http://127.0.0.1:${apiPort}`;
        }
      }
    }

    if (!(await isFrequencyApiHealthy(apiPort))) {
      if (await isPortBusy(apiPort)) {
        console.warn(`[shardcloud] frequency-api could not start: port ${apiPort} is still busy.`);
      } else {
        if (!(process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL)) {
          console.warn('[shardcloud] MongoDB nao configurado. A API sera iniciada em modo fallback para login, configuracoes e bau.');
        }

        if (shouldBuildApi()) {
          console.log('[shardcloud] Building Frequency API for production...');
          const built = run('npm', ['--prefix', 'frequency-panel', 'run', 'build:api'], { fatal: false });
          if (!built) console.warn('[shardcloud] Frequency API build failed. Trying to start with available files.');
        }

        const apiSource = path.join(panelDir, 'apps', 'api', 'src', 'index.ts');
        if (fs.existsSync(apiDist)) {
          start('frequency-api', 'node', [apiDist], {
            env: {
              NODE_OPTIONS: process.env.FREQUENCY_API_NODE_OPTIONS || process.env.NODE_OPTIONS,
              API_PORT: apiPort,
              API_ORIGIN: process.env.API_ORIGIN
            },
            fatal: false,
            restart: true
          });
        } else if (requireBuiltAssets) {
          exitMissingBuiltAsset('Frequency API dist', path.relative(rootDir, apiDist));
        } else {
          const apiArgs = fs.existsSync(apiSource)
            ? ['--prefix', 'frequency-panel', '--workspace', 'apps/api', 'exec', 'tsx', 'src/index.ts']
            : ['--prefix', 'frequency-panel', 'run', 'start:api'];
          start('frequency-api', 'npm', apiArgs, {
            env: {
              NODE_OPTIONS: process.env.FREQUENCY_API_NODE_OPTIONS || process.env.NODE_OPTIONS,
              API_PORT: apiPort,
              API_ORIGIN: process.env.API_ORIGIN
            },
            fatal: false,
            restart: true
          });
        }
      }
    }
  } else {
    console.log('[shardcloud] Frequency API disabled by START_FREQUENCY_API=false.');
  }

  if (shouldStartFrequencyWeb) {
    console.warn('[shardcloud] frequency-web ignorado: runtime Node-only serve a pagina publica sem web separado.');
  } else {
    console.log('[shardcloud] Frequency web disabled; public page served by Node-only runtime.');
  }
}

main().catch((error) => {
  console.error('[shardcloud] startup failed:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  stopManagedChildren('SIGINT');
  for (const server of proxyServers) server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopManagedChildren('SIGTERM');
  for (const server of proxyServers) server.close();
  process.exit(0);
});
