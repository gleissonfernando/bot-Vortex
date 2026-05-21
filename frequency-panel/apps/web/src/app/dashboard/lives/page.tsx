'use client';

import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import { Activity, Bell, Edit3, PlayCircle, Plus, Radio, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type LiveItem = {
  id: string;
  platform: string;
  url: string;
  streamerName: string;
  alertChannelId: string | null;
  mentionRoleId: string | null;
  enabled: boolean;
  customMessage: string | null;
  status: 'online' | 'offline' | 'unknown';
  lastLiveTitle?: string | null;
};

type Settings = {
  enabled: boolean;
  defaultAlertChannelId: string | null;
  defaultMentionRoleId: string | null;
  defaultMessage: string;
  checkIntervalSeconds: number;
};

const platforms = [
  { id: 'twitch', name: 'Twitch', gradient: 'from-purple-500 via-fuchsia-500 to-indigo-500', mark: 'TW' },
  { id: 'youtube', name: 'YouTube', gradient: 'from-red-500 via-rose-500 to-orange-400', mark: 'YT' },
  { id: 'kick', name: 'Kick', gradient: 'from-lime-400 via-emerald-400 to-cyan-400', mark: 'K' },
  { id: 'custom', name: 'URL personalizada', gradient: 'from-sky-400 via-blue-500 to-violet-500', mark: 'URL' }
];

const defaultMessage = '🔴 {streamer} está ao vivo!\n\n🎮 Plataforma: {platform}\n📺 Título da live: {title}\n👤 Streamer: {streamer}\n🔗 Assistir agora: {url}';

export default function LivesPage() {
  const [lives, setLives] = useState<LiveItem[]>([]);
  const [settings, setSettings] = useState<Settings>({
    enabled: true,
    defaultAlertChannelId: '',
    defaultMentionRoleId: '',
    defaultMessage,
    checkIntervalSeconds: 120
  });
  const [selectedPlatform, setSelectedPlatform] = useState('twitch');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    url: '',
    streamerName: '',
    alertChannelId: '',
    mentionRoleId: '',
    enabled: true,
    customMessage: ''
  });

  const editing = useMemo(() => lives.find((live) => live.id === editingId) || null, [lives, editingId]);

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ lives: LiveItem[]; settings: Settings }>('/lives');
      setLives(data.lives);
      setSettings(data.settings);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao carregar lives');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function selectPlatform(id: string) {
    setSelectedPlatform(id);
    setEditingId(null);
    setForm({ url: '', streamerName: '', alertChannelId: '', mentionRoleId: '', enabled: true, customMessage: '' });
  }

  function startEdit(live: LiveItem) {
    setSelectedPlatform(live.platform);
    setEditingId(live.id);
    setForm({
      url: live.url,
      streamerName: live.streamerName,
      alertChannelId: live.alertChannelId || '',
      mentionRoleId: live.mentionRoleId || '',
      enabled: live.enabled,
      customMessage: live.customMessage || ''
    });
  }

  async function saveLive() {
    setMessage('');
    const payload = { ...form, platform: selectedPlatform };
    try {
      if (editing) {
        await apiFetch(`/lives/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        setMessage('Live atualizada.');
      } else {
        await apiFetch('/lives', { method: 'POST', body: JSON.stringify(payload) });
        setMessage('Live cadastrada.');
      }
      selectPlatform(selectedPlatform);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar live');
    }
  }

  async function deleteLive(id: string) {
    await apiFetch(`/lives/${id}`, { method: 'DELETE' });
    await load();
  }

  async function testLive(id: string) {
    setMessage('');
    try {
      await apiFetch(`/lives/${id}/test`, { method: 'POST' });
      setMessage('Alerta de teste enviado.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao testar alerta');
    }
  }

  async function saveSettings() {
    setMessage('');
    try {
      const data = await apiFetch<{ settings: Settings }>('/lives/settings/general', {
        method: 'PUT',
        body: JSON.stringify({
          ...settings,
          checkIntervalSeconds: Number(settings.checkIntervalSeconds || 120)
        })
      });
      setSettings(data.settings);
      setMessage('Configurações salvas.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar configurações');
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="overflow-hidden rounded-lg border border-white/10 bg-slate-950/70 p-6 shadow-2xl shadow-purple-950/20">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-fuchsia-300">Vortex Live Alerts</p>
              <h1 className="mt-2 text-3xl font-semibold text-white">Lives</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-400">
                Cadastre canais, monitore status e envie alertas automáticos no Discord sem repetir anúncio da mesma live.
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3">
              <Activity className={settings.enabled ? 'text-emerald-300' : 'text-slate-500'} size={20} />
              <div>
                <p className="text-xs text-slate-400">Sistema</p>
                <p className="font-semibold">{settings.enabled ? 'Ativo' : 'Desativado'}</p>
              </div>
            </div>
          </div>
        </header>

        {message ? <div className="rounded-lg border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">{message}</div> : null}

        <section className="grid gap-4 md:grid-cols-4">
          {platforms.map((platform) => (
            <button
              key={platform.id}
              onClick={() => selectPlatform(platform.id)}
              className={`group overflow-hidden rounded-lg border p-4 text-left transition ${
                selectedPlatform === platform.id ? 'border-white/30 bg-white/[0.08]' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
              }`}
            >
              <div className={`flex h-24 items-end rounded-lg bg-gradient-to-br ${platform.gradient} p-4 shadow-lg shadow-black/30`}>
                <span className="text-2xl font-black text-white">{platform.mark}</span>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="font-semibold text-white">{platform.name}</span>
                <Plus size={18} className="text-slate-300 transition group-hover:text-white" />
              </div>
            </button>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[420px_1fr]">
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
            <div className="mb-4 flex items-center gap-2">
              <Radio className="text-fuchsia-300" size={20} />
              <h2 className="text-lg font-semibold">{editing ? 'Editar live' : `Cadastrar ${platforms.find((item) => item.id === selectedPlatform)?.name}`}</h2>
            </div>
            <div className="space-y-3">
              <Input label="URL do canal" value={form.url} onChange={(value) => setForm({ ...form, url: value })} placeholder="https://www.twitch.tv/streamer" />
              <Input label="Nome do streamer" value={form.streamerName} onChange={(value) => setForm({ ...form, streamerName: value })} placeholder="Fulano" />
              <Input label="Canal do Discord" value={form.alertChannelId} onChange={(value) => setForm({ ...form, alertChannelId: value })} placeholder="ID do canal" />
              <Input label="Cargo mencionado" value={form.mentionRoleId} onChange={(value) => setForm({ ...form, mentionRoleId: value })} placeholder="ID do cargo" />
              <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm">
                <span className="text-slate-300">Alerta ativo</span>
                <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} className="h-4 w-4 rounded border-white/20 bg-slate-900 text-fuchsia-500" />
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Mensagem personalizada</span>
                <textarea
                  value={form.customMessage}
                  onChange={(event) => setForm({ ...form, customMessage: event.target.value })}
                  placeholder={defaultMessage}
                  className="mt-1 min-h-28 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition focus:border-fuchsia-300/60"
                />
              </label>
              <button onClick={saveLive} className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-fuchsia-500 via-blue-500 to-red-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-950/30">
                <Save size={16} />
                {editing ? 'Salvar edição' : 'Cadastrar live'}
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Lives cadastradas</h2>
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">{lives.length} registro(s)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Plataforma</th>
                    <th className="px-3 py-2">Streamer</th>
                    <th className="px-3 py-2">URL</th>
                    <th className="px-3 py-2">Canal</th>
                    <th className="px-3 py-2">Cargo</th>
                    <th className="px-3 py-2">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Carregando lives...</td></tr>
                  ) : lives.length ? lives.map((live) => (
                    <tr key={live.id} className="border-t border-white/5">
                      <td className="px-3 py-3"><StatusBadge status={live.status} enabled={live.enabled} /></td>
                      <td className="px-3 py-3 capitalize text-slate-200">{live.platform}</td>
                      <td className="px-3 py-3 font-medium text-white">{live.streamerName}</td>
                      <td className="max-w-[220px] truncate px-3 py-3 text-blue-200">{live.url}</td>
                      <td className="px-3 py-3 text-slate-300">{live.alertChannelId || settings.defaultAlertChannelId || 'Padrão vazio'}</td>
                      <td className="px-3 py-3 text-slate-300">{live.mentionRoleId || settings.defaultMentionRoleId || 'Padrão vazio'}</td>
                      <td className="px-3 py-3">
                        <div className="flex gap-2">
                          <IconButton label="Editar" onClick={() => startEdit(live)}><Edit3 size={15} /></IconButton>
                          <IconButton label="Excluir" onClick={() => deleteLive(live.id)}><Trash2 size={15} /></IconButton>
                          <IconButton label="Testar" onClick={() => testLive(live.id)}><PlayCircle size={15} /></IconButton>
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Nenhuma live cadastrada.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
          <div className="mb-4 flex items-center gap-2">
            <Bell className="text-blue-300" size={20} />
            <h2 className="text-lg font-semibold">Configuração geral</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Canal padrão de alertas" value={settings.defaultAlertChannelId || ''} onChange={(value) => setSettings({ ...settings, defaultAlertChannelId: value })} placeholder="ID do canal" />
            <Input label="Cargo padrão para mencionar" value={settings.defaultMentionRoleId || ''} onChange={(value) => setSettings({ ...settings, defaultMentionRoleId: value })} placeholder="ID do cargo" />
            <Input label="Tempo de verificação das lives" value={String(settings.checkIntervalSeconds)} onChange={(value) => setSettings({ ...settings, checkIntervalSeconds: Number(value) })} placeholder="120" />
            <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm">
              <span className="text-slate-300">Sistema ativo</span>
              <input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} className="h-4 w-4 rounded border-white/20 bg-slate-900 text-blue-500" />
            </label>
            <label className="block md:col-span-2">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Mensagem padrão</span>
              <textarea
                value={settings.defaultMessage || defaultMessage}
                onChange={(event) => setSettings({ ...settings, defaultMessage: event.target.value })}
                className="mt-1 min-h-28 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition focus:border-blue-300/60"
              />
            </label>
          </div>
          <button onClick={saveSettings} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-blue-300/20 bg-blue-500/15 px-4 py-2 text-sm font-semibold text-blue-100 hover:bg-blue-500/25">
            <Save size={16} />
            Salvar configurações
          </button>
        </section>
      </div>
    </AppShell>
  );
}

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-fuchsia-300/60"
      />
    </label>
  );
}

function StatusBadge({ status, enabled }: { status: string; enabled: boolean }) {
  const label = !enabled ? 'Desativada' : status === 'online' ? 'Online' : status === 'offline' ? 'Offline' : 'Desconhecido';
  const color = !enabled ? 'border-slate-500/30 bg-slate-500/10 text-slate-300' : status === 'online' ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border-red-400/30 bg-red-500/10 text-red-200';
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${color}`}>{label}</span>;
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={label} onClick={onClick} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]">
      {children}
    </button>
  );
}
