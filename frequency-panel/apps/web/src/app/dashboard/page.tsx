'use client';

import { Activity, Clock, Radio, RefreshCw, Sparkles, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { PresenceChart } from '@/components/presence-chart';
import { StatCard } from '@/components/stat-card';
import { apiFetch } from '@/lib/api';
import { formatSeconds } from '@/lib/format';
import { subscribeDashboardEvents } from '@/lib/realtime';
import type { FrequencyDay } from '@/lib/types';

type Metrics = {
  metrics: {
    total_members: number;
    active_members: number;
    open_points: number;
    month_seconds: number;
  };
  trend: FrequencyDay[];
  activity: Array<{
    id: string;
    type: string;
    title: string;
    member_name: string;
    global_name?: string | null;
    username?: string | null;
    avatar_url?: string | null;
    banner_url?: string | null;
    at?: string | null;
    total_seconds?: number;
    source?: string;
    role?: string | null;
    city?: string | null;
  }>;
};

export default function DashboardPage() {
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function load() {
    try {
      const response = await apiFetch<Metrics>('/dashboard/metrics');
      setData(response);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar dashboard');
    }
  }

  useEffect(() => {
    load();
    return subscribeDashboardEvents(load);
  }, []);

  return (
    <AppShell>
      <header className="mb-6 animate-fade-up">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-slate-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              Painel em tempo real
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Controle de frequencia</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Visao limpa das presencas, pontos e atividades recentes dos membros da Vortex.
            </p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.045] px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.08] hover:text-white"
          >
            <RefreshCw size={16} />
            Atualizar
          </button>
        </div>
        <div className="mt-4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        <div className="mt-3 text-xs text-slate-500">
          {lastUpdated ? `Atualizado agora: ${lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Sincronizando dados...'}
        </div>
      </header>

      {error ? <div className="mb-4 rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Membros" value={data?.metrics.total_members ?? '...'} helper="Total sincronizado" icon={Users} tone="blue" />
        <StatCard label="Ativos" value={data?.metrics.active_members ?? '...'} helper="Na cidade agora" icon={Activity} tone="emerald" />
        <StatCard label="Pontos abertos" value={data?.metrics.open_points ?? '...'} helper="Em andamento" icon={Radio} tone="rose" />
        <StatCard label="Tempo no mes" value={data ? formatSeconds(data.metrics.month_seconds) : '...'} helper="Soma mensal" icon={Clock} tone="violet" />
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="panel rounded-lg p-5 animate-fade-up">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">Presenca nos ultimos 30 dias</h2>
              <p className="text-sm text-slate-500">Tempo total registrado por dia</p>
            </div>
            <div className="rounded-lg border border-sky-300/15 bg-sky-400/10 p-2 text-sky-200">
              <Sparkles size={17} />
            </div>
          </div>
          <PresenceChart data={data?.trend || []} />
        </div>

        <div className="panel rounded-lg p-5 animate-fade-up">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">Atividades dos membros</h2>
              <p className="text-sm text-slate-500">Somente quem esta logado na cidade agora</p>
            </div>
            <span className="rounded-full border border-emerald-300/15 bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-200">
              Live
            </span>
          </div>
          <div className="space-y-2">
            {(data?.activity || []).map((item) => (
              <ActivityRow key={`${item.type}-${item.id}-${item.at}`} item={item} />
            ))}
            {data && !data.activity.length ? (
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-500">
                Nenhum membro logado na cidade agora.
              </div>
            ) : null}
            {!data ? (
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-500">
                Carregando atividades...
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function ActivityRow({ item }: { item: Metrics['activity'][number] }) {
  const displayName = item.global_name || item.member_name || item.username || 'Membro';
  const initials = displayName.slice(0, 2).toUpperCase();
  const isOpen = item.type === 'point.opened';
  const isClosed = item.type === 'point.closed';
  const isCityOnline = item.type === 'city.online';

  return (
    <div className="flex gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 transition hover:bg-white/[0.055]">
      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.06] text-sm font-semibold text-slate-200">
        {item.avatar_url ? <img src={item.avatar_url} alt={displayName} className="relative z-10 h-full w-full object-cover" /> : null}
        <span className="absolute inset-0 grid place-items-center">{initials}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{displayName}</p>
            <p className="truncate text-xs text-slate-500">{item.username || item.role || 'Vortex'}</p>
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
            isOpen
              ? 'border-emerald-300/15 bg-emerald-400/10 text-emerald-200'
              : isClosed
                ? 'border-rose-300/15 bg-rose-400/10 text-rose-200'
                : isCityOnline
                  ? 'border-emerald-300/15 bg-emerald-400/10 text-emerald-200'
                  : 'border-sky-300/15 bg-sky-400/10 text-sky-200'
          }`}>
            {isOpen ? 'Entrada' : isClosed ? 'Saida' : isCityOnline ? 'Na cidade' : 'Presenca'}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
          <span>{item.title}{item.city ? ` - ${item.city}` : ''}{item.total_seconds ? ` - ${formatSeconds(item.total_seconds)}` : ''}</span>
          <span className="shrink-0">{formatRelative(item.at)}</span>
        </div>
      </div>
    </div>
  );
}

function formatRelative(value?: string | null) {
  if (!value) return 'agora';
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
