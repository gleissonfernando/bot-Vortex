'use client';

import { AppShell } from '@/components/app-shell';
import { apiFetch, downloadFile } from '@/lib/api';
import { subscribeDashboardEvents } from '@/lib/realtime';
import {
  BarChart3,
  Check,
  ClipboardList,
  Download,
  Edit3,
  FileDown,
  Filter,
  History,
  PackageCheck,
  PackagePlus,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Star,
  Trash2,
  Truck,
  Users,
  Warehouse,
  X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

type OrderStatus = 'pending' | 'separating' | 'transport' | 'delivered' | 'cancelled';
type ItemCategory = 'munitions' | 'weapons' | 'general' | 'drugs' | 'custom';
type TabKey = 'dashboard' | 'families' | 'orders' | 'logs' | 'stock' | 'settings';

type DiscordCategory = { id: string; name: string; position: number };
type DiscordTextChannel = { id: string; name: string; parentId?: string | null; position: number };

type OrderSettings = {
  guildId: string;
  orderCategoryId: string;
  orderCategoryName?: string | null;
  orderChannelId: string;
  orderChannelName?: string | null;
  defaultLogsWebhookUrl: string;
};

type OrderFamily = {
  id: string;
  guildId: string;
  name: string;
  slug: string;
  leaderId: string;
  leaderName: string;
  color: string;
  icon: string;
  logWebhookUrl: string;
  members: Array<{ discord_id: string; name?: string | null }>;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type InventoryItem = {
  id: string;
  guildId: string;
  name: string;
  slug: string;
  category: ItemCategory;
  categoryLabel: string;
  quantityAvailable: number;
  unitPrice: number;
  active: boolean;
};

type OrderLine = {
  inventoryItemId: string;
  name: string;
  category: ItemCategory;
  categoryLabel?: string;
  quantity: number;
  unitPrice: number;
  totalValue: number;
};

type OrderItem = {
  id: string;
  orderNumber: number;
  guildId: string;
  familyId: string;
  familyName: string;
  familyColor: string;
  familyIcon: string;
  responsibleId: string;
  responsibleName: string;
  items: OrderLine[];
  totalValue: number;
  status: OrderStatus;
  statusLabel: string;
  approvalChannelId: string;
  createdByName: string;
  cancellationReason: string;
  createdAt: string;
  updatedAt: string;
};

type OrderStats = {
  totalFamilies: number;
  totalOrders: number;
  pending: number;
  delivered: number;
  movedValue: number;
  ranking: Array<{ familyId: string; familyName: string; total: number; value: number }>;
};

type OrderFilters = {
  status: string;
  familyId: string;
  responsible: string;
  item: string;
  dateFrom: string;
  dateTo: string;
};

type OrderLog = {
  id: string;
  orderId: string;
  orderNumber: number | null;
  familyId: string;
  familyName: string;
  action: string;
  actorName: string;
  details: Record<string, unknown>;
  createdAt: string;
};

type FavoriteOrder = {
  id: string;
  familyId: string;
  familyName: string;
  name: string;
  items: OrderLine[];
  createdAt: string;
};

type CartLine = {
  key: string;
  inventoryItemId: string;
  name: string;
  category: ItemCategory;
  quantity: number;
  unitPrice: number;
};

const categoryOptions: Array<{ value: ItemCategory; label: string }> = [
  { value: 'munitions', label: 'Municoes' },
  { value: 'weapons', label: 'Armas' },
  { value: 'general', label: 'Itens Gerais' },
  { value: 'drugs', label: 'Drogas' },
  { value: 'custom', label: 'Personalizado' }
];

const tabs: Array<{ key: TabKey; label: string; icon: typeof BarChart3 }> = [
  { key: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'families', label: 'Familias', icon: Users },
  { key: 'orders', label: 'Pedidos', icon: ClipboardList },
  { key: 'logs', label: 'Logs', icon: History },
  { key: 'stock', label: 'Estoque', icon: Warehouse },
  { key: 'settings', label: 'Configuracoes', icon: Settings2 }
];

const emptyStats: OrderStats = {
  totalFamilies: 0,
  totalOrders: 0,
  pending: 0,
  delivered: 0,
  movedValue: 0,
  ranking: []
};

const initialFamilyForm = {
  id: '',
  name: '',
  leaderId: '',
  leaderName: '',
  color: '#0EA5E9',
  icon: '📦',
  logWebhookUrl: '',
  active: true,
  membersText: ''
};

const initialInventoryForm = {
  id: '',
  name: '',
  category: 'general' as ItemCategory,
  quantityAvailable: '0',
  unitPrice: '0',
  active: true
};

export default function OrdersPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [settings, setSettings] = useState<OrderSettings | null>(null);
  const [categories, setCategories] = useState<DiscordCategory[]>([]);
  const [textChannels, setTextChannels] = useState<DiscordTextChannel[]>([]);
  const [families, setFamilies] = useState<OrderFamily[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [logs, setLogs] = useState<OrderLog[]>([]);
  const [favorites, setFavorites] = useState<FavoriteOrder[]>([]);
  const [stats, setStats] = useState<OrderStats>(emptyStats);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [discordError, setDiscordError] = useState('');
  const [familyForm, setFamilyForm] = useState(initialFamilyForm);
  const [inventoryForm, setInventoryForm] = useState(initialInventoryForm);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState('');
  const [responsibleName, setResponsibleName] = useState('');
  const [selectedInventoryId, setSelectedInventoryId] = useState('');
  const [selectedQuantity, setSelectedQuantity] = useState('1');
  const [customItem, setCustomItem] = useState({ name: '', category: 'custom' as ItemCategory, quantity: '1', unitPrice: '0' });
  const [favoriteName, setFavoriteName] = useState('');
  const [saveAsFavorite, setSaveAsFavorite] = useState(false);
  const [filters, setFilters] = useState({ status: '', familyId: '', responsible: '', item: '', dateFrom: '', dateTo: '' });
  const [settingsForm, setSettingsForm] = useState({ orderCategoryId: '', orderChannelId: '', defaultLogsWebhookUrl: '' });

  const activeFamilies = useMemo(() => families.filter((family) => family.active), [families]);
  const selectedFamily = useMemo(() => families.find((family) => family.id === selectedFamilyId) || null, [families, selectedFamilyId]);
  const filteredFavorites = useMemo(() => favorites.filter((favorite) => !selectedFamilyId || favorite.familyId === selectedFamilyId), [favorites, selectedFamilyId]);
  const cartTotal = useMemo(() => cart.reduce((total, item) => total + item.quantity * item.unitPrice, 0), [cart]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params.toString();
  }, [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const [ordersData, settingsData, optionsData, familiesData, inventoryData, logsData, favoritesData] = await Promise.all([
        apiFetch<{ orders: OrderItem[]; stats: OrderStats }>(`/orders${queryString ? `?${queryString}` : ''}`),
        apiFetch<{ settings: OrderSettings }>('/orders/settings'),
        apiFetch<{ categories: DiscordCategory[]; textChannels: DiscordTextChannel[]; error?: string | null }>('/orders/discord-options').catch(() => null),
        apiFetch<{ families: OrderFamily[] }>('/orders/families?includeInactive=true'),
        apiFetch<{ inventory: InventoryItem[] }>('/orders/inventory?includeInactive=true'),
        apiFetch<{ logs: OrderLog[] }>('/orders/logs?limit=200'),
        apiFetch<{ favorites: FavoriteOrder[] }>('/orders/favorites')
      ]);

      setOrders(ordersData.orders || []);
      setStats(ordersData.stats || emptyStats);
      setSettings(settingsData.settings || null);
      setSettingsForm({
        orderCategoryId: settingsData.settings?.orderCategoryId || '',
        orderChannelId: settingsData.settings?.orderChannelId || '',
        defaultLogsWebhookUrl: settingsData.settings?.defaultLogsWebhookUrl || ''
      });
      setFamilies(familiesData.families || []);
      setInventory(inventoryData.inventory || []);
      setLogs(logsData.logs || []);
      setFavorites(favoritesData.favorites || []);

      if (optionsData) {
        setCategories(optionsData.categories || []);
        setTextChannels(optionsData.textChannels || []);
        setDiscordError(optionsData.error || '');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao carregar encomendas.');
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => subscribeDashboardEvents(load), [load]);

  useEffect(() => {
    const timer = window.setInterval(load, 8000);
    return () => window.clearInterval(timer);
  }, [load]);

  function setFilter(key: keyof typeof filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function setFamilyField(key: keyof typeof initialFamilyForm, value: string | boolean) {
    setFamilyForm((current) => ({ ...current, [key]: value }));
  }

  function setInventoryField(key: keyof typeof initialInventoryForm, value: string | boolean) {
    setInventoryForm((current) => ({ ...current, [key]: value }));
  }

  async function saveSettings() {
    setSaving(true);
    setMessage('');
    try {
      const data = await apiFetch<{ settings: OrderSettings }>('/orders/settings', {
        method: 'PUT',
        body: JSON.stringify(settingsForm)
      });
      setSettings(data.settings);
      setMessage('Configuracoes de encomendas salvas.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar configuracoes.');
    } finally {
      setSaving(false);
    }
  }

  async function saveFamily() {
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        name: familyForm.name,
        leaderId: familyForm.leaderId,
        leaderName: familyForm.leaderName,
        color: familyForm.color,
        icon: familyForm.icon,
        logWebhookUrl: familyForm.logWebhookUrl,
        active: familyForm.active,
        members: parseMembers(familyForm.membersText)
      };
      await apiFetch(familyForm.id ? `/orders/families/${familyForm.id}` : '/orders/families', {
        method: familyForm.id ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      setFamilyForm(initialFamilyForm);
      setMessage(familyForm.id ? 'Familia atualizada.' : 'Familia criada.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar familia.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteFamily(family: OrderFamily) {
    if (!window.confirm(`Remover ${family.name}?`)) return;
    setSaving(true);
    try {
      await apiFetch(`/orders/families/${family.id}`, { method: 'DELETE' });
      setMessage('Familia removida.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao remover familia.');
    } finally {
      setSaving(false);
    }
  }

  function editFamily(family: OrderFamily) {
    setFamilyForm({
      id: family.id,
      name: family.name,
      leaderId: family.leaderId || '',
      leaderName: family.leaderName || '',
      color: family.color || '#0EA5E9',
      icon: family.icon || '📦',
      logWebhookUrl: family.logWebhookUrl || '',
      active: family.active,
      membersText: (family.members || []).map((member) => `${member.discord_id}${member.name ? ` - ${member.name}` : ''}`).join('\n')
    });
    setActiveTab('families');
  }

  async function saveInventoryItem() {
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        name: inventoryForm.name,
        category: inventoryForm.category,
        quantityAvailable: Number(inventoryForm.quantityAvailable),
        unitPrice: Number(inventoryForm.unitPrice),
        active: inventoryForm.active
      };
      await apiFetch(inventoryForm.id ? `/orders/inventory/${inventoryForm.id}` : '/orders/inventory', {
        method: inventoryForm.id ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      setInventoryForm(initialInventoryForm);
      setMessage(inventoryForm.id ? 'Item atualizado.' : 'Item cadastrado.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar item.');
    } finally {
      setSaving(false);
    }
  }

  function editInventoryItem(item: InventoryItem) {
    setInventoryForm({
      id: item.id,
      name: item.name,
      category: item.category,
      quantityAvailable: String(item.quantityAvailable),
      unitPrice: String(item.unitPrice),
      active: item.active
    });
    setActiveTab('stock');
  }

  async function disableInventoryItem(item: InventoryItem) {
    setSaving(true);
    try {
      await apiFetch(`/orders/inventory/${item.id}`, { method: 'DELETE' });
      setMessage('Item desativado.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao desativar item.');
    } finally {
      setSaving(false);
    }
  }

  function addInventoryToCart() {
    const item = inventory.find((entry) => entry.id === selectedInventoryId);
    const quantity = Math.max(1, Math.floor(Number(selectedQuantity) || 1));
    if (!item) {
      setMessage('Selecione um item do estoque.');
      return;
    }
    setCart((current) => upsertCartLine(current, {
      key: item.id,
      inventoryItemId: item.id,
      name: item.name,
      category: item.category,
      quantity,
      unitPrice: item.unitPrice
    }));
    setSelectedQuantity('1');
  }

  function addCustomToCart() {
    const quantity = Math.max(1, Math.floor(Number(customItem.quantity) || 1));
    const unitPrice = Math.max(0, Number(customItem.unitPrice) || 0);
    if (!customItem.name.trim()) {
      setMessage('Informe o item personalizado.');
      return;
    }
    setCart((current) => upsertCartLine(current, {
      key: `custom-${Date.now()}`,
      inventoryItemId: '',
      name: customItem.name.trim(),
      category: customItem.category,
      quantity,
      unitPrice
    }));
    setCustomItem({ name: '', category: 'custom', quantity: '1', unitPrice: '0' });
  }

  function updateCartQuantity(key: string, value: number) {
    const quantity = Math.max(1, Math.floor(value || 1));
    setCart((current) => current.map((item) => item.key === key ? { ...item, quantity } : item));
  }

  async function createOrder() {
    if (!selectedFamilyId) {
      setMessage('Selecione uma familia.');
      return;
    }
    if (!cart.length) {
      setMessage('Adicione pelo menos um item ao carrinho.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const data = await apiFetch<{ order: OrderItem }>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          familyId: selectedFamilyId,
          responsibleName,
          saveAsFavorite,
          favoriteName,
          items: cart.map((item) => ({
            inventoryItemId: item.inventoryItemId,
            name: item.name,
            category: item.category,
            quantity: item.quantity,
            unitPrice: item.unitPrice
          }))
        })
      });
      setMessage(`Pedido #${data.order.orderNumber} criado.`);
      setCart([]);
      setResponsibleName('');
      setSaveAsFavorite(false);
      setFavoriteName('');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao criar pedido.');
    } finally {
      setSaving(false);
    }
  }

  async function saveFavoriteFromCart() {
    if (!selectedFamilyId || !cart.length || !favoriteName.trim()) {
      setMessage('Selecione familia, itens e nome do modelo.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/orders/favorites', {
        method: 'POST',
        body: JSON.stringify({
          familyId: selectedFamilyId,
          name: favoriteName,
          items: cart.map((item) => ({
            inventoryItemId: item.inventoryItemId,
            name: item.name,
            category: item.category,
            quantity: item.quantity,
            unitPrice: item.unitPrice
          }))
        })
      });
      setFavoriteName('');
      setMessage('Modelo salvo.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar modelo.');
    } finally {
      setSaving(false);
    }
  }

  function useFavorite(favorite: FavoriteOrder) {
    setSelectedFamilyId(favorite.familyId);
    setCart(favorite.items.map((item, index) => ({
      key: item.inventoryItemId || `favorite-${favorite.id}-${index}`,
      inventoryItemId: item.inventoryItemId,
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      unitPrice: item.unitPrice
    })));
    setActiveTab('orders');
  }

  async function deleteFavorite(favorite: FavoriteOrder) {
    setSaving(true);
    try {
      await apiFetch(`/orders/favorites/${favorite.id}`, { method: 'DELETE' });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao excluir modelo.');
    } finally {
      setSaving(false);
    }
  }

  async function setOrderStatus(order: OrderItem, status: OrderStatus) {
    const reason = status === 'cancelled' ? window.prompt('Motivo do cancelamento') || 'Cancelado pelo painel.' : '';
    setSaving(true);
    try {
      await apiFetch(`/orders/${order.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, reason })
      });
      setMessage(`Pedido #${order.orderNumber} atualizado.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao atualizar pedido.');
    } finally {
      setSaving(false);
    }
  }

  async function exportReport(format: 'csv' | 'excel' | 'pdf') {
    const params = new URLSearchParams(queryString);
    params.set('format', format);
    await downloadFile(`/orders/export?${params.toString()}`, `encomendas.${format === 'excel' ? 'xls' : format}`);
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <header className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-100">
              <PackageCheck size={14} />
              Sistema de Encomendas V2
            </div>
            <h1 className="mt-3 text-3xl font-semibold text-white">Encomendas</h1>
          </div>
          <button onClick={load} disabled={loading} title="Atualizar" className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </header>

        {message ? <pre className="whitespace-pre-wrap rounded-lg border border-sky-300/20 bg-sky-400/10 px-4 py-3 text-sm leading-6 text-sky-100">{message}</pre> : null}
        {discordError ? <div className="rounded-lg border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">{discordError}</div> : null}

        <nav className="flex gap-2 overflow-x-auto rounded-lg border border-white/10 bg-white/[0.025] p-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${active ? 'bg-blue-500/20 text-white' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'}`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {activeTab === 'dashboard' ? (
          <DashboardTab stats={stats} families={families} orders={orders} />
        ) : null}

        {activeTab === 'families' ? (
          <FamiliesTab
            familyForm={familyForm}
            setFamilyField={setFamilyField}
            saveFamily={saveFamily}
            resetFamily={() => setFamilyForm(initialFamilyForm)}
            families={families}
            editFamily={editFamily}
            deleteFamily={deleteFamily}
            saving={saving}
          />
        ) : null}

        {activeTab === 'orders' ? (
          <OrdersTab
            families={activeFamilies}
            inventory={inventory.filter((item) => item.active)}
            orders={orders}
            selectedFamilyId={selectedFamilyId}
            setSelectedFamilyId={setSelectedFamilyId}
            selectedFamily={selectedFamily}
            responsibleName={responsibleName}
            setResponsibleName={setResponsibleName}
            selectedInventoryId={selectedInventoryId}
            setSelectedInventoryId={setSelectedInventoryId}
            selectedQuantity={selectedQuantity}
            setSelectedQuantity={setSelectedQuantity}
            addInventoryToCart={addInventoryToCart}
            customItem={customItem}
            setCustomItem={setCustomItem}
            addCustomToCart={addCustomToCart}
            cart={cart}
            cartTotal={cartTotal}
            updateCartQuantity={updateCartQuantity}
            removeCartLine={(key) => setCart((current) => current.filter((item) => item.key !== key))}
            clearCart={() => setCart([])}
            createOrder={createOrder}
            saving={saving}
            favorites={filteredFavorites}
            favoriteName={favoriteName}
            setFavoriteName={setFavoriteName}
            saveAsFavorite={saveAsFavorite}
            setSaveAsFavorite={setSaveAsFavorite}
            saveFavoriteFromCart={saveFavoriteFromCart}
            useFavorite={useFavorite}
            deleteFavorite={deleteFavorite}
            setOrderStatus={setOrderStatus}
          />
        ) : null}

        {activeTab === 'logs' ? (
          <LogsTab logs={logs} />
        ) : null}

        {activeTab === 'stock' ? (
          <StockTab
            inventoryForm={inventoryForm}
            setInventoryField={setInventoryField}
            saveInventoryItem={saveInventoryItem}
            resetInventory={() => setInventoryForm(initialInventoryForm)}
            inventory={inventory}
            editInventoryItem={editInventoryItem}
            disableInventoryItem={disableInventoryItem}
            saving={saving}
          />
        ) : null}

        {activeTab === 'settings' ? (
          <SettingsTab
            settings={settings}
            settingsForm={settingsForm}
            setSettingsForm={setSettingsForm}
            categories={categories}
            textChannels={textChannels}
            filters={filters}
            setFilter={setFilter}
            families={families}
            saveSettings={saveSettings}
            exportReport={exportReport}
            saving={saving}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

function DashboardTab({ stats, families, orders }: { stats: OrderStats; families: OrderFamily[]; orders: OrderItem[] }) {
  return (
    <div className="space-y-5">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Metric label="Familias" value={stats.totalFamilies} icon={Users} tone="sky" />
        <Metric label="Pedidos" value={stats.totalOrders} icon={ClipboardList} tone="violet" />
        <Metric label="Pendentes" value={stats.pending} icon={History} tone="amber" />
        <Metric label="Entregues" value={stats.delivered} icon={PackageCheck} tone="emerald" />
        <Metric label="Movimentado" value={formatMoney(stats.movedValue)} icon={BarChart3} tone="rose" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_1.25fr]">
        <div className="panel p-5">
          <h2 className="text-lg font-semibold text-white">Ranking de Familias</h2>
          <div className="mt-4 space-y-3">
            {stats.ranking.map((item, index) => (
              <div key={item.familyId || item.familyName} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.035] px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{index + 1}. {item.familyName}</p>
                  <p className="text-xs text-slate-500">{item.total} pedido{item.total === 1 ? '' : 's'}</p>
                </div>
                <span className="text-sm font-semibold text-emerald-100">{formatMoney(item.value)}</span>
              </div>
            ))}
            {!stats.ranking.length ? <Empty text="Sem pedidos no ranking." /> : null}
          </div>
        </div>

        <div className="panel overflow-hidden">
          <div className="border-b border-white/10 px-4 py-3">
            <h2 className="text-lg font-semibold text-white">Pedidos Recentes</h2>
          </div>
          <OrdersTable orders={orders.slice(0, 8)} compact />
        </div>
      </section>

      <section className="panel overflow-hidden">
        <div className="border-b border-white/10 px-4 py-3">
          <h2 className="text-lg font-semibold text-white">Familias Ativas</h2>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          {families.filter((family) => family.active).map((family) => (
            <div key={family.id} className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-lg text-lg" style={{ background: `${family.color}22`, color: family.color }}>{family.icon || '📦'}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{family.name}</p>
                  <p className="truncate text-xs text-slate-500">{family.leaderName || family.leaderId || 'Sem lider'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function FamiliesTab(props: {
  familyForm: typeof initialFamilyForm;
  setFamilyField: (key: keyof typeof initialFamilyForm, value: string | boolean) => void;
  saveFamily: () => void;
  resetFamily: () => void;
  families: OrderFamily[];
  editFamily: (family: OrderFamily) => void;
  deleteFamily: (family: OrderFamily) => void;
  saving: boolean;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[0.95fr_1.35fr]">
      <section className="panel p-5">
        <h2 className="text-lg font-semibold text-white">{props.familyForm.id ? 'Editar Familia' : 'Criar Familia'}</h2>
        <div className="mt-5 grid gap-4">
          <Input label="Nome" value={props.familyForm.name} onChange={(value) => props.setFamilyField('name', value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Lider Discord ID" value={props.familyForm.leaderId} onChange={(value) => props.setFamilyField('leaderId', value)} />
            <Input label="Nome do lider" value={props.familyForm.leaderName} onChange={(value) => props.setFamilyField('leaderName', value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Cor" type="color" value={props.familyForm.color} onChange={(value) => props.setFamilyField('color', value)} />
            <Input label="Emoji/Icone" value={props.familyForm.icon} onChange={(value) => props.setFamilyField('icon', value)} />
          </div>
          <Input label="Webhook de logs" value={props.familyForm.logWebhookUrl} onChange={(value) => props.setFamilyField('logWebhookUrl', value)} />
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Membros</span>
            <textarea value={props.familyForm.membersText} onChange={(event) => props.setFamilyField('membersText', event.target.value)} rows={4} className="mt-1 w-full rounded-lg border border-white/10 px-3 py-2 text-sm outline-none" />
          </label>
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-200">
            <input type="checkbox" checked={props.familyForm.active} onChange={(event) => props.setFamilyField('active', event.target.checked)} className="h-4 w-4" />
            Familia ativa
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button onClick={props.resetFamily} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]">
              <X size={16} />
              Limpar
            </button>
            <button onClick={props.saveFamily} disabled={props.saving || !props.familyForm.name.trim()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700">
              <Save size={16} />
              Salvar
            </button>
          </div>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <TableHeader title="Familias Cadastradas" count={props.families.length} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Familia</th>
                <th className="px-4 py-3">Lider</th>
                <th className="px-4 py-3">Membros</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {props.families.map((family) => (
                <tr key={family.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: `${family.color}22`, color: family.color }}>{family.icon || '📦'}</span>
                      <div>
                        <p className="font-semibold text-white">{family.name}</p>
                        <p className="text-xs text-slate-500">{family.slug}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{family.leaderName || family.leaderId || 'N/A'}</td>
                  <td className="px-4 py-3 text-slate-300">{family.members?.length || 0}</td>
                  <td className="px-4 py-3"><StatePill active={family.active} /></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <IconButton title="Editar" onClick={() => props.editFamily(family)} icon={Edit3} />
                      <IconButton title="Excluir" onClick={() => props.deleteFamily(family)} icon={Trash2} tone="danger" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function OrdersTab(props: {
  families: OrderFamily[];
  inventory: InventoryItem[];
  orders: OrderItem[];
  selectedFamilyId: string;
  setSelectedFamilyId: (value: string) => void;
  selectedFamily: OrderFamily | null;
  responsibleName: string;
  setResponsibleName: (value: string) => void;
  selectedInventoryId: string;
  setSelectedInventoryId: (value: string) => void;
  selectedQuantity: string;
  setSelectedQuantity: (value: string) => void;
  addInventoryToCart: () => void;
  customItem: { name: string; category: ItemCategory; quantity: string; unitPrice: string };
  setCustomItem: (value: { name: string; category: ItemCategory; quantity: string; unitPrice: string }) => void;
  addCustomToCart: () => void;
  cart: CartLine[];
  cartTotal: number;
  updateCartQuantity: (key: string, value: number) => void;
  removeCartLine: (key: string) => void;
  clearCart: () => void;
  createOrder: () => void;
  saving: boolean;
  favorites: FavoriteOrder[];
  favoriteName: string;
  setFavoriteName: (value: string) => void;
  saveAsFavorite: boolean;
  setSaveAsFavorite: (value: boolean) => void;
  saveFavoriteFromCart: () => void;
  useFavorite: (favorite: FavoriteOrder) => void;
  deleteFavorite: (favorite: FavoriteOrder) => void;
  setOrderStatus: (order: OrderItem, status: OrderStatus) => void;
}) {
  return (
    <div className="space-y-5">
      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.25fr]">
        <div className="panel p-5">
          <h2 className="text-lg font-semibold text-white">Fazer Pedido</h2>
          <div className="mt-5 grid gap-4">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Familia</span>
              <select value={props.selectedFamilyId} onChange={(event) => props.setSelectedFamilyId(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 px-3 py-2 text-sm outline-none">
                <option value="">Selecionar familia</option>
                {props.families.map((family) => <option key={family.id} value={family.id}>{family.icon} {family.name}</option>)}
              </select>
            </label>
            <Input label="Responsavel" value={props.responsibleName} onChange={props.setResponsibleName} />
            <div className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
              <div className="grid gap-3 lg:grid-cols-[1fr_110px_auto]">
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Item do estoque</span>
                  <select value={props.selectedInventoryId} onChange={(event) => props.setSelectedInventoryId(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 px-3 py-2 text-sm outline-none">
                    <option value="">Selecionar item</option>
                    {props.inventory.map((item) => (
                      <option key={item.id} value={item.id}>{item.name} | {item.categoryLabel} | {item.quantityAvailable} disp.</option>
                    ))}
                  </select>
                </label>
                <Input label="Qtd." type="number" value={props.selectedQuantity} onChange={props.setSelectedQuantity} />
                <button onClick={props.addInventoryToCart} className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-400">
                  <Plus size={16} />
                  Adicionar
                </button>
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
              <div className="grid gap-3 lg:grid-cols-[1fr_150px_110px_120px_auto]">
                <Input label="Personalizado" value={props.customItem.name} onChange={(value) => props.setCustomItem({ ...props.customItem, name: value })} />
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Tipo</span>
                  <select value={props.customItem.category} onChange={(event) => props.setCustomItem({ ...props.customItem, category: event.target.value as ItemCategory })} className="mt-1 w-full rounded-lg border border-white/10 px-3 py-2 text-sm outline-none">
                    {categoryOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <Input label="Qtd." type="number" value={props.customItem.quantity} onChange={(value) => props.setCustomItem({ ...props.customItem, quantity: value })} />
                <Input label="Valor" type="number" value={props.customItem.unitPrice} onChange={(value) => props.setCustomItem({ ...props.customItem, unitPrice: value })} />
                <button onClick={props.addCustomToCart} className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-white/[0.08] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.13]">
                  <Plus size={16} />
                  Adicionar
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Pedido</h2>
              <p className="text-sm text-slate-500">{props.selectedFamily ? `${props.selectedFamily.icon} ${props.selectedFamily.name}` : 'Sem familia selecionada'}</p>
            </div>
            <span className="text-xl font-semibold text-emerald-100">{formatMoney(props.cartTotal)}</span>
          </div>
          <div className="p-4">
            <div className="space-y-2">
              {props.cart.map((item) => (
                <div key={item.key} className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3 sm:grid-cols-[1fr_110px_120px_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{item.name}</p>
                    <p className="text-xs text-slate-500">{categoryOptions.find((entry) => entry.value === item.category)?.label || item.category}</p>
                  </div>
                  <Input label="Qtd." type="number" value={String(item.quantity)} onChange={(value) => props.updateCartQuantity(item.key, Number(value))} />
                  <div className="text-sm font-semibold text-slate-200">{formatMoney(item.quantity * item.unitPrice)}</div>
                  <IconButton title="Remover" onClick={() => props.removeCartLine(item.key)} icon={Trash2} tone="danger" />
                </div>
              ))}
              {!props.cart.length ? <Empty text="Carrinho vazio." /> : null}
            </div>
            <div className="mt-4 grid gap-3 border-t border-white/10 pt-4 lg:grid-cols-[1fr_auto_auto]">
              <Input label="Nome do modelo" value={props.favoriteName} onChange={props.setFavoriteName} />
              <label className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-200">
                <input type="checkbox" checked={props.saveAsFavorite} onChange={(event) => props.setSaveAsFavorite(event.target.checked)} className="h-4 w-4" />
                Salvar Modelo
              </label>
              <button onClick={props.saveFavoriteFromCart} disabled={!props.cart.length || !props.favoriteName.trim()} className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50">
                <Star size={16} />
                Salvar
              </button>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button onClick={props.clearCart} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]">
                <Trash2 size={16} />
                Limpar
              </button>
              <button onClick={props.createOrder} disabled={props.saving || !props.selectedFamilyId || !props.cart.length} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700">
                <Check size={16} />
                Finalizar Pedido
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <TableHeader title="Modelos Favoritos" count={props.favorites.length} />
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {props.favorites.map((favorite) => (
            <div key={favorite.id} className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{favorite.name}</p>
                  <p className="text-xs text-slate-500">{favorite.familyName}</p>
                </div>
                <Star size={17} className="text-amber-200" />
              </div>
              <div className="mt-3 space-y-1 text-xs text-slate-300">
                {favorite.items.slice(0, 4).map((item, index) => <p key={`${favorite.id}-${index}`}>{item.quantity}x {item.name}</p>)}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => props.useFavorite(favorite)} className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-400">
                  <ClipboardList size={14} />
                  Usar Modelo
                </button>
                <IconButton title="Excluir" onClick={() => props.deleteFavorite(favorite)} icon={Trash2} tone="danger" />
              </div>
            </div>
          ))}
          {!props.favorites.length ? <Empty text="Nenhum modelo favorito." /> : null}
        </div>
      </section>

      <section className="panel overflow-hidden">
        <TableHeader title="Pedidos" count={props.orders.length} />
        <OrdersTable orders={props.orders} setOrderStatus={props.setOrderStatus} />
      </section>
    </div>
  );
}

function LogsTab({ logs }: { logs: OrderLog[] }) {
  return (
    <section className="panel overflow-hidden">
      <TableHeader title="Historico de Logs" count={logs.length} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Pedido</th>
              <th className="px-4 py-3">Familia</th>
              <th className="px-4 py-3">Acao</th>
              <th className="px-4 py-3">Por</th>
              <th className="px-4 py-3">Detalhes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="px-4 py-3 text-slate-500">{formatDate(log.createdAt)}</td>
                <td className="px-4 py-3 font-semibold text-white">{log.orderNumber ? `#${log.orderNumber}` : 'N/A'}</td>
                <td className="px-4 py-3 text-slate-300">{log.familyName || 'N/A'}</td>
                <td className="px-4 py-3 text-slate-300">{log.action}</td>
                <td className="px-4 py-3 text-slate-300">{log.actorName || 'Sistema'}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{JSON.stringify(log.details || {})}</td>
              </tr>
            ))}
            {!logs.length ? <EmptyRow colSpan={6} text="Nenhum log registrado." /> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StockTab(props: {
  inventoryForm: typeof initialInventoryForm;
  setInventoryField: (key: keyof typeof initialInventoryForm, value: string | boolean) => void;
  saveInventoryItem: () => void;
  resetInventory: () => void;
  inventory: InventoryItem[];
  editInventoryItem: (item: InventoryItem) => void;
  disableInventoryItem: (item: InventoryItem) => void;
  saving: boolean;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[0.85fr_1.4fr]">
      <section className="panel p-5">
        <h2 className="text-lg font-semibold text-white">{props.inventoryForm.id ? 'Editar Item' : 'Cadastrar Item'}</h2>
        <div className="mt-5 grid gap-4">
          <Input label="Nome do item" value={props.inventoryForm.name} onChange={(value) => props.setInventoryField('name', value)} />
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Categoria</span>
            <select value={props.inventoryForm.category} onChange={(event) => props.setInventoryField('category', event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 px-3 py-2 text-sm outline-none">
              {categoryOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Quantidade disponivel" type="number" value={props.inventoryForm.quantityAvailable} onChange={(value) => props.setInventoryField('quantityAvailable', value)} />
            <Input label="Valor unitario" type="number" value={props.inventoryForm.unitPrice} onChange={(value) => props.setInventoryField('unitPrice', value)} />
          </div>
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-200">
            <input type="checkbox" checked={props.inventoryForm.active} onChange={(event) => props.setInventoryField('active', event.target.checked)} className="h-4 w-4" />
            Item ativo
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={props.resetInventory} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]">
              <X size={16} />
              Limpar
            </button>
            <button onClick={props.saveInventoryItem} disabled={props.saving || !props.inventoryForm.name.trim()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700">
              <Save size={16} />
              Salvar
            </button>
          </div>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <TableHeader title="Estoque" count={props.inventory.length} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3">Disponivel</th>
                <th className="px-4 py-3">Valor</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {props.inventory.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-semibold text-white">{item.name}</td>
                  <td className="px-4 py-3 text-slate-300">{item.categoryLabel}</td>
                  <td className="px-4 py-3 text-slate-300">{item.quantityAvailable.toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-3 text-slate-300">{formatMoney(item.unitPrice)}</td>
                  <td className="px-4 py-3"><StatePill active={item.active} /></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <IconButton title="Editar" onClick={() => props.editInventoryItem(item)} icon={Edit3} />
                      <IconButton title="Desativar" onClick={() => props.disableInventoryItem(item)} icon={Trash2} tone="danger" />
                    </div>
                  </td>
                </tr>
              ))}
              {!props.inventory.length ? <EmptyRow colSpan={6} text="Nenhum item cadastrado." /> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SettingsTab(props: {
  settings: OrderSettings | null;
  settingsForm: { orderCategoryId: string; orderChannelId: string; defaultLogsWebhookUrl: string };
  setSettingsForm: (value: { orderCategoryId: string; orderChannelId: string; defaultLogsWebhookUrl: string }) => void;
  categories: DiscordCategory[];
  textChannels: DiscordTextChannel[];
  filters: OrderFilters;
  setFilter: (key: keyof OrderFilters, value: string) => void;
  families: OrderFamily[];
  saveSettings: () => void;
  exportReport: (format: 'csv' | 'excel' | 'pdf') => void;
  saving: boolean;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="panel p-5">
        <h2 className="text-lg font-semibold text-white">Configurações</h2>
        <div className="mt-5 grid gap-4">
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Categoria de apoio</span>
            <select value={props.settingsForm.orderCategoryId} onChange={(event) => props.setSettingsForm({ ...props.settingsForm, orderCategoryId: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 px-3 py-2 text-sm outline-none">
              <option value="">Sem categoria</option>
              {props.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Canal de encomendas</span>
            <select value={props.settingsForm.orderChannelId} onChange={(event) => props.setSettingsForm({ ...props.settingsForm, orderChannelId: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 px-3 py-2 text-sm outline-none">
              <option value="">Sem canal</option>
              {props.textChannels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
            </select>
          </label>
          <Input label="Webhook padrao de logs" value={props.settingsForm.defaultLogsWebhookUrl} onChange={(value) => props.setSettingsForm({ ...props.settingsForm, defaultLogsWebhookUrl: value })} />
          <div className="rounded-lg border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-slate-300">
            Atual: #{props.settings?.orderChannelName || props.settings?.orderChannelId || 'nao configurado'}
          </div>
          <div className="flex justify-end">
            <button onClick={props.saveSettings} disabled={props.saving} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700">
              <Save size={16} />
              Salvar
            </button>
          </div>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="text-lg font-semibold text-white">Relatorios</h2>
        <div className="mt-5 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Familia</span>
              <select value={props.filters.familyId} onChange={(event) => props.setFilter('familyId', event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 px-3 py-2 text-sm outline-none">
                <option value="">Todas</option>
                {props.families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Status</span>
              <select value={props.filters.status} onChange={(event) => props.setFilter('status', event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 px-3 py-2 text-sm outline-none">
                <option value="">Todos</option>
                <option value="pending">Pendente</option>
                <option value="separating">Em Separacao</option>
                <option value="transport">Em Transporte</option>
                <option value="delivered">Entregue</option>
                <option value="cancelled">Cancelado</option>
              </select>
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Responsavel" value={props.filters.responsible} onChange={(value) => props.setFilter('responsible', value)} />
            <Input label="Item" value={props.filters.item} onChange={(value) => props.setFilter('item', value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Data inicial" type="date" value={props.filters.dateFrom} onChange={(value) => props.setFilter('dateFrom', value)} />
            <Input label="Data final" type="date" value={props.filters.dateTo} onChange={(value) => props.setFilter('dateTo', value)} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <ExportButton label="CSV" icon={FileDown} onClick={() => props.exportReport('csv')} />
            <ExportButton label="Excel" icon={Download} onClick={() => props.exportReport('excel')} />
            <ExportButton label="PDF" icon={Filter} onClick={() => props.exportReport('pdf')} />
          </div>
        </div>
      </section>
    </div>
  );
}

function OrdersTable({ orders, compact = false, setOrderStatus }: { orders: OrderItem[]; compact?: boolean; setOrderStatus?: (order: OrderItem, status: OrderStatus) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Pedido</th>
            <th className="px-4 py-3">Familia</th>
            <th className="px-4 py-3">Itens</th>
            <th className="px-4 py-3">Valor</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Criado</th>
            {!compact ? <th className="px-4 py-3 text-right">Acoes</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {orders.map((order) => (
            <tr key={order.id}>
              <td className="px-4 py-3 font-semibold text-white">#{order.orderNumber}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span>{order.familyIcon}</span>
                  <span className="font-semibold text-slate-200">{order.familyName}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-slate-300">{order.items.slice(0, 3).map((item) => `${item.quantity}x ${item.name}`).join(', ')}</td>
              <td className="px-4 py-3 text-slate-300">{formatMoney(order.totalValue)}</td>
              <td className="px-4 py-3"><StatusBadge status={order.status} label={order.statusLabel} /></td>
              <td className="px-4 py-3 text-slate-500">{formatDate(order.createdAt)}</td>
              {!compact ? (
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <IconButton title="Aprovar" onClick={() => setOrderStatus?.(order, 'separating')} icon={ShieldCheck} disabled={order.status !== 'pending'} />
                    <IconButton title="Transporte" onClick={() => setOrderStatus?.(order, 'transport')} icon={Truck} disabled={!['pending', 'separating'].includes(order.status)} />
                    <IconButton title="Entregue" onClick={() => setOrderStatus?.(order, 'delivered')} icon={PackageCheck} disabled={['delivered', 'cancelled'].includes(order.status)} />
                    <IconButton title="Cancelar" onClick={() => setOrderStatus?.(order, 'cancelled')} icon={X} tone="danger" disabled={order.status === 'cancelled'} />
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
          {!orders.length ? <EmptyRow colSpan={compact ? 6 : 7} text="Nenhum pedido encontrado." /> : null}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value, icon: Icon, tone }: { label: string; value: number | string; icon: typeof BarChart3; tone: 'sky' | 'emerald' | 'amber' | 'rose' | 'violet' }) {
  const tones = {
    sky: 'bg-sky-400/10 text-sky-200',
    emerald: 'bg-emerald-400/10 text-emerald-200',
    amber: 'bg-amber-400/10 text-amber-200',
    rose: 'bg-rose-400/10 text-rose-200',
    violet: 'bg-violet-400/10 text-violet-200'
  };
  return (
    <div className="metric-card p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-slate-300">{label}</span>
        <span className={`grid h-11 w-11 place-items-center rounded-lg ${tones[tone]}`}>
          <Icon size={21} />
        </span>
      </div>
      <div className="mt-4 text-2xl font-semibold text-white">{typeof value === 'number' ? value.toLocaleString('pt-BR') : value}</div>
    </div>
  );
}

function TableHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <span className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-300">{count}</span>
    </div>
  );
}

function Input({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <input type={type} value={value} min={type === 'number' ? 0 : undefined} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 px-3 py-2 text-sm outline-none" />
    </label>
  );
}

function IconButton({ title, onClick, icon: Icon, tone = 'neutral', disabled = false }: { title: string; onClick: () => void; icon: typeof Edit3; tone?: 'neutral' | 'danger'; disabled?: boolean }) {
  return (
    <button title={title} onClick={onClick} disabled={disabled} className={`grid h-9 w-9 place-items-center rounded-lg border border-white/10 ${tone === 'danger' ? 'text-rose-200 hover:bg-rose-400/10' : 'text-slate-300 hover:bg-white/[0.08]'} disabled:cursor-not-allowed disabled:opacity-35`}>
      <Icon size={16} />
    </button>
  );
}

function ExportButton({ label, icon: Icon, onClick }: { label: string; icon: typeof Download; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.1]">
      <Icon size={16} />
      {label}
    </button>
  );
}

function StatusBadge({ status, label }: { status: OrderStatus; label: string }) {
  const classes = status === 'delivered'
    ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100'
    : status === 'cancelled'
      ? 'border-rose-300/25 bg-rose-400/10 text-rose-100'
      : status === 'transport'
        ? 'border-sky-300/25 bg-sky-400/10 text-sky-100'
        : status === 'separating'
          ? 'border-violet-300/25 bg-violet-400/10 text-violet-100'
          : 'border-amber-300/25 bg-amber-400/10 text-amber-100';
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${classes}`}>{label}</span>;
}

function StatePill({ active }: { active: boolean }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${active ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100' : 'border-slate-300/15 bg-slate-400/10 text-slate-300'}`}>{active ? 'Ativa' : 'Inativa'}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-white/10 bg-white/[0.025] px-4 py-6 text-center text-sm text-slate-500">{text}</div>;
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-slate-500">{text}</td>
    </tr>
  );
}

function upsertCartLine(cart: CartLine[], next: CartLine) {
  const existing = cart.find((item) => item.key === next.key);
  if (!existing) return [...cart, next];
  return cart.map((item) => item.key === next.key ? { ...item, quantity: item.quantity + next.quantity } : item);
}

function parseMembers(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, ...nameParts] = line.split(/\s*-\s*/);
      return { discordId: id.trim(), name: nameParts.join(' - ').trim() };
    })
    .filter((item) => /^\d{5,32}$/.test(item.discordId));
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
