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

const compactEnvKeys = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_OAUTH_REDIRECT_URI',
  'REGISTER_COMMANDS_ON_STARTUP',
  'ENABLE_PRESENCE_FEATURES',
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
  'LIVE_ALERT_CHECK_INTERVAL_MS',
  'LIVE_ALERT_WRITE_OFFLINE_HEARTBEAT',
  'MONGODB_URI',
  'MONGODB_REQUIRED',
  'MONGODB_MAX_POOL_SIZE',
  'MONGODB_MAX_IDLE_TIME_MS',
  'MONGODB_SERVER_SELECTION_TIMEOUT_MS',
  'VORTEX_TRANSCRIPT_BASE_URL',
  'APP_URL',
  'SITE_ORIGIN',
  'API_PORT',
  'API_HOST',
  'BOT_API_PORT',
  'PORT',
  'WEB_PORT',
  'WEB_INTERNAL_PORT',
  'JWT_SECRET',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
  'INGEST_SECRET',
  'BOT_INGEST_SECRET',
  'FREQUENCY_API_URL',
  'FREQUENCY_DASHBOARD_SYNC',
  'FREQUENCY_MEMBER_SYNC_INTERVAL_MS',
  'POINT_AUTOMATION_INTERVAL_MS'
];

function compactEnvLines(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function checkCompactEnvFile(relativePath, label, options = {}) {
  if (!fileExists(relativePath)) {
    if (options.optional) return;
    fail(`${label} nao encontrado em ${relativePath}`);
    return;
  }

  const lines = compactEnvLines(readText(relativePath));
  const keys = new Set();
  const duplicates = new Set();
  const invalid = [];

  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match) {
      invalid.push(line);
      continue;
    }
    if (keys.has(match[1])) duplicates.add(match[1]);
    keys.add(match[1]);
  }

  if (lines.length === compactEnvKeys.length) {
    ok(`${label} usa ${compactEnvKeys.length} linhas compactas`);
  } else {
    fail(`${label} precisa usar exatamente ${compactEnvKeys.length} linhas compactas; atual=${lines.length}`);
  }

  const missing = compactEnvKeys.filter((name) => !keys.has(name));
  if (missing.length === 0) {
    ok(`${label} contem todas as variaveis compactas`);
  } else {
    fail(`${label} sem variaveis compactas: ${missing.join(', ')}`);
  }

  if (duplicates.size === 0) {
    ok(`${label} nao duplica variaveis`);
  } else {
    fail(`${label} duplica variaveis: ${[...duplicates].join(', ')}`);
  }

  if (invalid.length === 0) {
    ok(`${label} contem apenas linhas KEY=VALUE`);
  } else {
    fail(`${label} contem linhas invalidas de env`);
  }
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
  const env = { ...process.env, ...(options.env || {}) };
  if (options.cleanNpmEnv) {
    for (const key of Object.keys(env)) {
      if (/^npm_/i.test(key) || key === 'INIT_CWD') delete env[key];
    }
    for (const key of ['PATH', 'Path', 'path']) {
      if (!env[key]) continue;
      env[key] = String(env[key])
        .split(path.delimiter)
        .filter((entry) => !/[\\/]node_modules[\\/]\.bin$/i.test(entry))
        .join(path.delimiter);
    }
  }
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || rootDir,
    env,
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
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
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

