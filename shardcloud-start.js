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

if (process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN) {
  start('discord-bot', 'npm', ['run', 'start:bot'], {
    env: {
      API_PORT: botApiPort,
      API_HOST: '0.0.0.0'
    },
    fatal: false
  });
} else {
  console.error('[shardcloud] DISCORD_TOKEN/DISCORD_BOT_TOKEN not configured. Discord bot will not start.');
}

if (process.env.MONGODB_URI || process.env.MONGO_URI) {
  const apiArgs = fs.existsSync(apiDist)
    ? ['--prefix', 'frequency-panel', 'run', 'start:api']
    : ['--prefix', 'frequency-panel', '--workspace', 'apps/api', 'exec', 'tsx', 'src/index.ts'];
  start('frequency-api', 'npm', apiArgs, {
    env: {
      API_PORT: apiPort,
      API_ORIGIN: process.env.API_ORIGIN
    },
    fatal: false
  });
} else {
  console.error('[shardcloud] MONGODB_URI not configured. Web will start, but /api routes and login will fail until MongoDB is configured.');
}

const web = fs.existsSync(standaloneServer)
  ? start('frequency-web', 'node', [standaloneServer], {
      cwd: webDir,
      env: {
        HOSTNAME: '0.0.0.0',
        PORT: webInternalPort,
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
