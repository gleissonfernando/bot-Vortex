const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const rootDir = __dirname;
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
    env: { ...process.env, ...(options.env || {}) },
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

if (process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN) {
  start('discord-bot', 'npm', ['run', 'start:bot'], {
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
} else {
  console.error('[shardcloud] DISCORD_TOKEN/DISCORD_BOT_TOKEN not configured. Discord bot will not start.');
}

if (process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL) {
  const apiSource = path.join(panelDir, 'apps', 'api', 'src', 'index.ts');
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
} else {
  console.error('[shardcloud] MONGODB_URI/MONGO_URI/DATABASE_URL not configured. Web will start, but /api routes and login will fail until MongoDB is configured.');
}

if (shouldBuildWeb()) {
  console.log('[shardcloud] Building Next web for production...');
  run('npm', ['--prefix', 'frequency-panel', 'run', 'build:web'], {
    cwd: rootDir,
    env: {
      INTERNAL_API_URL: process.env.INTERNAL_API_URL,
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL
    }
  });
}

ensureStandaloneWebAssets();

const web = fs.existsSync(standaloneServer)
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
const proxyServer = startProxy();

process.on('SIGINT', () => {
  web.kill('SIGINT');
  proxyServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  web.kill('SIGTERM');
  proxyServer.close();
  process.exit(0);
});
