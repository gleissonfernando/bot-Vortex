'use client';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setError(params.get('error') || '');
  }, []);

  function loginWithDiscord() {
    window.location.href = `${API_URL}/auth/discord/start?next=${encodeURIComponent('/dashboard')}`;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.ok) throw new Error(data.error || 'Login invalido');
      setToken(data.token || '', data.refreshToken || '');
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no login');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-surface-950 px-4">
      <div className="absolute inset-0 bg-[linear-gradient(var(--vx-border)_1px,transparent_1px),linear-gradient(90deg,var(--vx-border)_1px,transparent_1px)] bg-[size:36px_36px] opacity-40" />
      <section className="panel relative w-full max-w-md rounded-lg p-6">
        <div className="mb-8 flex items-center gap-3">
          <div className="h-11 w-11 overflow-hidden rounded-lg border border-blue-400/20 bg-black">
            <img src="/vortex-logo.png" alt="Vortex" className="h-full w-full object-cover" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Vortex</h1>
            <p className="text-sm text-slate-400">Acesso administrativo</p>
          </div>
        </div>

        <div className="space-y-4">
          <button
            type="button"
            onClick={loginWithDiscord}
            className="w-full rounded-lg bg-vortex-primary px-4 py-2.5 text-sm font-semibold text-vortex-bg shadow-lg shadow-blue-950/40 transition hover:bg-vortex-secondary hover:shadow-[var(--vx-glow)]"
          >
            Entrar com Discord
          </button>

          {error ? <div className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
        </div>

        {process.env.NEXT_PUBLIC_ENABLE_PASSWORD_LOGIN === 'true' ? <form onSubmit={submit} className="mt-6 space-y-4 border-t border-white/10 pt-6">
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

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-950/40 transition hover:bg-brand-400 disabled:opacity-60"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form> : null}
      </section>
    </main>
  );
}
