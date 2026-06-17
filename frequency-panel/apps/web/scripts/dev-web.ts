import { spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(webDir, 'dist');
const port = Number(process.env.WEB_INTERNAL_PORT || process.env.PORT || 3001);
const host = process.argv.includes('--host') ? process.argv[process.argv.indexOf('--host') + 1] || '0.0.0.0' : '127.0.0.1';

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

function bin(name: string) {
  const extension = process.platform === 'win32' ? '.cmd' : '';
  const candidates = [
    path.join(webDir, 'node_modules', '.bin', `${name}${extension}`),
    path.join(webDir, '..', '..', 'node_modules', '.bin', `${name}${extension}`),
    path.join(webDir, '..', '..', '..', 'node_modules', '.bin', `${name}${extension}`)
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Binario ${name} nao encontrado. Rode npm --prefix frequency-panel install.`);
  return found;
}

const build = spawnSync(bin('tsx'), ['scripts/build-web.ts'], {
  cwd: webDir,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});
if (build.status !== 0) process.exit(build.status || 1);

function safeFile(urlPath: string) {
  const clean = decodeURIComponent(urlPath.split('?')[0] || '/').replace(/^\/+/, '');
  const direct = path.resolve(distDir, clean || 'index.html');
  const root = path.resolve(distDir);
  if (direct === root || direct.startsWith(`${root}${path.sep}`)) {
    if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  }
  return path.join(distDir, 'index.html');
}

http.createServer((req, res) => {
  const filePath = safeFile(req.url || '/');
  res.writeHead(200, {
    'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
    'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=3600'
  });
  fs.createReadStream(filePath).pipe(res);
}).listen(port, host, () => {
  console.log(`[web] Vortex TSX em http://${host}:${port}`);
});
