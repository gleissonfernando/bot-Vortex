'use client';

import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import { Bell, CircleHelp, Edit3, PlayCircle, Plus, Radio, Save, Trash2, Tv } from 'lucide-react';
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
  twitchLogin?: string | null;
  avatarUrl?: string | null;
};

type Settings = {
  enabled: boolean;
  defaultAlertChannelId: string | null;
  defaultMentionRoleId: string | null;
  defaultMessage: string;
  checkIntervalSeconds: number;
};

type DiscordOption = {
  id: string;
  name: string;
  color?: number;
  mentionable?: boolean;
};

const defaultMessage = '🔴 {streamer} está ao vivo!\n\n🎮 Plataforma: {platform}\n📺 Título da live: {title}\n👤 Streamer: {streamer}\n🔗 Assistir agora: {url}';

const platformCards = [
  { id: 'youtube', name: 'YouTube', description: 'Videos publicados e alertas de canal.', action: 'Em breve', mark: 'YT', color: 'bg-red-500' },
  { id: 'twitch', name: 'Twitch', description: 'Alertas ao vivo usando Twitch Helix API.', action: 'Adicionar canal', mark: 'TW', color: 'bg-violet-500' },
  { id: 'kick', name: 'Kick', description: 'Monitoramento de lives por URL publica.', action: 'Adicionar', mark: 'K', color: 'bg-emerald-400' },
  { id: 'custom', name: 'Personalizada', description: 'URLs externas monitoradas pelo sistema.', action: 'Adicionar', mark: 'URL', color: 'bg-sky-400' }
];

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
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [discordOptions, setDiscordOptions] = useState<{ channels: DiscordOption[]; roles: DiscordOption[]; error?: string | null }>({
    channels: [],
    roles: []
  });
  const [form, setForm] = useState({
    url: '',
    streamerName: '',
    alertChannelId: '',
    mentionRoleId: '',
    enabled: true,
    customMessage: ''
  });

  const editing = useMemo(() => lives.find((live) => live.id === editingId) || null, [lives, editingId]);
  const byPlatform = useMemo(() => {
    return platformCards.reduce<Record<string, LiveItem[]>>((acc, platform) => {
      acc[platform.id] = lives.filter((live) => live.platform === platform.id);
      return acc;
    }, {});
  }, [lives]);

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ lives: LiveItem[]; settings: Settings }>('/lives');
      setLives(data.lives);
      setSettings(data.settings);
      const options = await apiFetch<{ channels: DiscordOption[]; roles: DiscordOption[]; error?: string | null }>('/lives/discord-options').catch(() => null);
      if (options) setDiscordOptions({ channels: options.channels || [], roles: options.roles || [], error: options.error });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao carregar lives');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm(platform = selectedPlatform) {
    setSelectedPlatform(platform);
    setEditingId(null);
    setForm({ url: '', streamerName: '', alertChannelId: '', mentionRoleId: '', enabled: true, customMessage: '' });
  }

  function openAdd(platform: string) {
    resetForm(platform);
    setShowForm(true);
  }

  function startEdit(live: LiveItem) {
    setSelectedPlatform(live.platform);
    setEditingId(live.id);
    setShowForm(true);
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
        setMessage('Canal atualizado na Vortex.');
      } else {
        await apiFetch('/lives', { method: 'POST', body: JSON.stringify(payload) });
        setMessage('Canal cadastrado para alertas da Vortex.');
      }
      setShowForm(false);
      resetForm(selectedPlatform);
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
      setMessage('Alerta de teste enviado no Discord.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao testar alerta');
    }
  }

  async function saveSettings() {
    setMessage('');
    try {
      const data = await apiFetch<{ settings: Settings }>('/lives/settings/general', {
        method: 'PUT',
        body: JSON.stringify({ ...settings, checkIntervalSeconds: Number(settings.checkIntervalSeconds || 120) })
      });
      setSettings(data.settings);
      setMessage('Configuracao geral salva.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar configuracoes');
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-col gap-4 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-lg bg-white/[0.06] text-white">
              <Bell size={26} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Vortex Social</p>
              <h1 className="text-3xl font-semibold tracking-tight text-white">Live Notifications</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button title="Ajuda" className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300">
              <CircleHelp size={18} />
            </button>
            <button
              onClick={() => setSettings({ ...settings, enabled: !settings.enabled })}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
                settings.enabled ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-200' : 'border-slate-300/10 bg-white/[0.04] text-slate-300'
              }`}
            >
              {settings.enabled ? 'Sistema ativo' : 'Sistema pausado'}
            </button>
          </div>
        </header>

        {message ? <div className="rounded-lg border border-sky-300/15 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">{message}</div> : null}

        <section className="space-y-3">
          {platformCards.map((platform) => (
            <article key={platform.id} className="rounded-lg border border-white/10 bg-white/[0.045] p-4 shadow-panel backdrop-blur">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className={`grid h-11 w-11 place-items-center rounded-lg ${platform.color} text-sm font-black text-white shadow-lg shadow-black/20`}>
                    {platform.mark}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold text-white">{platform.name}</h2>
                      {platform.id === 'twitch' ? (
                        <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-xs font-semibold text-slate-300">
                          {(byPlatform.twitch || []).length}/5
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-slate-400">{platform.description}</p>
                  </div>
                </div>
                <button
                  onClick={() => openAdd(platform.id)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/[0.08] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.12]"
                >
                  <Plus size={16} />
                  {platform.action}
                </button>
              </div>

              {platform.id === 'twitch' ? (
                <div className="mt-4 space-y-2">
                  {(byPlatform.twitch || []).map((live) => (
                    <LiveChannelRow
                      key={live.id}
                      live={live}
                      settings={settings}
                      onEdit={() => startEdit(live)}
                      onDelete={() => deleteLive(live.id)}
                      onTest={() => testLive(live.id)}
                    />
                  ))}
                  {!loading && !(byPlatform.twitch || []).length ? (
                    <div className="rounded-lg border border-dashed border-white/10 bg-black/10 p-4 text-sm text-slate-500">
                      Nenhum canal da Twitch cadastrado. Clique em adicionar canal para configurar a primeira live.
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </section>

        {showForm ? (
          <section className="rounded-lg border border-white/10 bg-white/[0.045] p-5 shadow-panel backdrop-blur">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Radio className="text-violet-300" size={20} />
                <h2 className="text-lg font-semibold text-white">{editing ? 'Editar canal' : `Adicionar ${selectedPlatform}`}</h2>
              </div>
              <button onClick={() => setShowForm(false)} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/[0.06]">Fechar</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input label="URL ou usuario do canal" value={form.url} onChange={(value) => setForm({ ...form, url: value })} placeholder="https://www.twitch.tv/usuario ou usuario" />
              <Input label="Nome no painel" value={form.streamerName} onChange={(value) => setForm({ ...form, streamerName: value })} placeholder="Preenchido automaticamente na Twitch" />
              <Select
                label="Canal do Discord"
                value={form.alertChannelId}
                onChange={(value) => setForm({ ...form, alertChannelId: value })}
                placeholder={settings.defaultAlertChannelId ? `Padrao: #${channelName(discordOptions.channels, settings.defaultAlertChannelId)}` : 'Usar canal padrao'}
                options={discordOptions.channels.map((channel) => ({ value: channel.id, label: `# ${channel.name}` }))}
              />
              <Select
                label="Cargo mencionado"
                value={form.mentionRoleId}
                onChange={(value) => setForm({ ...form, mentionRoleId: value })}
                placeholder={settings.defaultMentionRoleId ? `Padrao: @${roleName(discordOptions.roles, settings.defaultMentionRoleId)}` : 'Usar cargo padrao'}
                options={discordOptions.roles.map((role) => ({ value: role.id, label: `${role.name.startsWith('@') ? role.name : `@ ${role.name}`}${role.mentionable ? '' : ' (nao mencionavel)'}` }))}
              />
              <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm">
                <span className="text-slate-300">Alerta ativo</span>
                <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} className="h-4 w-4 rounded border-white/20 bg-slate-900 text-violet-500" />
              </label>
              <label className="block md:col-span-2">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Mensagem personalizada</span>
                <textarea
                  value={form.customMessage}
                  onChange={(event) => setForm({ ...form, customMessage: event.target.value })}
                  placeholder={defaultMessage}
                  className="mt-1 min-h-28 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-violet-300/60"
                />
              </label>
            </div>
            <button onClick={saveLive} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-400">
              <Save size={16} />
              {editing ? 'Salvar canal' : 'Adicionar canal'}
            </button>
          </section>
        ) : null}

        <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5 backdrop-blur">
          <div className="mb-4 flex items-center gap-2">
            <Tv className="text-sky-300" size={20} />
            <h2 className="text-lg font-semibold text-white">Padroes da Vortex</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Select
              label="Canal padrao de alertas"
              value={settings.defaultAlertChannelId || ''}
              onChange={(value) => setSettings({ ...settings, defaultAlertChannelId: value })}
              placeholder="Selecione o canal"
              options={discordOptions.channels.map((channel) => ({ value: channel.id, label: `# ${channel.name}` }))}
            />
            <Select
              label="Cargo padrao para mencionar"
              value={settings.defaultMentionRoleId || ''}
              onChange={(value) => setSettings({ ...settings, defaultMentionRoleId: value })}
              placeholder="Selecione o cargo"
              options={discordOptions.roles.map((role) => ({ value: role.id, label: `${role.name.startsWith('@') ? role.name : `@ ${role.name}`}${role.mentionable ? '' : ' (nao mencionavel)'}` }))}
            />
            <Input label="Tempo de verificacao" value={String(settings.checkIntervalSeconds)} onChange={(value) => setSettings({ ...settings, checkIntervalSeconds: Number(value) })} placeholder="120" />
            <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm">
              <span className="text-slate-300">Monitoramento ativo</span>
              <input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} className="h-4 w-4 rounded border-white/20 bg-slate-900 text-sky-500" />
            </label>
            <label className="block md:col-span-2">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Mensagem padrao</span>
              <textarea
                value={settings.defaultMessage || defaultMessage}
                onChange={(event) => setSettings({ ...settings, defaultMessage: event.target.value })}
                className="mt-1 min-h-24 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-300/60"
              />
            </label>
          </div>
          {discordOptions.error ? (
            <p className="mt-3 text-xs text-amber-200">Nao consegui carregar canais/cargos do Discord: {discordOptions.error}</p>
          ) : null}
          <button onClick={saveSettings} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-sky-300/20 bg-sky-400/10 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/15">
            <Save size={16} />
            Salvar padroes
          </button>
        </section>
      </div>
    </AppShell>
  );
}

