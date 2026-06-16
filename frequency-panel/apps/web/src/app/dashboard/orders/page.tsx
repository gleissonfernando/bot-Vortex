'use client';

import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import { AlertTriangle, CheckCircle2, Clock3, FolderTree, PackagePlus, RefreshCw, Save, ShoppingCart, XCircle, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type DiscordCategory = {
  id: string;
  name: string;
  position: number;
};

type OrderSettings = {
  guildId: string;
  orderCategoryId: string;
  orderCategoryName?: string | null;
  updatedAt?: string | null;
  updatedByName?: string | null;
};

type OrderItem = {
  id: string;
  guildId: string;
  familyName: string;
  ammoName: string;
  quantity: number;
  unitPrice: number;
  originalValue: number;
  discountPercent: number;
  discountValue: number;
  finalValue: number;
  status: 'pending' | 'delivered' | 'rejected';
  orderCategoryId: string;
  orderChannelId: string;
  orderMessageId?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  closedAt?: string | null;
};

type OrderStats = {
  total: number;
  pending: number;
  delivered: number;
  rejected: number;
};

const emptyStats: OrderStats = { total: 0, pending: 0, delivered: 0, rejected: 0 };

const initialForm = {
  familyName: '',
  ammoName: '',
  quantity: '1',
  unitPrice: '0',
  discountPercent: '0'
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [stats, setStats] = useState<OrderStats>(emptyStats);
  const [settings, setSettings] = useState<OrderSettings | null>(null);
  const [categories, setCategories] = useState<DiscordCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');
  const [discordError, setDiscordError] = useState('');

  const selectedCategory = useMemo(() => {
    return categories.find((category) => category.id === selectedCategoryId) || null;
  }, [categories, selectedCategoryId]);

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      const [ordersData, settingsData, optionsData] = await Promise.all([
        apiFetch<{ orders: OrderItem[]; stats: OrderStats }>('/orders'),
        apiFetch<{ settings: OrderSettings }>('/orders/settings'),
        apiFetch<{ categories: DiscordCategory[]; error?: string | null }>('/orders/discord-options').catch(() => null)
      ]);

      setOrders(ordersData.orders || []);
      setStats(ordersData.stats || emptyStats);
      setSettings(settingsData.settings || null);
      setSelectedCategoryId(settingsData.settings?.orderCategoryId || '');

      if (optionsData) {
        setCategories(optionsData.categories || []);
        setDiscordError(optionsData.error || '');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao carregar encomendas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveSettings() {
    if (!selectedCategoryId) {
      setMessage('Selecione a categoria onde os canais de encomenda serao abertos.');
      return;
    }

    setSavingSettings(true);
    setMessage('');
    try {
      const data = await apiFetch<{ settings: OrderSettings }>('/orders/settings', {
        method: 'PUT',
        body: JSON.stringify({ orderCategoryId: selectedCategoryId })
      });
      setSettings(data.settings);
      setMessage(`Categoria salva: ${data.settings.orderCategoryName || selectedCategory?.name || selectedCategoryId}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar categoria.');
    } finally {
      setSavingSettings(false);
    }
  }

  async function createOrder() {
    setCreating(true);
    setMessage('');
    try {
      const data = await apiFetch<{ order: OrderItem }>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          familyName: form.familyName,
          ammoName: form.ammoName,
          quantity: Number(form.quantity),
          unitPrice: Number(form.unitPrice),
          discountPercent: Number(form.discountPercent)
        })
      });
      setMessage(`Encomenda criada em #${data.order.orderChannelId}.`);
      setForm(initialForm);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao criar encomenda.');
    } finally {
      setCreating(false);
    }
  }

  function updateForm(key: keyof typeof initialForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-lg border border-sky-300/20 bg-sky-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-100">
              <ShoppingCart size={14} />
              Familias e encomendas
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Encomendas</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Configure a categoria do Discord e abra canais de acompanhamento para cada pedido.
            </p>
          </div>
          <button onClick={load} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </header>

        {message ? <pre className="whitespace-pre-wrap rounded-lg border border-sky-300/20 bg-sky-400/10 px-4 py-3 text-sm leading-6 text-sky-100">{message}</pre> : null}
        {discordError ? <div className="rounded-lg border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">{discordError}</div> : null}

        <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Total" value={stats.total} tone="sky" icon={ShoppingCart} />
          <Metric label="Aguardando" value={stats.pending} tone="amber" icon={Clock3} />
          <Metric label="Entregues" value={stats.delivered} tone="emerald" icon={CheckCircle2} />
          <Metric label="Nao entregues" value={stats.rejected} tone="rose" icon={XCircle} />
        </section>

        <section className="panel rounded-lg p-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <FolderTree size={18} className="text-sky-200" />
                Categoria dos canais
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Todos os canais `pedido-nome-da-familia` serao criados dentro da categoria selecionada.
              </p>
              <label className="mt-4 block max-w-2xl">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Abrir canais em</span>
                <select value={selectedCategoryId} onChange={(event) => setSelectedCategoryId(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-300/60">
                  <option value="">Selecione uma categoria</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-300">
                Atual: {settings?.orderCategoryName || selectedCategory?.name || settings?.orderCategoryId || 'Nao configurada'}
              </div>
              <button onClick={saveSettings} disabled={savingSettings || !selectedCategoryId} className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
                <Save size={16} />
                {savingSettings ? 'Salvando...' : 'Salvar categoria'}
              </button>
            </div>
          </div>
        </section>

        <section className="panel rounded-lg p-5">
          <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-white">
            <PackagePlus size={18} className="text-emerald-200" />
            Nova encomenda
          </div>

          {!settings?.orderCategoryId ? (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              <AlertTriangle size={17} />
              Configure a categoria antes de abrir pedidos.
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Input label="Familia" value={form.familyName} onChange={(value) => updateForm('familyName', value)} placeholder="Ex: Noruega" />
            <Input label="Municao" value={form.ammoName} onChange={(value) => updateForm('ammoName', value)} placeholder="Ex: Pistola" />
            <Input label="Quantidade" type="number" value={form.quantity} onChange={(value) => updateForm('quantity', value)} />
            <Input label="Valor unitario" type="number" value={form.unitPrice} onChange={(value) => updateForm('unitPrice', value)} />
            <Input label="Desconto %" type="number" value={form.discountPercent} onChange={(value) => updateForm('discountPercent', value)} />
          </div>

          <div className="mt-5 flex justify-end">
            <button
              onClick={createOrder}
              disabled={creating || !settings?.orderCategoryId || !form.familyName.trim() || !form.ammoName.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              <PackagePlus size={16} />
              {creating ? 'Criando...' : 'Criar canal de encomenda'}
            </button>
          </div>
        </section>

        <section className="panel overflow-hidden rounded-lg">
          <div className="flex flex-col justify-between gap-2 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-lg font-semibold text-white">Pedidos recentes</h2>
              <p className="text-sm text-slate-500">Canais criados na categoria configurada.</p>
            </div>
            <span className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-300">
              {orders.length} exibido{orders.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] border-collapse text-left text-sm">
              <thead className="bg-white/[0.045] text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Familia</th>
                  <th className="px-4 py-3">Municao</th>
                  <th className="px-4 py-3">Valor final</th>
                  <th className="px-4 py-3">Canal</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Criado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {orders.map((order) => (
                  <tr key={order.id} className="bg-white/[0.02] transition hover:bg-white/[0.045]">
                    <td className="px-4 py-3 font-semibold text-white">{order.familyName}</td>
                    <td className="px-4 py-3 text-slate-300">{order.quantity.toLocaleString('pt-BR')}x {order.ammoName}</td>
                    <td className="px-4 py-3 text-slate-300">{formatMoney(order.finalValue)}</td>
                    <td className="px-4 py-3">
                      <a href={`https://discord.com/channels/${order.guildId}/${order.orderChannelId}`} target="_blank" rel="noreferrer" className="text-sky-200 hover:text-sky-100">
                        #{order.orderChannelId}
                      </a>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={order.status} /></td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(order.createdAt)}</td>
                  </tr>
                ))}
                {!orders.length ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      Nenhuma encomenda criada ainda.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function Metric({ label, value, tone, icon: Icon }: { label: string; value: number; tone: 'sky' | 'emerald' | 'rose' | 'amber'; icon: LucideIcon }) {
  const tones = {
    sky: 'bg-sky-400/10 text-sky-200',
    emerald: 'bg-emerald-400/10 text-emerald-200',
    rose: 'bg-rose-400/10 text-rose-200',
    amber: 'bg-amber-400/10 text-amber-200'
  };
  return (
    <div className="metric-card p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-slate-300">{label}</span>
        <span className={`grid h-12 w-12 place-items-center rounded-lg ${tones[tone]}`}>
          <Icon size={22} />
        </span>
      </div>
      <div className="mt-4 text-3xl font-semibold text-white">{value.toLocaleString('pt-BR')}</div>
    </div>
  );
}

function Input({ label, value, onChange, placeholder = '', type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        min={type === 'number' ? 0 : undefined}
        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-sky-300/60"
      />
    </label>
  );
}

function StatusBadge({ status }: { status: OrderItem['status'] }) {
  const classes = status === 'delivered'
    ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100'
    : status === 'rejected'
      ? 'border-rose-300/25 bg-rose-400/10 text-rose-100'
      : 'border-amber-300/25 bg-amber-400/10 text-amber-100';
  const label = status === 'delivered' ? 'Entregue' : status === 'rejected' ? 'Nao entregue' : 'Aguardando';
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${classes}`}>{label}</span>;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
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
