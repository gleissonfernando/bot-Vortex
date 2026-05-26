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
    process.exit(result.status || 1);
  }
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

process.env.JWT_SECRET ||= 'change-this-jwt-secret-in-shardcloud';
process.env.INGEST_SECRET ||= 'change-this-ingest-secret-in-shardcloud';
process.env.ADMIN_EMAIL ||= 'vortex@adimin.com';
process.env.ADMIN_PASSWORD ||= 'vortex';
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
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Service unavailable' }));
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
  if (shouldStartDiscordBot && (process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN)) {
    if (await isPortBusy(botApiPort)) {
      console.warn(`[shardcloud] discord-bot skipped: port ${botApiPort} is already in use.`);
    } else {
      start('discord-bot', 'node', ['index.js'], {
        env: {
          API_PORT: botApiPort,
          API_HOST: '0.0.0.0',
          ENABLE_PRESENCE_FEATURES: process.env.ENABLE_PRESENCE_FEATURES || 'true',
          REGISTER_COMMANDS_ON_STARTUP: process.env.REGISTER_COMMANDS_ON_STARTUP || 'false',
          FIVEM_STARTUP_SCAN_ENABLED: process.env.FIVEM_STARTUP_SCAN_ENABLED || 'true',
          FIVEM_STARTUP_FETCH_PRESENCES: process.env.FIVEM_STARTUP_FETCH_PRESENCES || 'true',
          POINT_AUTOMATION_FETCH_PRESENCES: process.env.POINT_AUTOMATION_FETCH_PRESENCES || 'true',
          POINT_AUTOMATION_INTERVAL_MS: process.env.POINT_AUTOMATION_INTERVAL_MS || String(30 * 60 * 1000),
          PONTO_PANEL_FETCH_PRESENCES: process.env.PONTO_PANEL_FETCH_PRESENCES || 'true',
          PONTO_PANEL_INTERVAL_MS: process.env.PONTO_PANEL_INTERVAL_MS || String(60 * 1000),
          DISCORD_CACHE_MAX_MESSAGES: process.env.DISCORD_CACHE_MAX_MESSAGES || '25',
          DISCORD_CACHE_MAX_GUILD_MEMBERS: process.env.DISCORD_CACHE_MAX_GUILD_MEMBERS || '100',
          DISCORD_CACHE_MAX_PRESENCES: process.env.DISCORD_CACHE_MAX_PRESENCES || '500'
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
    run('npm', ['--prefix', 'frequency-panel', 'run', 'build:web'], {
      cwd: rootDir,
      env: {
        INTERNAL_API_URL: process.env.INTERNAL_API_URL,
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL
      }
    });
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
            }
          })
        : start('frequency-web-dev', 'npm', ['--prefix', 'frequency-panel', '--workspace', 'apps/web', 'run', 'dev', '--', '-p', webInternalPort, '-H', '127.0.0.1'], {
            cwd: rootDir,
            env: {
              INTERNAL_API_URL: process.env.INTERNAL_API_URL,
              NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL
            }
          });
    }

    if (await isPortBusy(webPort)) {
      console.warn(`[shardcloud] proxy skipped: port ${webPort} is already in use.`);
    } else {
      proxyServer = startProxy();
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
