const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const rootDir = __dirname;
const panelDir = path.join(rootDir, 'frequency-panel');
const webDir = path.join(panelDir, 'apps', 'web');
const apiPort = String(process.env.INTERNAL_API_PORT || process.env.FREQUENCY_API_PORT || 4100);
const webPort = String(process.env.PORT || process.env.WEB_PORT || 80);
const standaloneServer = path.join(webDir, '.next', 'standalone', 'apps', 'web', 'server.js');
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

if (!fs.existsSync(path.join(panelDir, 'apps', 'api', 'dist', 'index.js'))) {
  console.log('[shardcloud] API build not found; building now.');
  run('npm', ['--prefix', 'frequency-panel', 'run', 'build:api']);
}

if (!fs.existsSync(path.join(webDir, '.next'))) {
  console.log('[shardcloud] Web build not found; building now.');
  run('npm', ['--prefix', 'frequency-panel', 'run', 'build:web'], {
    env: {
      INTERNAL_API_URL: process.env.INTERNAL_API_URL,
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL
    }
  });
}

if (!fs.existsSync(standaloneServer)) {
  console.error(`[shardcloud] Standalone server not found: ${standaloneServer}`);
  console.error('[shardcloud] Run npm --prefix frequency-panel run build:web before starting.');
  process.exit(1);
}

if (process.env.MONGODB_URI || process.env.MONGO_URI) {
  start('frequency-api', 'npm', ['--prefix', 'frequency-panel', 'run', 'start:api'], {
    env: {
      API_PORT: apiPort,
      API_ORIGIN: process.env.API_ORIGIN
    },
    fatal: false
  });
} else {
  console.error('[shardcloud] MONGODB_URI not configured. Web will start, but /api routes and login will fail until MongoDB is configured.');
}

const web = start('frequency-web', 'node', [standaloneServer], {
  cwd: webDir,
  env: {
    HOSTNAME: '0.0.0.0',
    PORT: webPort,
    INTERNAL_API_URL: process.env.INTERNAL_API_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL
  }
});

process.on('SIGINT', () => {
  web.kill('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  web.kill('SIGTERM');
  process.exit(0);
});
