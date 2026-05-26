'use client';

import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import { Archive, ArrowDownLeft, ArrowUpRight, ClipboardList, PackageOpen, RefreshCw, Shield } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type BauItem = {
  id: string;
  name: string;
  quantity: number;
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
};

type BauChest = {
  id: 'membros' | 'gerencia';
  label: string;
  description: string;
  items: BauItem[];
  totalItems: number;
  totalQuantity: number;
  updatedAt?: string | null;
};

type BauEvent = {
  id: string;
  createdAt: string;
  chest: 'membros' | 'gerencia';
  chestLabel?: string;
  action: 'withdraw' | 'deposit' | 'register' | string;
  userId?: string;
  userTag?: string;
  memberDisplayName?: string | null;
  profileName?: string | null;
  actorName?: string | null;
  actorId?: string | null;
  itemName?: string;
  quantity?: number;
  quantityBefore?: number;
  quantityAfter?: number;
  note?: string;
};

type BauReport = {
  id: string;
  dateKey: string;
  createdAt: string;
  summary?: {
    withdrawQuantity?: number;
    depositQuantity?: number;
    registerQuantity?: number;
    registeredItems?: number;
    movementCount?: number;
  };
};

type BauPayload = {
  guildId: string;
  chests: BauChest[];
  events: BauEvent[];
  reports: BauReport[];
};

const tabs = [
  { id: 'membros', label: 'Bau membros', icon: PackageOpen },
  { id: 'gerencia', label: 'Bau gerencia', icon: Shield },
  { id: 'relatorio', label: 'Relatorio', icon: ClipboardList }
] as const;