function channelName(channels: DiscordOption[], id: string) {
  return channels.find((channel) => channel.id === id)?.name || id;
}

function roleName(roles: DiscordOption[], id: string) {
  return roles.find((role) => role.id === id)?.name || id;
}

function LiveChannelRow({ live, settings, onEdit, onDelete, onTest }: {
  live: LiveItem;
  settings: Settings;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
}) {
  const initials = (live.streamerName || live.twitchLogin || 'VX').slice(0, 2).toUpperCase();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-black/15 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-violet-500/15 text-sm font-semibold text-violet-100">
          {live.avatarUrl ? <img src={live.avatarUrl} alt={live.streamerName} className="relative z-10 h-full w-full object-cover" /> : null}
          <span className="absolute inset-0 grid place-items-center">{initials}</span>
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold text-white">@{live.twitchLogin || live.streamerName}</p>
            <StatusBadge status={live.status} enabled={live.enabled} />
          </div>
          <p className="truncate text-sm text-slate-500">{live.url}</p>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
            <span className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5">{live.alertChannelId || settings.defaultAlertChannelId || 'Sem canal'}</span>
            <span className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5">{live.mentionRoleId || settings.defaultMentionRoleId || 'Sem cargo'}</span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <IconButton label="Configurar" onClick={onEdit}><Edit3 size={15} /></IconButton>
        <IconButton label="Testar alerta" onClick={onTest}><PlayCircle size={15} /></IconButton>
        <IconButton label="Excluir" onClick={onDelete}><Trash2 size={15} /></IconButton>
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  placeholder,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition focus:border-violet-300/60"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-violet-300/60"
      />
    </label>
  );
}

function StatusBadge({ status, enabled }: { status: string; enabled: boolean }) {
  const label = !enabled ? 'Pausado' : status === 'online' ? 'Online' : status === 'offline' ? 'Offline' : 'Aguardando';
  const color = !enabled
    ? 'border-slate-500/30 bg-slate-500/10 text-slate-300'
    : status === 'online'
      ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
      : status === 'offline'
        ? 'border-rose-400/30 bg-rose-500/10 text-rose-200'
        : 'border-sky-400/30 bg-sky-500/10 text-sky-200';
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${color}`}>{label}</span>;
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={label} onClick={onClick} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-slate-200 hover:bg-white/[0.1]">
      {children}
    </button>
  );
}
