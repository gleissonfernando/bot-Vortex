'use client';

import { CalendarOff, CheckCircle2, Clock3, FileText, RefreshCcw, Search, UserCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { StatCard } from '@/components/stat-card';
import { apiFetch } from '@/lib/api';
import { formatDate, formatDay } from '@/lib/format';
import type { AbsenceRecord } from '@/lib/types';

type AbsencePayload = {
  metrics: {
    total: number;
    active: number;
    scheduled: number;
    pending: number;
    approved: number;
  };
  active: AbsenceRecord[];
  records: AbsenceRecord[];
};

const initialPayload: AbsencePayload = {
  metrics: { total: 0, active: 0, scheduled: 0, pending: 0, approved: 0 },
  active: [],
  records: []
};

export default function AbsencesPage() {
  const [payload, setPayload] = useState<AbsencePayload>(initialPayload);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params.toString();
  }, [status, search, from, to]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<AbsencePayload>(`/absences?${query}`);
      setPayload({
        metrics: data.metrics,
        active: data.active,
        records: data.records
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar ausencias');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(load, 180);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <AppShell>
      <header className="mb-6 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-slate-300">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-300" />
            Ausencias
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Controle de ausencias</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Veja quem esta em ausencia, quem solicitou, quem aceitou e o periodo de afastamento.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.09]">
            <RefreshCcw size={16} />
            Atualizar
          </button>
        </div>
      </header>

      <section className="mb-6 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Em ausencia" value={payload.metrics.active} helper="Ativas agora" icon={CalendarOff} />
        <StatCard label="Agendadas" value={payload.metrics.scheduled} helper="Aguardando inicio" icon={Clock3} />
        <StatCard label="Pendentes" value={payload.metrics.pending} helper="Aguardando decisao" icon={UserCheck} />
        <StatCard label="Registros" value={payload.metrics.total} helper={loading ? 'Carregando' : 'Filtros aplicados'} icon={FileText} />
      </section>

      <section className="soft-panel mb-5 grid gap-3 rounded-lg p-3 lg:grid-cols-[1fr_180px_170px_170px_auto]">
        <label className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-lg border-white/10 bg-black/20 pl-10 text-white placeholder:text-slate-500 focus:border-blue-300/50 focus:ring-blue-300/30"
            placeholder="Nome, ID, motivo ou aprovador"
          />
        </label>

        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-lg border-white/10 bg-black/20 text-white focus:border-blue-300/50 focus:ring-blue-300/30"
        >
          <option value="all">Todos</option>
          <option value="current">Ativas/agendadas</option>
          <option value="active">Ativas</option>
          <option value="scheduled">Agendadas</option>
          <option value="pending">Pendentes</option>
          <option value="history">Historico</option>
          <option value="finished">Finalizadas</option>
          <option value="removed">Retiradas</option>
          <option value="rejected">Recusadas</option>
        </select>

        <input value={from} onChange={(event) => setFrom(event.target.value)} type="date" className="rounded-lg border-white/10 bg-black/20 text-white focus:border-blue-300/50 focus:ring-blue-300/30" />
        <input value={to} onChange={(event) => setTo(event.target.value)} type="date" className="rounded-lg border-white/10 bg-black/20 text-white focus:border-blue-300/50 focus:ring-blue-300/30" />

        <button onClick={load} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.1]">
          Filtrar
        </button>
      </section>

      {error ? <div className="mb-4 rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}

      <section className="mb-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Agora em ausencia</h2>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-slate-300">
            {payload.active.length} pessoa(s)
          </span>
        </div>

        {payload.active.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {payload.active.map((absence) => (
              <article key={absence.id} className="panel rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <MemberAvatar absence={absence} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-semibold text-white">{absence.member_name}</h3>
                      <StatusBadge status={absence.status} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{absence.discord_user_id}</p>
                    <p className="mt-3 text-sm text-slate-300">{periodLabel(absence)}</p>
                    <p className="mt-1 text-xs text-slate-500">{decisionLabel(absence)}</p>
                    {absence.reason ? <p className="mt-3 line-clamp-2 text-sm text-slate-400">{absence.reason}</p> : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="panel rounded-lg px-4 py-8 text-center text-sm text-slate-400">Nenhum membro em ausencia agora.</div>
        )}
      </section>

      <section className="panel overflow-hidden rounded-lg">
        <div className="flex flex-col justify-between gap-2 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-sm font-semibold text-white">Historico de ausencias</h2>
            <p className="text-xs text-slate-500">Solicitante, aprovador e periodo completo.</p>
          </div>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-slate-300">
            {loading ? 'Carregando' : `${payload.records.length} registros`}
          </span>
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[1040px] border-collapse">
            <thead className="bg-white/[0.035] text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Membro</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Periodo</th>
                <th className="px-4 py-3">Aceito/recusado por</th>
                <th className="px-4 py-3">Solicitado em</th>
                <th className="px-4 py-3">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {payload.records.map((absence) => (
                <tr key={absence.id} className="border-t border-white/10 text-sm text-slate-300 transition hover:bg-white/[0.04]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <MemberAvatar absence={absence} small />
                      <div>
                        <div className="font-medium text-white">{absence.member_name}</div>
                        <div className="font-mono text-xs text-slate-500">{absence.discord_user_id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={absence.status} /></td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{periodLabel(absence)}</div>
                    <div className="text-xs text-slate-500">{absence.period_days || 0} dia(s)</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{decisionPerson(absence)}</div>
                    <div className="text-xs text-slate-500">{formatDate(absence.decided_at)}</div>
                  </td>
                  <td className="px-4 py-3">{formatDate(absence.created_at)}</td>
                  <td className="max-w-[260px] px-4 py-3 text-slate-400">{absence.reason || 'Sem motivo informado'}</td>
                </tr>
              ))}
              {!payload.records.length && !loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">
                    Nenhuma ausencia encontrada para os filtros.
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

function MemberAvatar({ absence, small = false }: { absence: AbsenceRecord; small?: boolean }) {
  const initials = (absence.member_name || absence.username || 'VX').slice(0, 2).toUpperCase();
  const avatarUrl = normalizeAvatarUrl(absence.avatar_url);
  const sizeClass = small ? 'h-9 w-9 text-sm' : 'h-12 w-12 text-base';

  return (
    <div className={`${sizeClass} relative shrink-0 overflow-hidden rounded-lg bg-blue-500/15 font-semibold text-blue-200`}>
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={absence.member_name}
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

function periodLabel(absence: AbsenceRecord) {
  return `${formatDay(absence.starts_at || absence.started_at)} ate ${formatDay(absence.ends_at)}`;
}

function decisionLabel(absence: AbsenceRecord) {
  if (absence.approved_by_name || absence.approved_by_id) return `Aceito por ${absence.approved_by_name || absence.approved_by_id}`;
  if (absence.rejected_by_name || absence.rejected_by_id) return `Recusado por ${absence.rejected_by_name || absence.rejected_by_id}`;
  return 'Aguardando decisao';
}

function decisionPerson(absence: AbsenceRecord) {
  if (absence.approved_by_name || absence.approved_by_id) return absence.approved_by_name || absence.approved_by_id;
  if (absence.rejected_by_name || absence.rejected_by_id) return absence.rejected_by_name || absence.rejected_by_id;
  return 'Pendente';
}

function StatusBadge({ status }: { status: string }) {
  const normalized = String(status || 'pending').toLowerCase();
  const style = normalized === 'active'
    ? 'border-emerald-300/20 bg-emerald-500/10 text-emerald-200'
    : normalized === 'scheduled'
      ? 'border-blue-300/20 bg-blue-500/10 text-blue-200'
      : normalized === 'pending'
        ? 'border-amber-300/20 bg-amber-500/10 text-amber-200'
        : normalized === 'rejected'
          ? 'border-red-300/20 bg-red-500/10 text-red-200'
          : 'border-white/10 bg-white/[0.04] text-slate-300';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${style}`}>
      {normalized === 'active' ? <CheckCircle2 size={13} /> : null}
      {statusLabel(normalized)}
    </span>
  );
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    active: 'Em ausencia',
    scheduled: 'Agendada',
    pending: 'Pendente',
    finished: 'Finalizada',
    removed: 'Retirada',
    rejected: 'Recusada'
  };
  return labels[status] || status;
}
