'use client';

import { Download, FileText, RefreshCcw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { apiFetch, downloadFile } from '@/lib/api';
import { formatDate, formatSeconds } from '@/lib/format';
import { subscribeDashboardEvents } from '@/lib/realtime';
import { Link } from '@/lib/router';
import type { Member } from '@/lib/types';

export default function ReportsPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    params.set('limit', '200');
    return params.toString();
  }, [search]);

  const exportQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params.toString();
  }, [from, to]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch<{ members: Member[] }>(`/members?${query}`);
      setMembers(response.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar relatorios');
    } finally {
      setLoading(false);
    }
  }

  async function exportMember(member: Member) {
    await downloadFile(`/members/${member.id}/export?${exportQuery}`, `relatorio-${member.discord_user_id}.csv`);
  }

  useEffect(() => {
    const timer = setTimeout(load, 180);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => subscribeDashboardEvents(load), [query]);

  const totals = members.reduce(
    (acc, member) => ({
      seconds: acc.seconds + Number(member.total_seconds || 0),
      sessions: acc.sessions + Number(member.session_count || 0)
    }),
    { seconds: 0, sessions: 0 }
  );

  return (
    <AppShell>
      <header className="mb-6 animate-fade-up">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-slate-300">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-300" />
          Relatorios
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Relatorios dos cadastrados</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          Exporte frequencia e acompanhe pontos apenas dos usuarios com cadastro salvo pelo /painel.
        </p>
      </header>

      <section className="mb-4 grid gap-3 md:grid-cols-3">
        <SummaryCard label="Cadastrados" value={loading ? '...' : String(members.length)} />
        <SummaryCard label="Pontos" value={loading ? '...' : String(totals.sessions)} />
        <SummaryCard label="Tempo total" value={loading ? '...' : formatSeconds(totals.seconds)} />
      </section>

      <section className="soft-panel mb-4 grid gap-3 rounded-lg p-3 lg:grid-cols-[1fr_170px_170px_auto]">
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
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          type="date"
          className="rounded-lg border-white/10 bg-black/20 text-white focus:border-sky-300/50 focus:ring-sky-300/30"
        />
        <input
          value={to}
          onChange={(event) => setTo(event.target.value)}
          type="date"
          className="rounded-lg border-white/10 bg-black/20 text-white focus:border-sky-300/50 focus:ring-sky-300/30"
        />
        <button onClick={load} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.1]">
          <RefreshCcw size={16} />
          Atualizar
        </button>
      </section>

      {error ? <div className="mb-4 rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}

      <section className="panel overflow-hidden rounded-lg animate-fade-up">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Exportacao por membro</h2>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-slate-300">
            {loading ? 'Carregando' : `${members.length} relatorios`}
          </span>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead className="bg-white/[0.035] text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Membro</th>
                <th className="px-4 py-3">Discord ID</th>
                <th className="px-4 py-3">Tempo total</th>
                <th className="px-4 py-3">Pontos</th>
                <th className="px-4 py-3">Ultima atividade</th>
                <th className="px-4 py-3">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className="border-t border-white/10 text-sm text-slate-300 transition hover:bg-white/[0.04]">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{member.display_name}</div>
                    <div className="text-xs text-slate-500">{member.username}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{member.discord_user_id}</td>
                  <td className="px-4 py-3 font-medium text-white">{formatSeconds(member.total_seconds || 0)}</td>
                  <td className="px-4 py-3">{member.session_count || 0}</td>
                  <td className="px-4 py-3">{formatDate(member.last_point_at || member.last_seen_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Link href={`/dashboard/members/${member.id}`} className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/[0.08] hover:text-white">
                        <FileText size={14} />
                        Abrir
                      </Link>
                      <button onClick={() => exportMember(member)} className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-400">
                        <Download size={14} />
                        CSV
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!members.length && !loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">
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

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel rounded-lg p-4">
      <span className="text-xs font-semibold uppercase text-slate-500">{label}</span>
      <strong className="mt-2 block text-2xl font-semibold text-white">{value}</strong>
    </div>
  );
}
