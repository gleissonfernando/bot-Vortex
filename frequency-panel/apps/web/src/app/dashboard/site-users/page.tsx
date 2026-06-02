'use client';

import { Ban, CheckCircle2, History, Loader2, Plus, Shield, Trash2, UserX } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';

type SiteUser = {
  id: string;
  discord_id: string;
  discord_name: string;
  system_role: 'admin' | 'manager' | 'viewer';
  permission_level: number;
  status: 'active' | 'suspended' | 'banned';
  registered_by_name?: string | null;
  registered_at?: string;
  last_login_at?: string | null;
};

type AuditItem = {
  action: string;
  actor_name?: string | null;
  created_at: string;
};

export default function SiteUsersPage() {
  const [users, setUsers] = useState<SiteUser[]>([]);
  const [history, setHistory] = useState<Record<string, AuditItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ discordId: '', discordName: '', systemRole: 'viewer', permissionLevel: 1 });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<{ users: SiteUser[] }>('/site-users');
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar usuarios');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await apiFetch('/site-users', {
      method: 'POST',
      body: JSON.stringify({
        discordId: form.discordId,
        discordName: form.discordName,
        systemRole: form.systemRole,
        permissionLevel: Number(form.permissionLevel),
        status: 'active'
      })
    });
    setForm({ discordId: '', discordName: '', systemRole: 'viewer', permissionLevel: 1 });
    await load();
  }

  async function action(discordId: string, path: string, method = 'POST') {
    await apiFetch(`/site-users/${discordId}${path}`, { method, body: method === 'DELETE' ? undefined : JSON.stringify({}) });
    await load();
  }

  async function toggleHistory(discordId: string) {
    if (history[discordId]) {
      setHistory((current) => ({ ...current, [discordId]: [] }));
      return;
    }
    const data = await apiFetch<{ history: AuditItem[] }>(`/site-users/${discordId}/history`);
    setHistory((current) => ({ ...current, [discordId]: data.history }));
  }

  return (
    <AppShell>
      <header className="mb-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-sky-300/15 bg-sky-400/10 px-3 py-1 text-xs font-semibold text-sky-100">
          <Shield size={14} />
          Acesso web
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Gerenciamento de Usuários</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Somente usuarios cadastrados pelo Discord ou por administradores autorizados podem acessar o painel.</p>
      </header>

      <form onSubmit={submit} className="premium-card mb-5 grid gap-3 p-4 md:grid-cols-[1fr_1fr_180px_150px_auto]">
        <input value={form.discordId} onChange={(event) => setForm({ ...form, discordId: event.target.value })} required placeholder="Discord ID" className="rounded-2xl border-white/10 bg-black/20 text-white placeholder:text-slate-500" />
        <input value={form.discordName} onChange={(event) => setForm({ ...form, discordName: event.target.value })} required placeholder="Nome no Discord" className="rounded-2xl border-white/10 bg-black/20 text-white placeholder:text-slate-500" />
        <select value={form.systemRole} onChange={(event) => setForm({ ...form, systemRole: event.target.value })} className="rounded-2xl border-white/10 bg-black/20 text-white">
          <option value="viewer">Visualizador</option>
          <option value="manager">Gerente</option>
          <option value="admin">Admin</option>
        </select>
        <input value={form.permissionLevel} onChange={(event) => setForm({ ...form, permissionLevel: Number(event.target.value) })} min={1} max={100} type="number" className="rounded-2xl border-white/10 bg-black/20 text-white" />
        <button className="inline-flex items-center justify-center gap-2 rounded-2xl bg-vortex-primary px-4 py-2 text-sm font-semibold text-vortex-bg transition hover:shadow-[var(--vx-glow)]">
          <Plus size={16} />
          Cadastrar
        </button>
      </form>

      {error ? <div className="mb-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}

      <section className="premium-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Contas cadastradas</h2>
          <span className="text-xs font-semibold text-slate-400">{loading ? 'Carregando' : `${users.length} usuarios`}</span>
        </div>

        {loading ? <div className="flex items-center gap-2 p-4 text-sm text-slate-400"><Loader2 className="animate-spin" size={16} /> Carregando usuarios...</div> : null}

        <div className="divide-y divide-white/10">
          {users.map((user) => (
            <article key={user.discord_id} className="p-4 transition hover:bg-vortex-hover">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-white">{user.discord_name}</h3>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-xs text-slate-300">{user.discord_id}</span>
                    <StatusBadge status={user.status} />
                  </div>
                  <p className="mt-1 text-sm text-slate-400">Cargo: {user.system_role} | Nivel: {user.permission_level} | Responsavel: {user.registered_by_name || 'N/A'}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button onClick={() => action(user.discord_id, '/activate')} className="icon-action text-emerald-100"><CheckCircle2 size={16} /> Ativar</button>
                  <button onClick={() => action(user.discord_id, '/suspend')} className="icon-action text-amber-100"><UserX size={16} /> Suspender</button>
                  <button onClick={() => action(user.discord_id, '/ban')} className="icon-action text-red-100"><Ban size={16} /> Banir</button>
                  <button onClick={() => toggleHistory(user.discord_id)} className="icon-action text-sky-100"><History size={16} /> Historico</button>
                  <button onClick={() => action(user.discord_id, '', 'DELETE')} className="icon-action text-red-100"><Trash2 size={16} /> Remover</button>
                </div>
              </div>

              {history[user.discord_id]?.length ? (
                <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
                  {history[user.discord_id].slice(0, 6).map((item, index) => (
                    <p key={`${item.action}-${index}`}>{item.action} por {item.actor_name || 'sistema'} em {new Date(item.created_at).toLocaleString('pt-BR')}</p>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

function StatusBadge({ status }: { status: SiteUser['status'] }) {
  const classes = status === 'active'
    ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100'
    : status === 'suspended'
      ? 'border-amber-300/20 bg-amber-400/10 text-amber-100'
      : 'border-red-300/20 bg-red-400/10 text-red-100';
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${classes}`}>{status}</span>;
}
