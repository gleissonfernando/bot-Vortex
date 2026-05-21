'use client';

import { Activity, Clock, Radio, Users } from 'lucide-react';
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
};

export default function DashboardPage() {
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      const response = await apiFetch<Metrics>('/dashboard/metrics');
      setData(response);
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
      <header className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-blue-300">Painel</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">Controle de frequencia</h1>
          <p className="mt-1 text-sm text-slate-400">Visao consolidada dos membros e pontos registrados.</p>
        </div>
        <button onClick={load} className="rounded-lg border border-blue-400/20 bg-blue-500/10 px-4 py-2 text-sm font-semibold text-blue-100">
          Atualizar
        </button>
      </header>

      {error ? <div className="mb-4 rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Membros" value={data?.metrics.total_members ?? '...'} helper="Total sincronizado" icon={Users} />
        <StatCard label="Ativos" value={data?.metrics.active_members ?? '...'} helper="Status ativo" icon={Activity} />
        <StatCard label="Pontos abertos" value={data?.metrics.open_points ?? '...'} helper="Em andamento" icon={Radio} />
        <StatCard label="Tempo no mes" value={data ? formatSeconds(data.metrics.month_seconds) : '...'} helper="Soma mensal" icon={Clock} />
      </section>

      <section className="panel mt-5 rounded-lg p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Presenca nos ultimos 30 dias</h2>
            <p className="text-sm text-slate-400">Tempo total por dia</p>
          </div>
        </div>
        <PresenceChart data={data?.trend || []} />
      </section>
    </AppShell>
  );
}
