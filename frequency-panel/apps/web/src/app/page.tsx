'use client';
import { LogIn, ShieldCheck } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { API_URL, setToken } from '@/lib/api';
import { useRouter } from '@/lib/router';

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
    window.location.href = `${API_URL}/auth/discord/start?next=/dashboard`;
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
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-10">
      <img src="/vortex-logo.png" alt="" className="pointer-events-none absolute right-[-8%] top-1/2 hidden h-[110vh] -translate-y-1/2 object-cover opacity-[0.08] lg:block" />
      <section className="panel relative w-full min-w-0 max-w-[calc(100vw-2rem)] overflow-hidden p-7 sm:max-w-md sm:p-8">
        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-blue-500 via-cyan-300 to-emerald-300" />
        <div className="mb-8">
          <div className="h-16 w-16 overflow-hidden rounded-lg bg-black shadow-[0_0_28px_rgba(59,130,246,.18)]">
            <img src="/vortex-logo.png" alt="Vortex" className="h-full w-full object-cover" />
          </div>
          <div className="mt-5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-blue-200">
              <ShieldCheck size={15} />
              Ambiente protegido
            </div>
            <h1 className="mt-2 text-3xl font-semibold text-white">Vortex</h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">Acesse a central de gerenciamento do seu servidor.</p>
          </div>
        </div>

        <div className="space-y-4">
          <button
            type="button"
            onClick={loginWithDiscord}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-3 text-sm font-semibold text-white shadow-[0_0_24px_rgba(59,130,246,.24)] hover:bg-blue-400"
          >
            <LogIn size={17} />
            Entrar com Discord
          </button>

          {error ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
        </div>

        {process.env.NEXT_PUBLIC_ENABLE_PASSWORD_LOGIN === 'true' ? <form onSubmit={submit} className="mt-6 space-y-4 pt-6">
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
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-400 disabled:opacity-60"
          >
            <LogIn size={16} />
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form> : null}
      </section>
    </main>
  );
}
