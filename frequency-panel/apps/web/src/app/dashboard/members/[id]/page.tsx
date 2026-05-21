'use client';

import { ArrowLeft, CalendarDays, Clock, Download, FileText, LineChart, Radio, RefreshCcw, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { PresenceChart } from '@/components/presence-chart';
import { StatCard } from '@/components/stat-card';
import { apiFetch, downloadFile } from '@/lib/api';
import { formatDate, formatDay, formatSeconds } from '@/lib/format';
import { subscribeDashboardEvents } from '@/lib/realtime';
import type { AttendanceSession, FrequencyDay, Member } from '@/lib/types';

const tabs = ['Visao geral', 'Ponto', 'Frequencia', 'Ausencias', 'Relatorios', 'Graficos'];

type MemberPayload = {
  member: Member;
  report: {
    summary: {
      total_sessions: number;
      open_sessions: number;
      total_seconds: number;
      active_days: number;
      last_activity_at?: string | null;
    };
    days: FrequencyDay[];
  };
};

export default function MemberProfilePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [activeTab, setActiveTab] = useState(tabs[0]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [payload, setPayload] = useState<MemberPayload | null>(null);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [frequency, setFrequency] = useState<FrequencyDay[]>([]);
  const [absences, setAbsences] = useState<any[]>([]);
  const [error, setError] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params.toString();
  }, [from, to]);

  async function load() {
    setError('');
    try {
      const [memberData, attendanceData, frequencyData, absenceData] = await Promise.all([
        apiFetch<MemberPayload>(`/members/${id}?${query}`),
        apiFetch<{ sessions: AttendanceSession[] }>(`/members/${id}/attendance?${query}`),
        apiFetch<{ days: FrequencyDay[] }>(`/members/${id}/frequency?${query}`),
        apiFetch<{ absences: any[] }>(`/members/${id}/absences?${query}`)
      ]);
      setPayload(memberData);
      setSessions(attendanceData.sessions);
      setFrequency(frequencyData.days);
      setAbsences(absenceData.absences);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar perfil');
    }
  }

  async function exportReport() {
    await downloadFile(`/members/${id}/export?${query}`, `frequencia-${id}.csv`);
  }

  useEffect(() => {
    load();
  }, [id, query]);

  useEffect(() => subscribeDashboardEvents(load), [id, query]);

  const member = payload?.member;
  const summary = payload?.report.summary;

  return (
    <AppShell>
      <header className="mb-6 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <Link href="/dashboard/members" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-slate-400 hover:text-white">
            <ArrowLeft size={16} />
            Voltar para membros
          </Link>
          <p className="text-sm font-medium text-blue-300">Perfil individual</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">{member?.display_name || 'Carregando membro'}</h1>
          <p className="mt-1 text-sm text-slate-400">{member?.discord_user_id || 'Dados do Discord sincronizados pelo bot'}</p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Inicio</span>
            <input value={from} onChange={(event) => setFrom(event.target.value)} type="date" className="rounded-lg border-white/10 bg-white/[0.04] text-white focus:border-brand-400 focus:ring-brand-400" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Fim</span>
            <input value={to} onChange={(event) => setTo(event.target.value)} type="date" className="rounded-lg border-white/10 bg-white/[0.04] text-white focus:border-brand-400 focus:ring-brand-400" />
          </label>
          <button onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-blue-400/20 bg-blue-500/10 px-4 py-2 text-sm font-semibold text-blue-100">
            <RefreshCcw size={16} />
            Atualizar
          </button>
          <button onClick={exportReport} className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400">
            <Download size={16} />
            Exportar
          </button>
        </div>
      </header>

      {error ? <div className="mb-4 rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}

      <section className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Tempo total" value={formatSeconds(summary?.total_seconds || 0)} helper="Periodo filtrado" icon={Clock} />
        <StatCard label="Dias ativos" value={summary?.active_days ?? 0} helper="Dias com ponto" icon={CalendarDays} />
        <StatCard label="Pontos" value={summary?.total_sessions ?? 0} helper="Registros de entrada" icon={Radio} />
        <StatCard label="Ausencias" value={absences.length} helper="No periodo" icon={UserCheck} />
      </section>

      <section className="panel mb-4 rounded-lg p-2">
        <div className="flex gap-2 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${
                activeTab === tab ? 'bg-blue-500/20 text-blue-100' : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </section>

      {activeTab === 'Visao geral' ? (
        <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <div className="panel rounded-lg p-5">
            <div className="flex items-center gap-3">
              <MemberAvatar member={member} />
              <div>
                <h2 className="font-semibold text-white">{member?.display_name}</h2>
                <p className="text-sm text-slate-400">{member?.username}</p>
              </div>
            </div>
            <dl className="mt-5 space-y-3 text-sm">
              <Row label="Cargo" value={member?.highest_role_name || 'N/A'} />
              <Row label="Status" value={member?.status || 'N/A'} />
              <Row label="Ultima atividade" value={formatDate(summary?.last_activity_at || member?.last_seen_at)} />
              <Row label="Discord ID" value={member?.discord_user_id || 'N/A'} mono />
            </dl>
          </div>

          <div className="panel rounded-lg p-5">
            <div className="mb-4 flex items-center gap-2">
              <LineChart size={18} className="text-blue-300" />
              <h2 className="font-semibold text-white">Presenca no periodo</h2>
            </div>
            <PresenceChart data={frequency} />
          </div>
        </section>
      ) : null}

      {activeTab === 'Ponto' ? <SessionsTable sessions={sessions} /> : null}
      {activeTab === 'Frequencia' ? <FrequencyTable days={frequency} /> : null}
      {activeTab === 'Ausencias' ? <AbsenceTable absences={absences} /> : null}
      {activeTab === 'Relatorios' ? <ReportSummary summary={summary} sessions={sessions} onExport={exportReport} /> : null}
      {activeTab === 'Graficos' ? (
        <section className="panel rounded-lg p-5">
          <h2 className="mb-4 font-semibold text-white">Grafico de presenca</h2>
          <PresenceChart data={frequency} />
        </section>
      ) : null}
    </AppShell>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className={`text-right text-white ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}

function MemberAvatar({ member }: { member?: Member }) {
  const initials = (member?.display_name || member?.username || 'VX').slice(0, 2).toUpperCase();
  const avatarUrl = member?.avatar_url ? `/api/members/${member.id}/avatar` : '';

  return (
    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-blue-500/15 text-lg font-semibold text-blue-200">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={member?.display_name || 'Avatar'}
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

function SessionsTable({ sessions }: { sessions: AttendanceSession[] }) {
  return (
    <Table title="Registros de ponto">
      {sessions.map((session) => (
        <tr key={session.id} className="border-t border-white/10 text-sm text-slate-300">
          <td className="px-4 py-3">{formatDate(session.opened_at)}</td>
          <td className="px-4 py-3">{formatDate(session.closed_at)}</td>
          <td className="px-4 py-3">{formatSeconds(session.total_seconds)}</td>
          <td className="px-4 py-3">{session.closed_at ? 'Fechado' : 'Aberto'}</td>
          <td className="px-4 py-3">{session.source}</td>
        </tr>
      ))}
      {!sessions.length ? <EmptyRows colSpan={5} /> : null}
    </Table>
  );
}

function FrequencyTable({ days }: { days: FrequencyDay[] }) {
  return (
    <Table title="Frequencia diaria">
      {days.map((day) => (
        <tr key={day.date_key} className="border-t border-white/10 text-sm text-slate-300">
          <td className="px-4 py-3">{formatDay(day.date_key)}</td>
          <td className="px-4 py-3">{day.points || day.sessions || 0}</td>
          <td className="px-4 py-3">{formatSeconds(day.total_seconds)}</td>
          <td className="px-4 py-3">{day.total_seconds > 0 ? 'Presente' : 'Sem ponto'}</td>
          <td className="px-4 py-3">Sistema</td>
        </tr>
      ))}
      {!days.length ? <EmptyRows colSpan={5} /> : null}
    </Table>
  );
}

function AbsenceTable({ absences }: { absences: any[] }) {
  return (
    <Table title="Ausencias registradas">
      {absences.map((absence) => (
        <tr key={absence.id} className="border-t border-white/10 text-sm text-slate-300">
          <td className="px-4 py-3">{formatDay(absence.date_key)}</td>
          <td className="px-4 py-3">{absence.reason || 'Sem motivo'}</td>
          <td className="px-4 py-3">{absence.created_by || 'Sistema'}</td>
          <td className="px-4 py-3">{formatDate(absence.created_at)}</td>
          <td className="px-4 py-3">Registrada</td>
        </tr>
      ))}
      {!absences.length ? <EmptyRows colSpan={5} /> : null}
    </Table>
  );
}

function ReportSummary({ summary, sessions, onExport }: { summary: MemberPayload['report']['summary'] | undefined; sessions: AttendanceSession[]; onExport: () => void }) {
  return (
    <section className="panel rounded-lg p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-semibold text-white">Relatorio do periodo</h2>
          <p className="text-sm text-slate-400">Resumo pronto para exportacao.</p>
        </div>
        <button onClick={onExport} className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white">
          <FileText size={16} />
          Baixar CSV
        </button>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <StatCard label="Sessoes" value={summary?.total_sessions ?? 0} icon={Radio} />
        <StatCard label="Tempo total" value={formatSeconds(summary?.total_seconds || 0)} icon={Clock} />
        <StatCard label="Linhas exportadas" value={sessions.length} icon={FileText} />
      </div>
    </section>
  );
}

function Table({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel overflow-hidden rounded-lg">
      <div className="border-b border-white/10 px-4 py-3">
        <h2 className="font-semibold text-white">{title}</h2>
      </div>
      <div className="overflow-auto">
        <table className="w-full min-w-[820px] border-collapse">
          <thead className="bg-blue-500/10 text-left text-xs uppercase text-blue-200">
            <tr>
              <th className="px-4 py-3">Data inicial</th>
              <th className="px-4 py-3">Data final</th>
              <th className="px-4 py-3">Tempo</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Origem</th>
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </section>
  );
}

function EmptyRows({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-slate-400">
        Nenhum registro no periodo.
      </td>
    </tr>
  );
}
