import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { env } from './env.js';
import { collection, serializeDoc } from './db.js';

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'viewer';
};

export async function ensureAdminUser() {
  if (!env.mongoEnabled) {
    console.warn('[frequency-api] MongoDB ausente. Login administrativo usara fallback por ADMIN_EMAIL/ADMIN_PASSWORD.');
    return;
  }

  const hash = await bcrypt.hash(env.adminPassword, 12);
  try {
    const users = await collection('app_users');
    const now = new Date();
    await users.updateOne(
      { email: env.adminEmail.toLowerCase() },
      {
        $set: {
          email: env.adminEmail.toLowerCase(),
          name: 'Vortex Admin',
          password_hash: hash,
          role: 'admin',
          updated_at: now
        },
        $setOnInsert: {
          id: randomUUID(),
          created_at: now
        }
      },
      { upsert: true }
    );
  } catch (error) {
    console.warn('[frequency-api] MongoDB indisponivel. Login administrativo usara fallback por ADMIN_EMAIL/ADMIN_PASSWORD.', error);
  }
}

export async function login(email: string, password: string) {
  if (!env.mongoEnabled) {
    return fallbackLogin(email, password);
  }

  let user: (SessionUser & { password_hash: string }) | null = null;
  try {
    const users = await collection<SessionUser & { password_hash: string }>('app_users');
    user = serializeDoc(await users.findOne({ email: email.toLowerCase() }));
  } catch (error) {
    console.warn('[frequency-api] Falha ao consultar MongoDB no login. Usando fallback administrativo.', error);
    return fallbackLogin(email, password);
  }

  if (!user) return fallbackLogin(email, password);

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;

  const sessionUser: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role
  };
  const token = jwt.sign(sessionUser, env.jwtSecret, { expiresIn: '12h' });
  return { token, user: sessionUser };
}

function fallbackLogin(email: string, password: string) {
  if (email.toLowerCase() !== env.adminEmail.toLowerCase()) return null;
  if (password !== env.adminPassword) return null;

  const sessionUser: SessionUser = {
    id: 'fallback-admin',
    email: env.adminEmail.toLowerCase(),
    name: 'Vortex Admin',
    role: 'admin'
  };
  const token = jwt.sign(sessionUser, env.jwtSecret, { expiresIn: '12h' });
  return { token, user: sessionUser };
}

export function verifyToken(token: string): SessionUser | null {
  try {
    return jwt.verify(token, env.jwtSecret) as SessionUser;
  } catch {
    return null;
  }
}
