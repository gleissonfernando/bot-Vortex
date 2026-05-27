const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
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

const panelDir = path.join(rootDir, 'frequency-panel');
const webDir = path.join(panelDir, 'apps', 'web');
const apiPort = String(process.env.INTERNAL_API_PORT || process.env.FREQUENCY_API_PORT || 4100);
const webPort = String(process.env.PORT || process.env.WEB_PORT || 80);
const botApiPort = String(process.env.BOT_API_PORT || 3000);
const apiDist = path.join(panelDir, 'apps', 'api', 'dist', 'index.js');
const standaloneServer = path.join(webDir, '.next', 'standalone', 'apps', 'web', 'server.js');
const standaloneWebDir = path.dirname(standaloneServer);
const webInternalPort = String(process.env.WEB_INTERNAL_PORT || 3001);
const publicBaseUrl = (
  process.env.PUBLIC_BASE_URL
  || process.env.VORTEX_TRANSCRIPT_BASE_URL
  || process.env.APP_URL
  || 'https://bot-vortex.shardweb.app'
).replace(/\/+$/, '');

function envFlag(name, fallback = true) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
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
  const child = spawn(command, args, {
    cwd: options.cwd || rootDir,
    env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1', ...(options.env || {}) },
    shell: process.platform === 'win32',
    stdio: 'inherit'
  });

  child.on('exit', (code, signal) => {
    console.error(`[shardcloud] ${name} stopped (${signal || code})`);
    if (options.fatal !== false) process.exit(code || 1);
  });

  return child;
}

process.env.PUBLIC_BASE_URL ||= publicBaseUrl;
process.env.API_ORIGIN ||= publicBaseUrl || `http://localhost:${webPort}`;
process.env.INTERNAL_API_URL ||= `http://127.0.0.1:${apiPort}`;
process.env.NEXT_PUBLIC_API_URL ||= '/api';
process.env.MONGODB_URI ||= process.env.MONGO_URI || process.env.DATABASE_URL;

