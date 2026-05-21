const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const rootDir = __dirname;
const panelDir = path.join(rootDir, 'frequency-panel');
const webDir = path.join(panelDir, 'apps', 'web');
const apiPort = String(process.env.API_PORT || 4100);
const webPort = String(process.env.PORT || 3000);

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
    process.exit(code || 1);
  });

  return child;
}

if (!process.env.DATABASE_URL) {
  console.error('[shardcloud] Missing DATABASE_URL. Configure PostgreSQL in ShardCloud before starting the panel.');
  process.exit(1);
}

process.env.JWT_SECRET ||= 'change-this-jwt-secret-in-shardcloud';
process.env.INGEST_SECRET ||= 'change-this-ingest-secret-in-shardcloud';
process.env.API_ORIGIN ||= process.env.PUBLIC_BASE_URL || `http://localhost:${webPort}`;
process.env.INTERNAL_API_URL ||= `http://127.0.0.1:${apiPort}`;
process.env.NEXT_PUBLIC_API_URL ||= '/api';

run('npm', ['--prefix', 'frequency-panel', 'run', 'build:api']);
run('npm', ['--prefix', 'frequency-panel', 'run', 'build:web'], {
  env: {
    INTERNAL_API_URL: process.env.INTERNAL_API_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL
  }
});

start('frequency-api', 'npm', ['--prefix', 'frequency-panel', 'run', 'start:api'], {
  env: {
    API_PORT: apiPort,
    API_ORIGIN: process.env.API_ORIGIN
  }
});

start('frequency-web', 'npm', ['--prefix', 'frequency-panel', '--workspace', 'apps/web', 'run', 'start', '--', '-p', webPort], {
  cwd: rootDir,
  env: {
    INTERNAL_API_URL: process.env.INTERNAL_API_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL
  }
});