function checkDiscordCommands() {
  const commandsRoot = path.join(rootDir, 'commands');
  const commands = [];
  const names = new Set();
  const requiredCommands = ['encomenda', 'exibir', 'painel'];

  if (!fs.existsSync(commandsRoot)) {
    fail('pasta commands nao encontrada');
    return;
  }

  for (const folder of fs.readdirSync(commandsRoot)) {
    const folderPath = path.join(commandsRoot, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;

    for (const file of fs.readdirSync(folderPath).filter((entry) => entry.endsWith('.js'))) {
      const relativePath = path.join('commands', folder, file);
      const absolutePath = path.join(rootDir, relativePath);
      try {
        const command = require(absolutePath);
        if (!command?.data || !command?.execute) continue;

        const payload = command.data.toJSON();
        if (!payload?.name) {
          fail(`${relativePath} nao serializa nome de comando Discord`);
          continue;
        }

        if (names.has(payload.name)) {
          fail(`comando Discord duplicado: /${payload.name}`);
          continue;
        }

        names.add(payload.name);
        commands.push(payload.name);
      } catch (error) {
        fail(`${relativePath} nao carrega para registro Discord: ${error.message}`);
      }
    }
  }

  for (const commandName of requiredCommands) {
    if (names.has(commandName)) {
      ok(`comando /${commandName} pronto para registro no Discord`);
    } else {
      fail(`comando /${commandName} ausente do pacote de deploy`);
    }
  }

  ok(`${commands.length} comandos Discord serializados: ${commands.sort().join(', ')}`);
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

  if (scripts.build === 'npm run deploy:build') {
    ok('npm run build aponta para deploy:build');
  } else {
    fail('package.json precisa ter "build": "npm run deploy:build"');
  }

  if (scripts.dev === 'node scripts/dev-start.cjs') {
    ok('npm run dev aponta para scripts/dev-start.cjs');
  } else {
    fail('package.json precisa ter "dev": "node scripts/dev-start.cjs"');
  }

  if (versionAtLeast(process.versions.node, '20.19.0')) {
    ok(`Node ${process.versions.node} atende >=20.19.0`);
  } else {
    fail(`Node ${process.versions.node} nao atende >=20.19.0`);
  }
}

function checkNoNextRuntime() {
  const panelPackage = readJson('frequency-panel/package.json');
  const workspaces = Array.isArray(panelPackage.workspaces) ? panelPackage.workspaces : [];
  if (workspaces.includes('apps/web')) {
    ok('frequency-panel workspaces incluem apps/web para build TSX estatico');
  } else {
    fail('frequency-panel precisa incluir apps/web nos workspaces para gerar o site TSX da Vortex');
  }

  const requiredFiles = [
    'frequency-panel/apps/web/package.json',
    'frequency-panel/apps/web/src/main.tsx',
    'frequency-panel/apps/web/src/lib/router.tsx',
    'frequency-panel/apps/web/scripts/build-web.ts',
    'frequency-panel/apps/web/src/app/page.tsx',
    'frequency-panel/apps/web/src/app/layout.tsx'
  ];
  for (const file of requiredFiles) {
    requireFile(file, file);
  }

  const forbiddenFiles = [
    'frequency-panel/apps/web/next.config.mjs',
    'frequency-panel/apps/web/next-env.d.ts',
    'frequency-panel/apps/web/.next'
  ];
  for (const file of forbiddenFiles) {
    if (fileExists(file)) {
      fail(`${file} nao deve existir no web TSX sem Next`);
    } else {
      ok(`${file} ausente`);
    }
  }

  const packageFiles = [
    'package.json',
    'package-lock.json',
    'frequency-panel/package.json',
    'frequency-panel/package-lock.json',
    'frequency-panel/apps/web/package.json'
  ];
  for (const file of packageFiles) {
    if (!fileExists(file)) continue;
    const content = readText(file);
    if (/"next"\s*:|eslint-config-next|@next\//.test(content)) {
      fail(`${file} contem dependencia Next removida do sistema`);
    } else {
      ok(`${file} sem dependencias Next`);
    }
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

  if (/^[0-9a-fA-F-]{36}$/.test(shard.APPID || '')) {
    ok('.shardcloud APPID configurado');
  } else {
    fail('.shardcloud precisa ter APPID=<id-do-app> para commit/restart mirarem o app certo');
  }

  if (shard.LANGUAGE === 'node') {
    ok('.shardcloud LANGUAGE=node');
  } else {
    fail('.shardcloud precisa usar LANGUAGE=node');
  }

  const customCommand = shard.CUSTOM_COMMAND || '';
  if (customCommand === 'PORT=80 npm start') {
    ok('.shardcloud CUSTOM_COMMAND curto chama npm start na porta 80 em modo Node-only');
  } else {
    fail('.shardcloud CUSTOM_COMMAND precisa ser simples: PORT=80 npm start');
  }

  if (customCommand.length <= 250) {
    ok(`.shardcloud CUSTOM_COMMAND respeita limite de 250 caracteres (${customCommand.length})`);
  } else {
    fail(`.shardcloud CUSTOM_COMMAND passa de 250 caracteres (${customCommand.length})`);
  }

  if (/SHARDCLOUD_DEPLOY_MODE|BUILD_API_ON_STARTUP|BUILD_WEB_ON_STARTUP|REGISTER_COMMANDS_ON_STARTUP|NODE_OPTIONS/.test(customCommand)) {
    fail('.shardcloud CUSTOM_COMMAND nao deve carregar flags longas; os defaults ficam em shardcloud-start.js');
  } else {
    ok('.shardcloud deixa defaults de hospedagem dentro do runtime');
  }

  const memory = Number(shard.MEMORY);
  if (Number.isInteger(memory) && memory >= 512) {
    ok(`.shardcloud MEMORY adequado (${memory}MB)`);
  } else {
    fail('.shardcloud MEMORY precisa ser pelo menos 512');
  }
}

function checkWorkflow() {
  requireFile('.github/workflows/shardcloud-deploy.yml', 'workflow ShardCloud');
  const workflow = readText('.github/workflows/shardcloud-deploy.yml');
  const requiredSnippets = [
    'npm run deploy:check',
    'uses: shard-cloud/action@main',
    'SHARD_CLOUD_API_KEY',
    "grep -Eq '^APPID=",
    'Read ShardCloud app id',
    'id: shardcloud',
    'commands: |',
    'commit ${{ steps.shardcloud.outputs.app_id }}',
    'restart ${{ steps.shardcloud.outputs.app_id }}',
    'Validate public ShardCloud runtime',
    '$url/health',
    '$url$endpoint',
    '/api/health',
    'vortex-frequency-api',
    'https://shardcloud.app/api/apps/',
    'rm -rf node_modules',
    'rm -rf frequency-panel/apps/web/node_modules',
    'rm -rf frequency-panel/apps/web/.next',
    'rm -f .env .env.*',
    'rm -f commands/perfis.json',
    'rm -f commands/pointTranscripts.json',
    'rm -f commands/orderSettings.json',
    'rm -f commands/orders.json',
    'rm -f commands/orderLogs.json'
  ];
  for (const snippet of requiredSnippets) {
    if (workflow.includes(snippet)) {
      ok(`workflow contem ${snippet}`);
    } else {
      fail(`workflow precisa conter ${snippet}`);
    }
  }

  if (workflow.split(/\r?\n/).some((line) => line.trim() === 'rm -rf frequency-panel/apps/web')) {
    fail('workflow nao pode apagar frequency-panel/apps/web inteiro; ele contem o site TSX da Vortex');
  } else {
    ok('workflow preserva frequency-panel/apps/web e remove apenas caches/builds temporarios');
  }
}

function checkShardCloudRuntime() {
  requireFile('scripts/dev-start.cjs', 'script de dev local');
  const runtime = readText('shardcloud-start.js');
  const requiredSnippets = [
    'applyShardCloudRuntimeDefaults',
    'setRuntimeAlias',
    "ensureEphemeralSecret('JWT_SECRET', 32)",
    "ensureEphemeralSecret('INGEST_SECRET', 32)",
    "'/_shardcloud/health'",
    'BUILD_API_ON_STARTUP',
    'BUILD_WEB_ON_STARTUP',
    'START_PUBLIC_PROXY',
    'SHARDCLOUD_ALLOW_PUBLIC_PROXY_DISABLE',
    'SHARDCLOUD_REQUIRE_PORT_80',
    'REGISTER_COMMANDS_ON_STARTUP',
    'serveSiteIndex',
    "path.join(rootDir, 'frequency-panel', 'apps', 'web', 'dist')",
    "process.env.SHARDCLOUD_DEPLOY_MODE === 'git'"
  ];

  for (const snippet of requiredSnippets) {
    if (runtime.includes(snippet)) {
      ok(`runtime ShardCloud contem ${snippet}`);
    } else {
      fail(`runtime ShardCloud precisa conter ${snippet}`);
    }
  }

  if (/process\.env\.START_FREQUENCY_WEB\s*=\s*['"]false['"]/.test(runtime)) {
    ok('runtime ShardCloud desliga web separado e serve pagina publica pelo Node');
  } else {
    fail('runtime ShardCloud precisa manter START_FREQUENCY_WEB=false no modo Node-only');
  }

  if (/detectedMem <= 1024[\s\S]{0,500}calculated = Math\.min\(calculated, 256\)/.test(runtime)) {
    ok('runtime ShardCloud limita NODE_OPTIONS em MEMORY<=1024 para evitar OOM');
  } else {
    fail('runtime ShardCloud precisa limitar NODE_OPTIONS em MEMORY<=1024; heaps altos derrubam proxy/API/web no host de 1GB');
  }

  const lowMemorySnippets = [
    "process.env.BUILD_API_ON_STARTUP = 'false'",
    "process.env.BUILD_WEB_ON_STARTUP = 'false'",
    "process.env.START_FREQUENCY_WEB = 'false'",
    "process.env.REGISTER_COMMANDS_ON_STARTUP = 'false'",
    'DISCORD_BOT_START_DELAY_MS',
    'DISCORD_BOT_NODE_OPTIONS',
    'FREQUENCY_API_NODE_OPTIONS',
    'serveNodeSite(req, res, pathname)'
  ];
  for (const snippet of lowMemorySnippets) {
    if (runtime.includes(snippet)) {
      ok(`runtime ShardCloud baixa memoria contem ${snippet}`);
    } else {
      fail(`runtime ShardCloud baixa memoria precisa conter ${snippet}`);
    }
  }
}

function checkEnvExamples() {
  const rootExample = readText('.env.example');
  const panelExample = readText('frequency-panel/.env.example');
  const deployRule = readText('docs/SHARDCLOUD_DEPLOY_RULE.md');
  const panelReadme = readText('frequency-panel/README.md');
  checkCompactEnvFile('.env.example', '.env.example');
  checkCompactEnvFile('frequency-panel/.env.example', 'frequency-panel/.env.example');

  for (const alias of ['TOKEN', 'CLIENT_ID', 'GUILD_ID', 'DATABASE_URL', 'MONGO_URI', 'DISCORD_BOT_TOKEN']) {
    if (deployRule.includes(alias)) {
      ok(`docs explicam alias ${alias}`);
    } else {
      fail(`docs precisam explicar alias ${alias}`);
    }
  }

  for (const [file, content] of [
    ['.env.example', rootExample],
    ['frequency-panel/.env.example', panelExample],
    ['frequency-panel/README.md', panelReadme]
  ]) {
    for (const forbidden of ['valor_real_do_client_secret', 'put-your-discord-bot-token', 'put-your-discord-guild-id']) {
      if (content.includes(forbidden)) {
        fail(`${file} contem placeholder inseguro/desatualizado: ${forbidden}`);
      }
    }
  }
}

function checkStrictEnv() {
  if (!strictEnv) return;
  checkCompactEnvFile('.env', '.env local', { optional: true });
  const fileEnv = parseKeyValueFile('.env');
  const env = { ...fileEnv, ...process.env };
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

  if (env.DISCORD_TOKEN || env.DISCORD_BOT_TOKEN || env.TOKEN) {
    ok('token do bot Discord configurado');
  } else {
    fail('DISCORD_TOKEN, DISCORD_BOT_TOKEN ou TOKEN precisa estar configurado');
  }

  if (env.DISCORD_CLIENT_ID || env.CLIENT_ID || env.VITE_DISCORD_CLIENT_ID) {
    ok('client id do Discord configurado');
  } else {
    fail('DISCORD_CLIENT_ID, CLIENT_ID ou VITE_DISCORD_CLIENT_ID precisa estar configurado');
  }

  if (env.DISCORD_GUILD_ID || env.GUILD_ID || env.VITE_DISCORD_GUILD_ID) {
    ok('guild id do Discord configurado');
  } else {
    fail('DISCORD_GUILD_ID, GUILD_ID ou VITE_DISCORD_GUILD_ID precisa estar configurado');
  }

  const discordClientSecret = String(env.DISCORD_CLIENT_SECRET || '').trim();
  if (!discordClientSecret) {
    ok('DISCORD_CLIENT_SECRET vazio no .env local; configure o valor real na ShardCloud para OAuth Discord');
  } else if (
    /^\d{15,25}$/.test(discordClientSecret)
    || [env.DISCORD_CLIENT_ID, env.CLIENT_ID, env.VITE_DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID, env.GUILD_ID, env.VITE_DISCORD_GUILD_ID]
      .filter(Boolean)
      .includes(discordClientSecret)
  ) {
    fail('DISCORD_CLIENT_SECRET parece um ID publico; use o client secret real do Discord Developer Portal');
  } else {
    ok('DISCORD_CLIENT_SECRET nao parece ID publico');
  }

  if (env.MONGODB_URI || env.MONGO_URI || env.DATABASE_URL) {
    ok('URI do banco configurada');
  } else {
    fail('MONGODB_URI, MONGO_URI ou DATABASE_URL precisa estar configurado');
  }

  if (String(fileEnv.NODE_TLS_REJECT_UNAUTHORIZED || '') === '0') {
    fail('NODE_TLS_REJECT_UNAUTHORIZED=0 nao pode ir para deploy no .env');
  } else if (String(process.env.NODE_TLS_REJECT_UNAUTHORIZED || '') === '0') {
    ok('NODE_TLS_REJECT_UNAUTHORIZED=0 existe apenas no terminal local; .env de deploy esta limpo');
  }
}

function checkBuildArtifacts() {
  requireFile('frequency-panel/apps/api/dist/index.js', 'Frequency API dist');
  requireFile('frequency-panel/apps/bot/dist/index.js', 'Frequency bot dist');
  requireFile('frequency-panel/apps/web/dist/index.html', 'site TSX estatico index');
  requireFile('frequency-panel/apps/web/dist/assets/app.js', 'site TSX bundle JS');
  requireFile('frequency-panel/apps/web/dist/assets/site.css', 'site TSX CSS');
  requireFile('frequency-panel/apps/web/dist/vortex-logo.png', 'logo Vortex do site TSX');
  requireFile('public/sistema-de-bau-banner.png', 'public static asset');
}

function main() {
  log('iniciando regra de deploy ShardCloud');
  checkPackageScripts();
  checkNoNextRuntime();
  checkShardCloudFile();
  checkWorkflow();
  checkShardCloudRuntime();
  checkEnvExamples();
  checkStrictEnv();

  if (!skipBuild) {
    const buildOptions = {
      env: {
        NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ? '1' : process.env.NODE_TLS_REJECT_UNAUTHORIZED,
        VORTEX_WEB_BUILD_DEBUG: process.env.VORTEX_WEB_BUILD_DEBUG || 'false'
      },
      cleanNpmEnv: true
    };
    run('npm', ['--prefix', 'frequency-panel', 'run', 'build:api'], buildOptions);
    run('npm', ['--prefix', 'frequency-panel', 'run', 'build:bot'], buildOptions);
    run('npm', ['--prefix', 'frequency-panel', 'run', 'build:web'], buildOptions);
  } else {
    log('build pulada por --skip-build');
  }

  checkBuildArtifacts();
  checkSyntax();
  checkDiscordCommands();

  if (failures > 0) {
    console.error(`[deploy:check] ${failures} falha(s) encontrada(s). Corrija antes de subir para a ShardCloud.`);
    process.exit(1);
  }

  ok('repo pronto para empacotar e enviar para a ShardCloud');
}

main();
