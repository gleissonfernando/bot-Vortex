const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const skipBuild = args.has('--skip-build') || process.env.SKIP_BUILD === '1';
const strictEnv = args.has('--strict-env') || process.env.SHARDCLOUD_STRICT_ENV === 'true';

let failures = 0;

function log(message) {
  console.log(`[deploy:check] ${message}`);
}

function fail(message) {
  failures += 1;
  console.error(`[deploy:check] FAIL ${message}`);
}

function ok(message) {
  console.log(`[deploy:check] OK ${message}`);
}

function readText(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function requireFile(relativePath, label = relativePath) {
  if (fileExists(relativePath)) {
    ok(`${label} encontrado`);
    return true;
  }
  fail(`${label} nao encontrado em ${relativePath}`);
  return false;
}

function parseKeyValueFile(relativePath) {
  const entries = {};
  if (!fileExists(relativePath)) return entries;
  const lines = readText(relativePath).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    entries[match[1]] = match[2].trim();
  }
  return entries;
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function versionAtLeast(actual, minimum) {
  const current = actual.split('.').map((part) => Number(part));
  const required = minimum.split('.').map((part) => Number(part));
  for (let index = 0; index < required.length; index += 1) {
    if ((current[index] || 0) > required[index]) return true;
    if ((current[index] || 0) < required[index]) return false;
  }
  return true;
}

function run(command, commandArgs, options = {}) {
  log(`${command} ${commandArgs.join(' ')}`);
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || rootDir,
    env: { ...process.env, ...(options.env || {}) },
    shell: process.platform === 'win32',
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(' ')} saiu com codigo ${result.status || 1}`);
    return false;
  }
  return true;
}

function walkJsFiles(target, output = []) {
  const absolute = path.join(rootDir, target);
  if (!fs.existsSync(absolute)) return output;
  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    if (target.endsWith('.js') || target.endsWith('.cjs')) output.push(target);
    return output;
  }
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
    walkJsFiles(path.join(target, entry.name), output);
  }
  return output;
}

function checkSyntax() {
  const targets = [
    'index.js',
    'deploy-commands.js',
    'shardcloud-start.js',
    'commands',
    'config',
    'events',
    'models',
    'src',
    'utils'
  ];
  const files = [...new Set(targets.flatMap((target) => walkJsFiles(target)))].sort();
  for (const file of files) {
    run(process.execPath, ['--check', file]);
  }
  ok(`${files.length} arquivos JS verificados com node --check`);
}

function checkPackageScripts() {
  const packageJson = readJson('package.json');
  const scripts = packageJson.scripts || {};
  if (scripts.start === 'node shardcloud-start.js') {
    ok('npm start aponta para shardcloud-start.js');
  } else {
    fail('package.json precisa manter "start": "node shardcloud-start.js"');
  }

  if (String(scripts.postinstall || '').includes('npm --prefix frequency-panel install')) {
    ok('postinstall instala as dependencias do frequency-panel');
  } else {
    fail('postinstall precisa instalar frequency-panel para a hospedagem');
  }

  if (versionAtLeast(process.versions.node, '20.19.0')) {
    ok(`Node ${process.versions.node} atende >=20.19.0`);
  } else {
    fail(`Node ${process.versions.node} nao atende >=20.19.0`);
  }
}

function checkShardCloudFile() {
  requireFile('.shardcloud', '.shardcloud');
  const shard = parseKeyValueFile('.shardcloud');
  if (shard.MAIN === 'shardcloud-start.js') {
    ok('.shardcloud MAIN correto');
  } else {
    fail('.shardcloud precisa usar MAIN=shardcloud-start.js');
  }

  const customCommand = shard.CUSTOM_COMMAND || '';
  const gitDeployMode = /SHARDCLOUD_DEPLOY_MODE=git/.test(customCommand);
  if (customCommand.includes('npm start')) {
    ok('.shardcloud CUSTOM_COMMAND chama npm start');
  } else {
    fail('.shardcloud CUSTOM_COMMAND precisa chamar npm start');
  }

  if (gitDeployMode) {
    ok('.shardcloud usa modo Git da ShardCloud');
    if (/BUILD_API_ON_STARTUP=true/.test(customCommand) && /BUILD_WEB_ON_STARTUP=true/.test(customCommand)) {
      ok('.shardcloud compila API e web no start para deploy Git');
    } else {
      fail('modo Git precisa de BUILD_API_ON_STARTUP=true e BUILD_WEB_ON_STARTUP=true');
    }
    if (/REQUIRE_BUILT_ASSETS=true/.test(customCommand)) {
      fail('modo Git nao pode exigir artefatos prontos, pois .next/dist nao vem do Git');
    }
    return;
  }

  if (/REQUIRE_BUILT_ASSETS=true/.test(customCommand)) {
    ok('.shardcloud exige artefatos prontos para upload por API');
  } else {
    fail('.shardcloud precisa de REQUIRE_BUILT_ASSETS=true ou SHARDCLOUD_DEPLOY_MODE=git');
  }

  if (/BUILD_API_ON_STARTUP=true|BUILD_WEB_ON_STARTUP=true/.test(customCommand)) {
    fail('upload por API nao deve compilar no boot; use npm run deploy:check antes de enviar');
  } else {
    ok('.shardcloud nao compila no boot');
  }
}

function checkWorkflow() {
  requireFile('.github/workflows/shardcloud-deploy.yml', 'workflow ShardCloud');
  const workflow = readText('.github/workflows/shardcloud-deploy.yml');
  const requiredSnippets = [
    'npm run deploy:check',
    '-x ".env"',
    '-x ".env.*"',
    '-x "node_modules/*"',
    '-x "frequency-panel/node_modules/*"',
    '--write-out "%{http_code}"',
    'user cannot update project'
  ];
  for (const snippet of requiredSnippets) {
    if (workflow.includes(snippet)) {
      ok(`workflow contem ${snippet}`);
    } else {
      fail(`workflow precisa conter ${snippet}`);
    }
  }
}

function checkEnvExamples() {
  const rootExample = readText('.env.example');
  const panelExample = readText('frequency-panel/.env.example');
  for (const name of ['MONGODB_URI', 'JWT_SECRET', 'INGEST_SECRET', 'DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'SITE_ORIGIN']) {
    if (rootExample.includes(`${name}=`)) {
      ok(`.env.example lista ${name}`);
    } else {
      fail(`.env.example precisa listar ${name}`);
    }
  }

  if (panelExample.includes('BOT_INGEST_SECRET=replace-with-the-same-value-as-ingest-secret')) {
    ok('frequency-panel/.env.example documenta BOT_INGEST_SECRET');
  } else {
    fail('frequency-panel/.env.example precisa documentar BOT_INGEST_SECRET');
  }
}

function checkStrictEnv() {
  if (!strictEnv) return;
  const env = { ...parseKeyValueFile('.env'), ...process.env };
  const secretChecks = [
    ['JWT_SECRET', 32],
    ['INGEST_SECRET', 32],
    ['ADMIN_PASSWORD', 12]
  ];
  for (const [name, minLength] of secretChecks) {
    const value = String(env[name] || '');
    if (value.length >= minLength && !/^(change-this|replace-|put-your-)/i.test(value)) {
      ok(`${name} forte o suficiente`);
    } else {
      fail(`${name} ausente/fraco no ambiente de deploy`);
    }
  }

  if (env.DISCORD_TOKEN || env.DISCORD_BOT_TOKEN) {
    ok('token do bot Discord configurado');
  } else {
    fail('DISCORD_TOKEN ou DISCORD_BOT_TOKEN precisa estar configurado');
  }

  if (String(env.NODE_TLS_REJECT_UNAUTHORIZED || '') === '0') {
    fail('NODE_TLS_REJECT_UNAUTHORIZED=0 nao pode ir para deploy');
  }
}

function checkBuildArtifacts() {
  requireFile('frequency-panel/apps/api/dist/index.js', 'Frequency API dist');
  requireFile('frequency-panel/apps/web/.next/standalone/apps/web/server.js', 'Next standalone server');
  requireFile('frequency-panel/apps/web/.next/static', 'Next static assets');
  requireFile('frequency-panel/apps/web/public/vortex-logo.png', 'public vortex-logo.png');
}

function main() {
  log('iniciando regra de deploy ShardCloud');
  checkPackageScripts();
  checkShardCloudFile();
  checkWorkflow();
  checkEnvExamples();
  checkStrictEnv();
  checkSyntax();

  if (!skipBuild) {
    run('npm', ['--prefix', 'frequency-panel', 'run', 'build'], {
      env: {
        NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ? '1' : process.env.NODE_TLS_REJECT_UNAUTHORIZED
      }
    });
  } else {
    log('build pulada por --skip-build');
  }

  checkBuildArtifacts();

  if (failures > 0) {
    console.error(`[deploy:check] ${failures} falha(s) encontrada(s). Corrija antes de subir para a ShardCloud.`);
    process.exit(1);
  }

  ok('repo pronto para empacotar e enviar para a ShardCloud');
}

main();
