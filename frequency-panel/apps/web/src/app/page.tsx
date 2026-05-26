'use client';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { API_URL, setToken } from '@/lib/api';

async function readJsonResponse(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(response.status === 502
      ? 'API indisponivel no ShardCloud. Reinicie a hospedagem e confira os logs do frequency-api.'
      : 'A API retornou uma pagina HTML em vez de JSON. Verifique o roteamento /api no ShardCloud.');
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.ok) throw new Error(data.error || 'Login invalido');
      setToken(data.token);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no login');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-surface-950 px-4">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.025)_1px,transparent_1px)] bg-[size:36px_36px] opacity-50" />
      <section className="panel relative w-full max-w-md rounded-lg p-6">
        <div className="mb-8 flex items-center gap-3">
          <div className="h-11 w-11 overflow-hidden rounded-lg border border-blue-400/20 bg-black">
            <img src="/vortex-logo.png" alt="Vortex" className="h-full w-full object-cover" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Vortex Frequency</h1>
            <p className="text-sm text-slate-400">Acesso administrativo</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-300">Email</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="username"
              className="w-full rounded-lg border-white/10 bg-white/[0.04] text-white placeholder:text-slate-500 focus:border-brand-400 focus:ring-brand-400"
              placeholder="admin@empresa.com"
              required
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-300">Senha</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              className="w-full rounded-lg border-white/10 bg-white/[0.04] text-white placeholder:text-slate-500 focus:border-brand-400 focus:ring-brand-400"
              placeholder="Sua senha"
              required
            />
          </label>

          {error ? <div className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-950/40 transition hover:bg-brand-400 disabled:opacity-60"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
}
