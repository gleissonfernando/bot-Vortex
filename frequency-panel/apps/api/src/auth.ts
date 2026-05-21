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
  const hash = await bcrypt.hash(env.adminPassword, 12);
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
}

export async function login(email: string, password: string) {
  const users = await collection<SessionUser & { password_hash: string }>('app_users');
  const user = serializeDoc(await users.findOne({ email: email.toLowerCase() }));
  if (!user) return null;

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

export function verifyToken(token: string): SessionUser | null {
  try {
    return jwt.verify(token, env.jwtSecret) as SessionUser;
  } catch {
    return null;
  }
}
