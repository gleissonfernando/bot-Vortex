'use client';

import { Activity, CalendarDays, Clock, Filter, Radio, RefreshCw, Search, Sparkles, Users, X } from 'lucide-react';
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
      <header className="premium-card mb-6 animate-fade-up overflow-hidden rounded-2xl p-6">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-300/25 bg-sky-400/10 px-3 py-1 text-xs font-semibold text-sky-100">
              <span className="h-1.5 w-1.5 rounded-full bg-vortex-success shadow-[0_0_16px_var(--vx-success)]" />
              Painel em tempo real
            </div>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">Controle de frequencia</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Visao limpa das presencas, pontos e atividades recentes dos membros da Vortex.
            </p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-sky-300/20 bg-sky-400/10 px-4 py-2 text-sm font-semibold text-sky-50 shadow-lg shadow-sky-950/20 transition duration-300 hover:border-sky-300/35 hover:bg-sky-400/15 hover:shadow-sky-500/10"
          >
            <RefreshCw size={16} />
            Atualizar
          </button>
        </div>
        <div className="mt-5 h-px bg-gradient-to-r from-transparent via-sky-300/20 to-transparent" />
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          {lastUpdated ? `Atualizado agora: ${lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Sincronizando dados...'}
        </div>
      </header>

      <section className="mb-5 rounded-2xl border border-white/10 bg-vortex-surface/75 p-3 shadow-xl shadow-black/10 backdrop-blur-xl">
        <div className="grid gap-3 lg:grid-cols-[1fr_160px_160px_160px_160px_auto]">
          <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-vortex-bg/70 px-3 py-2 text-sm text-slate-300">
            <Search size={16} className="text-sky-200" />
            <input className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-500" placeholder="Busca global" />
          </label>
          <FilterChip icon={Users} label="Cargo" />
          <FilterChip icon={Activity} label="Status" />
          <FilterChip icon={CalendarDays} label="Data inicial" />
          <FilterChip icon={CalendarDays} label="Data final" />
          <button className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/[0.08] hover:text-white">
            <X size={15} />
            Limpar
          </button>
        </div>
      </section>

      {error ? <div className="mb-4 rounded-2xl border border-vortex-danger/25 bg-vortex-danger/10 p-3 text-sm text-red-100">{error}</div> : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Membros" value={data?.metrics.total_members ?? '...'} helper="Total sincronizado" icon={Users} tone="blue" />
        <StatCard label="Ativos" value={data?.metrics.active_members ?? '...'} helper="Na cidade agora" icon={Activity} tone="emerald" />
        <StatCard label="Pontos abertos" value={data?.metrics.open_points ?? '...'} helper="Em andamento" icon={Radio} tone="rose" />
        <StatCard label="Tempo no mes" value={data ? formatSeconds(data.metrics.month_seconds) : '...'} helper="Soma mensal" icon={Clock} tone="violet" />
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="panel hover-glow rounded-2xl p-5 animate-fade-up">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Evolucao dos pontos</h2>
              <p className="text-sm text-slate-400">Tempo acumulado e atividade dos membros</p>
            </div>
            <div className="rounded-2xl border border-sky-300/15 bg-sky-400/10 p-2 text-sky-200">
              <Sparkles size={17} />
            </div>
          </div>
          <PresenceChart data={data?.trend || []} />
        </div>

        <div className="panel hover-glow rounded-2xl p-5 animate-fade-up">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Atividade dos membros</h2>
              <p className="text-sm text-slate-400">Somente quem esta logado na cidade agora</p>
            </div>
            <span className="rounded-full border border-emerald-300/15 bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-100">
              Live
            </span>
          </div>
          <div className="space-y-2">
            {(data?.activity || []).map((item) => (
              <ActivityRow key={`${item.type}-${item.id}-${item.at}`} item={item} />
            ))}
            {data && !data.activity.length ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                Nenhum membro logado na cidade agora.
              </div>
            ) : null}
            {!data ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                Carregando atividades...
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function FilterChip({ icon: Icon, label }: { icon: typeof Users; label: string }) {
  return (
    <button className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-vortex-bg/70 px-3 py-2 text-sm font-semibold text-slate-300 transition hover:border-sky-300/20 hover:bg-vortex-hover hover:text-white">
      <Icon size={15} />
      {label}
    </button>
  );
}

function ActivityRow({ item }: { item: Metrics['activity'][number] }) {
  const displayName = item.global_name || item.member_name || item.username || 'Membro';
  const initials = displayName.slice(0, 2).toUpperCase();
  const isOpen = item.type === 'point.opened';
  const isClosed = item.type === 'point.closed';
  const isCityOnline = item.type === 'city.online';

  return (
    <div className="group flex gap-3 rounded-2xl border border-white/10 bg-vortex-bg/55 p-3 transition duration-300 hover:border-sky-300/20 hover:bg-vortex-hover">
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-2xl bg-white/[0.06] text-sm font-semibold text-slate-200 ring-1 ring-white/10">
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
              ? 'border-emerald-300/15 bg-emerald-400/10 text-emerald-100'
              : isClosed
                ? 'border-rose-300/15 bg-rose-400/10 text-rose-100'
                : isCityOnline
                  ? 'border-emerald-300/15 bg-emerald-400/10 text-emerald-100'
                  : 'border-sky-300/15 bg-sky-400/10 text-sky-100'
          }`}>
            {isOpen ? 'Entrada' : isClosed ? 'Saida' : isCityOnline ? 'Na cidade' : 'Presenca'}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-400">
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
