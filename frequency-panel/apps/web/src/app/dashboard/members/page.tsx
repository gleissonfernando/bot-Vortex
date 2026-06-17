'use client';

import { Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import { formatDate, formatSeconds } from '@/lib/format';
import { subscribeDashboardEvents } from '@/lib/realtime';
import { Link } from '@/lib/router';
import type { Member } from '@/lib/types';

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (role) params.set('role', role);
    if (status) params.set('status', status);
    return params.toString();
  }, [search, role, status]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch<{ members: Member[] }>(`/members?${query}`);
      setMembers(response.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar membros');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(load, 180);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => subscribeDashboardEvents(load), [query]);

  return (
    <AppShell>
      <header className="mb-6 animate-fade-up">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-slate-300">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-300" />
          Membros
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Membros cadastrados</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Apenas usuarios com cadastro salvo pelo /painel aparecem aqui.</p>
      </header>

      <section className="soft-panel mb-4 grid gap-3 rounded-lg p-3 md:grid-cols-[1fr_220px_180px_auto]">
        <label className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-lg border-white/10 bg-black/20 pl-10 text-white placeholder:text-slate-500 focus:border-sky-300/50 focus:ring-sky-300/30"
            placeholder="Nome, ID ou usuario"
          />
        </label>

        <input
          value={role}
          onChange={(event) => setRole(event.target.value)}
          className="rounded-lg border-white/10 bg-black/20 text-white placeholder:text-slate-500 focus:border-sky-300/50 focus:ring-sky-300/30"
          placeholder="Cargo ou ID"
        />

        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-lg border-white/10 bg-black/20 text-white focus:border-sky-300/50 focus:ring-sky-300/30"
        >
          <option value="">Todos</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
        </select>

        <button onClick={load} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.1]">
          <SlidersHorizontal size={16} />
          Filtrar
        </button>
      </section>

      {error ? <div className="mb-4 rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}

      <section className="panel overflow-hidden rounded-lg animate-fade-up">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Lista de cadastrados</h2>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-slate-300">{loading ? 'Carregando' : `${members.length} registros`}</span>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[920px] border-collapse">
            <thead className="bg-white/[0.035] text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Membro</th>
                <th className="px-4 py-3">Discord ID</th>
                <th className="px-4 py-3">Cargo</th>
                <th className="px-4 py-3">Tempo total</th>
                <th className="px-4 py-3">Pontos</th>
                <th className="px-4 py-3">Ultima atividade</th>
                <th className="px-4 py-3">Perfil</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className="border-t border-white/10 text-sm text-slate-300 transition hover:bg-white/[0.04]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <MemberAvatar member={member} size="sm" />
                      <div>
                        <div className="font-medium text-white">{discordDisplayName(member)}</div>
                        <div className="text-xs text-slate-500">{discordSubtitle(member)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{member.discord_user_id}</td>
                  <td className="px-4 py-3"><span className="rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-xs">{member.highest_role_name || 'N/A'}</span></td>
                  <td className="px-4 py-3 font-medium text-white">{formatSeconds(member.total_seconds || 0)}</td>
                  <td className="px-4 py-3">{member.session_count || 0}</td>
                  <td className="px-4 py-3">{formatDate(member.last_point_at || member.last_seen_at)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/members/${member.id}`} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/[0.08] hover:text-white">
                      Abrir
                    </Link>
                  </td>
                </tr>
              ))}
              {!members.length && !loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                    Nenhum membro cadastrado encontrado.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}

function discordDisplayName(member: Member) {
  return member.global_name || member.display_name || member.username || 'Membro';
}

function discordSubtitle(member: Member) {
  if (member.display_name && member.display_name !== discordDisplayName(member)) return member.display_name;
  return member.username ? `@${member.username}` : member.discord_user_id;
}

function MemberAvatar({ member, size = 'sm' }: { member: Member; size?: 'sm' | 'lg' }) {
  const sizeClass = size === 'lg' ? 'h-14 w-14 text-lg' : 'h-9 w-9 text-sm';
  const initials = discordDisplayName(member).slice(0, 2).toUpperCase();
  const avatarUrl = normalizeAvatarUrl(member.avatar_url);

  return (
    <div className={`${sizeClass} relative shrink-0 overflow-hidden rounded-lg bg-blue-500/15 font-semibold text-blue-200`}>
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={discordDisplayName(member)}
          className="relative z-10 block h-full w-full object-cover"
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      ) : null}
      <span className="absolute inset-0 z-0 grid place-items-center">{initials}</span>
    </div>
  );
}

function normalizeAvatarUrl(url?: string | null) {
  return String(url || '').replace(/\.webp(\?size=\d+)?$/i, '.png$1');
}
