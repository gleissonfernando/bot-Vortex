import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env.js';
import { getDb } from '../db.js';
const SKIPPED_COLLECTIONS = new Set(['system.profile']);
export async function createBackup(reason = 'manual') {
    const db = await getDb();
    const backupDir = backupRoot();
    await mkdir(backupDir, { recursive: true });
    const collections = await db.listCollections().toArray();
    const payload = {
        service: 'vortex-frequency-api',
        created_at: new Date().toISOString(),
        collections: {}
    };
    for (const item of collections) {
        if (SKIPPED_COLLECTIONS.has(item.name))
            continue;
        payload.collections[item.name] = await db.collection(item.name).find({}).toArray();
    }
    const stamp = payload.created_at.replace(/[:.]/g, '-');
    const filename = `vortex-${reason}-${stamp}.json`;
    const filePath = path.join(backupDir, filename);
    await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { filename, path: filePath, created_at: payload.created_at };
}
export async function listBackups() {
    const backupDir = backupRoot();
    await mkdir(backupDir, { recursive: true });
    const files = await readdir(backupDir);
    return files.filter((file) => /^vortex-[\w-]+-\d{4}-\d{2}-\d{2}T.+\.json$/.test(file)).sort().reverse();
}
export async function restoreBackup(filename) {
    const filePath = resolveBackupFile(filename);
    const raw = await readFile(filePath, 'utf8');
    const payload = JSON.parse(raw);
    if (payload.service !== 'vortex-frequency-api' || !payload.collections) {
        throw new Error('Arquivo de backup invalido');
    }
    const db = await getDb();
    for (const [name, docs] of Object.entries(payload.collections)) {
        if (!Array.isArray(docs) || SKIPPED_COLLECTIONS.has(name))
            continue;
        const target = db.collection(name);
        await target.deleteMany({});
        if (docs.length)
            await target.insertMany(docs);
    }
    return { filename, restored_at: new Date().toISOString() };
}
export function scheduleDailyBackup() {
    const dayMs = 24 * 60 * 60 * 1000;
    const timer = setInterval(() => {
        void createBackup('daily').catch((error) => {
            console.warn('[frequency-api] Backup automatico falhou:', error);
        });
    }, dayMs);
    timer.unref?.();
}
function backupRoot() {
    return path.resolve(process.cwd(), env.backupDir);
}
function resolveBackupFile(filename) {
    if (!/^[\w.-]+\.json$/.test(filename))
        throw new Error('Nome de backup invalido');
    const root = backupRoot();
    const filePath = path.resolve(root, filename);
    if (!filePath.startsWith(root + path.sep))
        throw new Error('Caminho de backup invalido');
    return filePath;
}
