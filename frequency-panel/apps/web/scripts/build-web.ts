import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const panelDir = path.resolve(webDir, '..', '..');
const rootDir = path.resolve(panelDir, '..');
const distDir = path.join(webDir, 'dist');
const assetsDir = path.join(distDir, 'assets');
const srcDir = path.join(webDir, 'src');
const entryFile = path.join(srcDir, 'main.tsx');
const startCwd = process.cwd();
const requireFromWeb = createRequire(path.join(webDir, 'package.json'));

process.env.VORTEX_WEB_BUILD_DEBUG ||= 'false';

if (!fs.existsSync(entryFile)) {
  throw new Error(`Entrada TSX nao encontrada: ${entryFile}`);
}

console.log(`[web] Fonte TSX: ${path.relative(rootDir, entryFile)}`);

if (process.env.VORTEX_WEB_BUILD_DEBUG === 'true') {
  console.error('[web:debug]', JSON.stringify({
    cwd: startCwd,
    webDir,
    srcDir,
    mainExists: true
  }));
}

function bin(name: string) {
  const extension = process.platform === 'win32' ? '.cmd' : '';
  const candidates = [
    path.join(webDir, 'node_modules', '.bin', `${name}${extension}`),
    path.join(panelDir, 'node_modules', '.bin', `${name}${extension}`),
    path.join(rootDir, 'node_modules', '.bin', `${name}${extension}`)
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Binario ${name} nao encontrado. Rode npm --prefix frequency-panel install.`);
  return found;
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: webDir,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function copyIfExists(from: string, to: string) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function resolveFilePath(basePath: string) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function resolveSourceAlias(aliasPath: string) {
  const found = resolveFilePath(path.join(srcDir, aliasPath.slice(2)));
  if (!found) throw new Error(`Alias nao encontrado: ${aliasPath}`);
  return found;
}

function resolveRelativeImport(importPath: string, resolveDir: string) {
  const found = resolveFilePath(path.resolve(resolveDir || webDir, importPath));
  if (!found) throw new Error(`Import relativo nao encontrado: ${importPath}`);
  return found;
}

function resolvePackageImport(importPath: string) {
  return requireFromWeb.resolve(importPath);
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(assetsDir, { recursive: true });

run(bin('tsc'), ['-p', 'tsconfig.json', '--noEmit']);
run(bin('tailwindcss'), [
  '-c', 'tailwind.config.ts',
  '-i', 'src/app/globals.css',
  '-o', 'dist/assets/site.css',
  '--minify'
]);

const { build } = await import('esbuild');

await build({
  absWorkingDir: webDir,
  stdin: {
    contents: "import './src/main.tsx';",
    loader: 'tsx',
    resolveDir: webDir,
    sourcefile: 'vortex-web-entry.tsx'
  },
  outfile: path.join(assetsDir, 'app.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  define: {
    'process.env.NEXT_PUBLIC_API_URL': JSON.stringify(process.env.NEXT_PUBLIC_API_URL || '/api'),
    'process.env.NEXT_PUBLIC_ENABLE_PASSWORD_LOGIN': JSON.stringify(process.env.NEXT_PUBLIC_ENABLE_PASSWORD_LOGIN || 'false'),
    'process.env.NEXT_PUBLIC_SESSION_IDLE_TIMEOUT_MS': JSON.stringify(process.env.NEXT_PUBLIC_SESSION_IDLE_TIMEOUT_MS || '')
  },
  plugins: [{
    name: 'vortex-path-alias',
    setup(api) {
      api.onResolve({ filter: /^\.\/src\/main\.tsx$/ }, () => ({
        path: entryFile
      }));
      api.onResolve({ filter: /^@\// }, (args) => ({
        path: resolveSourceAlias(args.path)
      }));
      api.onResolve({ filter: /^\./ }, (args) => ({
        path: resolveRelativeImport(args.path, args.resolveDir)
      }));
      api.onResolve({ filter: /^[^./]|^@/ }, (args) => {
        if (args.path.startsWith('@/')) return undefined;
        return { path: resolvePackageImport(args.path) };
      });
    }
  }]
});

copyIfExists(path.join(webDir, 'public', 'vortex-logo.png'), path.join(distDir, 'vortex-logo.png'));

fs.writeFileSync(path.join(distDir, 'index.html'), `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vortex</title>
  <meta name="description" content="Painel de frequencia para membros do Discord">
  <link rel="stylesheet" href="/assets/site.css">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/assets/app.js"></script>
</body>
</html>
`, 'utf8');

console.log(`[web] Vortex TSX build pronto em ${path.relative(rootDir, distDir)}`);
