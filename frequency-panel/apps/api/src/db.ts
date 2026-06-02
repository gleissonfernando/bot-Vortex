import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
import { env } from './env.js';

let client: MongoClient | null = null;
let database: Db | null = null;
let connectReady: Promise<Db> | null = null;
let indexesReady: Promise<void> | null = null;

function databaseNameFromUri(uri: string) {
  try {
    const withoutQuery = uri.split('?')[0] || '';
    const withoutScheme = withoutQuery.replace(/^mongodb(?:\+srv)?:\/\//i, '');
    const slashIndex = withoutScheme.indexOf('/');
    const pathname = slashIndex >= 0 ? withoutScheme.slice(slashIndex + 1).trim() : '';
    return decodeURIComponent(pathname) || 'vortex_frequency';
  } catch {
    return 'vortex_frequency';
  }
}

function readPositiveIntEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export async function getDb() {
  if (!env.mongoUri) {
    throw new Error('MongoDB not configured');
  }

  if (!database) {
    connectReady ||= (async () => {
      const nextClient = new MongoClient(env.mongoUri, {
        maxPoolSize: readPositiveIntEnv('MONGODB_MAX_POOL_SIZE', 5),
        minPoolSize: 0,
        maxIdleTimeMS: readPositiveIntEnv('MONGODB_MAX_IDLE_TIME_MS', 30000),
        serverSelectionTimeoutMS: readPositiveIntEnv('MONGODB_SERVER_SELECTION_TIMEOUT_MS', 10000)
      });

      client = nextClient;
      await nextClient.connect();
      database = nextClient.db(process.env.MONGODB_DB || databaseNameFromUri(env.mongoUri));
      return database;
    })().catch(async (error) => {
      const failedClient = client;
      client = null;
      database = null;
      connectReady = null;
      indexesReady = null;
      await failedClient?.close().catch(() => undefined);
      throw error;
    });

    database = await connectReady;
  }

  if (!database) throw new Error('MongoDB database unavailable');
  indexesReady ||= ensureIndexes(database);
  await indexesReady;
  return database;
}

async function ensureIndexes(db: Db) {
  await Promise.all([
    db.collection('app_users').createIndex({ email: 1 }, { unique: true }),
    db.collection('discord_members').createIndex({ guild_id: 1, discord_user_id: 1 }, { unique: true }),
    db.collection('discord_members').createIndex({ guild_id: 1, display_name: 1 }),
    db.collection('city_presence').createIndex({ guild_id: 1, discord_user_id: 1 }, { unique: true }),
    db.collection('city_presence').createIndex({ city_online: 1, seen_at: -1 }),
    db.collection('attendance_sessions').createIndex({ member_id: 1, opened_at: -1 }),
    db.collection('absence_records').createIndex({ member_id: 1, date_key: -1 }),
    db.collection('audit_events').createIndex({ created_at: -1 }),
    db.collection('security_audit_logs').createIndex({ created_at: -1 }),
    db.collection('security_audit_logs').createIndex({ action: 1, created_at: -1 }),
    db.collection('site_users').createIndex({ guild_id: 1, discord_id: 1 }, { unique: true }),
    db.collection('site_users').createIndex({ status: 1, system_role: 1 }),
    db.collection('site_user_audit_logs').createIndex({ guild_id: 1, target_discord_id: 1, created_at: -1 }),
    db.collection('jsondocuments').createIndex({ key: 1 }, { unique: true })
  ]);
}

export async function collection<T extends Document = Document>(name: string): Promise<Collection<T>> {
  return (await getDb()).collection<T>(name);
}

export function toDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toIso(value?: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function dateKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

export function serializeDoc<T extends Record<string, any>>(doc: T | null): T | null {
  if (!doc) return null;
  const copy: Record<string, any> = { ...doc };
  delete copy._id;
  for (const [key, value] of Object.entries(copy)) {
    if (value instanceof Date) copy[key] = value.toISOString();
  }
  return copy as T;
}

export function serializeDocs<T extends Record<string, any>>(docs: T[]): T[] {
  return docs.map((doc) => serializeDoc(doc) as T);
}
