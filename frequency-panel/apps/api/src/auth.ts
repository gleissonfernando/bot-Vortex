import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from './env.js';
import { one, query } from './db.js';

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'viewer';
};

export async function ensureAdminUser() {
  const hash = await bcrypt.hash(env.adminPassword, 12);
  await query(
    `
      INSERT INTO app_users (email, name, password_hash, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email)
      DO UPDATE SET
        name = EXCLUDED.name,
        password_hash = EXCLUDED.password_hash,
        role = EXCLUDED.role,
        updated_at = now()
    `,
    [env.adminEmail, 'Vortex Admin', hash, 'admin']
  );
}

export async function login(email: string, password: string) {
  const user = await one<SessionUser & { password_hash: string }>(
    'SELECT id, email, name, role, password_hash FROM app_users WHERE email = $1',
    [email.toLowerCase()]
  );
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