export default function BauPage() {
  const [data, setData] = useState<BauPayload | null>(null);
  const [selected, setSelected] = useState<(typeof tabs)[number]['id']>('membros');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch<BauPayload>('/bau');
      setData(response);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar bau');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const selectedChest = useMemo(() => {
    return data?.chests.find((chest) => chest.id === selected) || data?.chests[0] || null;
  }, [data, selected]);

  const totals = useMemo(() => {
    const chests = data?.chests || [];
    const events = data?.events || [];
    return {
      itemTypes: chests.reduce((sum, chest) => sum + chest.totalItems, 0),
      quantity: chests.reduce((sum, chest) => sum + chest.totalQuantity, 0),
      withdrawn: events.filter((event) => event.action === 'withdraw').reduce((sum, event) => sum + Number(event.quantity || 0), 0),
      deposited: events.filter((event) => event.action === 'deposit' || event.action === 'register').reduce((sum, event) => sum + Number(event.quantity || 0), 0)
    };
  }, [data]);

  return (
    <AppShell>
      <div className="space-y-5">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-slate-300">
              <Archive size={14} />
              Estoque conectado ao bot
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Bau</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">Membros, gerencia e movimentos registrados no Discord.</p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.045] px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={16} />
            Atualizar
          </button>
        </header>

        {error ? <div className="rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Tipos de itens" value={formatNumber(totals.itemTypes)} tone="sky" />
          <Metric label="Quantidade total" value={formatNumber(totals.quantity)} tone="emerald" />
          <Metric label="Retirado" value={formatNumber(totals.withdrawn)} tone="rose" />
          <Metric label="Colocado" value={formatNumber(totals.deposited)} tone="amber" />
        </section>

        <section className="panel rounded-lg p-3">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = selected === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setSelected(tab.id)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    active
                      ? 'border-sky-300/30 bg-sky-500/15 text-sky-100'
                      : 'border-white/10 bg-white/[0.035] text-slate-400 hover:bg-white/[0.06] hover:text-white'
                  }`}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </section>

        {selected === 'relatorio' ? (
          <ReportView events={data?.events || []} reports={data?.reports || []} loading={loading} />
        ) : (
          <ChestView chest={selectedChest} loading={loading} />
        )}

        <div className="text-xs text-slate-500">
          {lastUpdated ? `Atualizado: ${lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Sincronizando dados...'}
        </div>
      </div>
    </AppShell>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'sky' | 'emerald' | 'rose' | 'amber' }) {
  const tones = {
    sky: 'border-sky-300/15 bg-sky-400/10 text-sky-200',
    emerald: 'border-emerald-300/15 bg-emerald-400/10 text-emerald-200',
    rose: 'border-rose-300/15 bg-rose-400/10 text-rose-200',
    amber: 'border-amber-300/15 bg-amber-400/10 text-amber-200'
  };
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className={`h-2.5 w-2.5 rounded-full border ${tones[tone]}`} />
      </div>
      <div className="mt-3 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function ChestView({ chest, loading }: { chest: BauChest | null; loading: boolean }) {
  if (loading && !chest) return <div className="panel rounded-lg p-5 text-sm text-slate-400">Carregando bau...</div>;
  if (!chest) return <div className="panel rounded-lg p-5 text-sm text-slate-400">Nenhum bau encontrado.</div>;

  return (
    <section className="panel rounded-lg p-5">
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-xl font-semibold text-white">{chest.label}</h2>
          <p className="mt-1 text-sm text-slate-500">{chest.totalItems} itens cadastrados | {formatNumber(chest.totalQuantity)} unidades</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-300">
          {formatDate(chest.updatedAt)}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-white/10">
        <table className="w-full min-w-[680px] border-collapse text-left text-sm">
          <thead className="bg-white/[0.045] text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3">Quantidade</th>
              <th className="px-4 py-3">Atualizado</th>
              <th className="px-4 py-3">Criado por</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {chest.items.map((item) => (
              <tr key={item.id} className="bg-white/[0.02] transition hover:bg-white/[0.045]">
                <td className="px-4 py-3 font-semibold text-white">{item.name}</td>
                <td className="px-4 py-3 text-slate-200">{formatNumber(item.quantity)}</td>
                <td className="px-4 py-3 text-slate-500">{formatDate(item.updatedAt || item.createdAt)}</td>
                <td className="px-4 py-3 text-slate-500">{item.createdBy ? `ID ${item.createdBy}` : 'N/A'}</td>
              </tr>
            ))}
            {!chest.items.length ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500">Nenhum item cadastrado.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReportView({ events, reports, loading }: { events: BauEvent[]; reports: BauReport[]; loading: boolean }) {
  if (loading && !events.length) return <div className="panel rounded-lg p-5 text-sm text-slate-400">Carregando relatorio...</div>;

  return (
    <section className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <div className="panel rounded-lg p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white">Movimentos</h2>
            <p className="mt-1 text-sm text-slate-500">Retiradas, entradas e cadastros dos dois baus.</p>
          </div>
        </div>
        <div className="space-y-2">
          {events.map((event) => <EventRow key={event.id} event={event} />)}
          {!events.length ? <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-500">Nenhum movimento registrado.</div> : null}
        </div>
      </div>

      <div className="panel rounded-lg p-5">
        <h2 className="text-xl font-semibold text-white">Relatorios diarios</h2>
        <div className="mt-4 space-y-2">
          {reports.map((report) => (
            <div key={report.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-white">{formatDate(report.createdAt)}</div>
                  <div className="mt-1 text-xs text-slate-500">{report.dateKey}</div>
                </div>
                <span className="rounded-lg border border-sky-300/15 bg-sky-400/10 px-2 py-1 text-xs font-semibold text-sky-200">
                  {formatNumber(report.summary?.movementCount || 0)}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <MiniStat label="Pego" value={formatNumber(report.summary?.withdrawQuantity || 0)} />
                <MiniStat label="Coloc." value={formatNumber(report.summary?.depositQuantity || 0)} />
                <MiniStat label="Cad." value={formatNumber(report.summary?.registeredItems || 0)} />
              </div>
            </div>
          ))}
          {!reports.length ? <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-500">Nenhum relatorio diario ainda.</div> : null}
        </div>
      </div>
    </section>
  );
}

function EventRow({ event }: { event: BauEvent }) {
  const style = event.action === 'withdraw'
    ? 'border-rose-300/15 bg-rose-400/10 text-rose-200'
    : event.action === 'deposit'
      ? 'border-emerald-300/15 bg-emerald-400/10 text-emerald-200'
      : 'border-sky-300/15 bg-sky-400/10 text-sky-200';
  const Icon = event.action === 'withdraw' ? ArrowDownLeft : ArrowUpRight;
  const label = event.action === 'withdraw' ? 'Retirado' : event.action === 'deposit' ? 'Colocado' : 'Cadastrado';
  const actorLabel = getActorLabel(event);
  const actorActionLabel = getActorActionLabel(event.action);
  const actorId = event.actorId || event.userId;

  return (
    <div className="flex gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg border ${style}`}>
        <Icon size={17} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0">
            <p className="truncate font-semibold text-white">{event.itemName || 'Item'}</p>
            <p className="mt-1 text-xs text-slate-500">
              {event.chestLabel || event.chest} | {actorActionLabel}: <span className="font-medium text-slate-300">{actorLabel}</span>
            </p>
          </div>
          <span className={`shrink-0 rounded-lg border px-2 py-1 text-xs font-semibold ${style}`}>{label}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
          <span>{actorActionLabel} {actorLabel}</span>
          {actorId ? <span>ID {actorId}</span> : null}
          <span>Quantidade {formatNumber(event.quantity || 0)}</span>
          <span>Antes {formatNumber(event.quantityBefore || 0)}</span>
          <span>Depois {formatNumber(event.quantityAfter || 0)}</span>
          <span>{formatDate(event.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

function getActorLabel(event: BauEvent) {
  return event.actorName || event.profileName || event.memberDisplayName || event.userTag || event.userId || 'Sistema';
}

function getActorActionLabel(action: BauEvent['action']) {
  if (action === 'withdraw') return 'Retirado por';
  if (action === 'deposit') return 'Colocado por';
  if (action === 'register') return 'Cadastrado por';
  return 'Responsavel';
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 font-semibold text-white">{value}</div>
    </div>
  );
}

function formatNumber(value: number | string) {
  return new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
}

function formatDate(value?: string | null) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