function startProxy() {
  const server = http.createServer((req, res) => {
    const isApi = req.url?.startsWith('/api/');
    const target = new URL(isApi ? process.env.INTERNAL_API_URL : `http://127.0.0.1:${webInternalPort}`);
    const targetPath = isApi ? req.url.slice(4) || '/' : req.url || '/';
    const upstream = http.request({
      hostname: target.hostname,
      port: target.port,
      path: targetPath,
      method: req.method,
      headers: { ...req.headers, host: target.host }
    }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    });

    upstream.on('error', (error) => {
      console.error('[shardcloud] proxy error:', error.message);
      if (isApi) {
        if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'Vortex API unavailable' }));
        return;
      }

      if (!res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      }
      res.end(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="10">
  <title>Vortex iniciando</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#e5e7eb;font-family:Arial,sans-serif}
    main{max-width:520px;padding:28px;border:1px solid rgba(96,165,250,.28);border-radius:10px;background:rgba(15,23,42,.72);text-align:center}
    h1{margin:0 0 12px;font-size:22px}p{line-height:1.5;color:#cbd5e1}
  </style>
</head>
<body><main><h1>Vortex iniciando</h1><p>O painel ainda esta subindo ou reiniciando. A pagina vai tentar novamente em alguns segundos.</p></main></body>
</html>`);
    });

    req.pipe(upstream);
  });

  server.listen(Number(webPort), '0.0.0.0', () => {
    console.log(`[shardcloud] proxy listening on 0.0.0.0:${webPort}`);
  });

  server.on('error', (error) => {
    if (error?.code === 'EADDRINUSE') {
      console.warn(`[shardcloud] proxy skipped: port ${webPort} is already in use.`);
      return;
    }
    console.error('[shardcloud] proxy failed:', error);
    process.exit(1);
  });

  return server;
}

function copyIfExists(source, target) {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true });
  return true;
}

function newestMtimeMs(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;

  let newest = stat.mtimeMs;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === '.next' || entry.name === 'node_modules') continue;
    newest = Math.max(newest, newestMtimeMs(path.join(target, entry.name)));
  }
  return newest;
}

function shouldBuildWeb() {
  if (process.env.BUILD_WEB_ON_STARTUP === 'false') return false;
  if (process.env.FORCE_WEB_BUILD === 'true') return true;
  if (!fs.existsSync(standaloneServer)) return true;

  const standaloneMtime = fs.statSync(standaloneServer).mtimeMs;
  const sourceMtime = Math.max(
    newestMtimeMs(path.join(webDir, 'src')),
    newestMtimeMs(path.join(webDir, 'public')),
    newestMtimeMs(path.join(webDir, 'package.json')),
    newestMtimeMs(path.join(webDir, 'next.config.mjs')),
    newestMtimeMs(path.join(panelDir, 'package.json'))
  );
  return sourceMtime > standaloneMtime;
}

function shouldBuildApi() {
  if (process.env.BUILD_API_ON_STARTUP === 'false') return false;
  if (process.env.NODE_ENV === 'production' || process.env.SHARDCLOUD || process.env.PORT === '80') return true;
  if (process.env.FORCE_API_BUILD === 'true') return true;
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

function ensureStandaloneWebAssets() {
  if (!fs.existsSync(standaloneServer)) return;

  const copiedStatic = copyIfExists(
    path.join(webDir, '.next', 'static'),
    path.join(standaloneWebDir, '.next', 'static')
  );
  const copiedPublic = copyIfExists(
    path.join(webDir, 'public'),
    path.join(standaloneWebDir, 'public')
  );

  console.log(`[shardcloud] standalone assets ready: static=${copiedStatic ? 'yes' : 'no'}, public=${copiedPublic ? 'yes' : 'no'}`);
}

const shouldStartDiscordBot = envFlag('START_DISCORD_BOT', true);
const shouldStartFrequencyApi = envFlag('START_FREQUENCY_API', true);
const shouldStartFrequencyWeb = envFlag('START_FREQUENCY_WEB', true);

let web = null;
let proxyServer = null;

async function main() {
  if (shouldStartFrequencyWeb) {
    proxyServer = startProxy();
  }

  if (shouldStartDiscordBot && (process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN)) {
    if (await isPortBusy(botApiPort)) {
      console.warn(`[shardcloud] discord-bot skipped: port ${botApiPort} is already in use.`);
    } else {
      const botLightMode = envFlag('BOT_LIGHT_MODE', true);
      const fivemSystemEnabled = envFlag('FIVEM_SYSTEM_ENABLED', true);
      start('discord-bot', 'node', ['index.js'], {
        env: {
          API_PORT: botApiPort,
          API_HOST: '0.0.0.0',
          ENABLE_PRESENCE_FEATURES: fivemSystemEnabled ? 'true' : (botLightMode ? 'false' : (process.env.ENABLE_PRESENCE_FEATURES || 'true')),
          REGISTER_COMMANDS_ON_STARTUP: process.env.REGISTER_COMMANDS_ON_STARTUP || 'false',
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
        fatal: false
      });
    }
  } else if (shouldStartDiscordBot) {
    console.error('[shardcloud] DISCORD_TOKEN/DISCORD_BOT_TOKEN not configured. Discord bot will not start.');
  } else {
    console.log('[shardcloud] Discord bot disabled by START_DISCORD_BOT=false.');
  }

  if (shouldStartFrequencyApi) {
    if (await isPortBusy(apiPort)) {
      console.warn(`[shardcloud] frequency-api skipped: port ${apiPort} is already in use.`);
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
            API_PORT: apiPort,
            API_ORIGIN: process.env.API_ORIGIN
          },
          fatal: false
        });
      } else {
        const apiArgs = fs.existsSync(apiSource)
          ? ['--prefix', 'frequency-panel', '--workspace', 'apps/api', 'exec', 'tsx', 'src/index.ts']
          : ['--prefix', 'frequency-panel', 'run', 'start:api'];
        start('frequency-api', 'npm', apiArgs, {
          env: {
            API_PORT: apiPort,
            API_ORIGIN: process.env.API_ORIGIN
          },
          fatal: false
        });
      }
    }
  } else {
    console.log('[shardcloud] Frequency API disabled by START_FREQUENCY_API=false.');
  }

  if (shouldStartFrequencyWeb && shouldBuildWeb()) {
    console.log('[shardcloud] Building Next web for production...');
    const built = run('npm', ['--prefix', 'frequency-panel', 'run', 'build:web'], {
      cwd: rootDir,
      env: {
        INTERNAL_API_URL: process.env.INTERNAL_API_URL,
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL
      },
      fatal: false
    });
    if (!built) console.warn('[shardcloud] Next web build failed. Trying to start with available files.');
  }

  if (shouldStartFrequencyWeb) {
    ensureStandaloneWebAssets();

    if (await isPortBusy(webInternalPort)) {
      console.warn(`[shardcloud] frequency-web skipped: port ${webInternalPort} is already in use.`);
    } else {
      web = fs.existsSync(standaloneServer)
        ? start('frequency-web', 'node', [standaloneServer], {
            cwd: webDir,
            env: {
              HOSTNAME: '0.0.0.0',
              PORT: webInternalPort,
              NODE_ENV: 'production',
              INTERNAL_API_URL: process.env.INTERNAL_API_URL,
              NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL
            },
            fatal: false
          })
        : start('frequency-web-dev', 'npm', ['--prefix', 'frequency-panel', '--workspace', 'apps/web', 'run', 'dev', '--', '-p', webInternalPort, '-H', '127.0.0.1'], {
            cwd: rootDir,
            env: {
              INTERNAL_API_URL: process.env.INTERNAL_API_URL,
              NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL
            },
            fatal: false
          });
    }
  } else {
    console.log('[shardcloud] Frequency web disabled by START_FREQUENCY_WEB=false.');
  }
}

main().catch((error) => {
  console.error('[shardcloud] startup failed:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  web?.kill('SIGINT');
  proxyServer?.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  web?.kill('SIGTERM');
  proxyServer?.close();
  process.exit(0);
});
