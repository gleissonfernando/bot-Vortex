'use client';

import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import { Bell, Edit3, PlayCircle, Plus, Radio, Save, Trash2 } from 'lucide-react';
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
  bannerUrl?: string | null;
  lastAlertMessageId?: string | null;
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
const TWITCH_LIVE_LIMIT = 100;

const platformCards = [
  { id: 'twitch', name: 'Twitch', description: 'Cadastro validado pela Twitch Helix API.', action: 'Cadastrar live', color: 'bg-[#9146ff]', enabled: true },
  { id: 'kick', name: 'Kick', description: 'Integração automática ainda não configurada.', action: 'Indisponível', color: 'bg-[#53fc18]', enabled: false },
  { id: 'youtube', name: 'YouTube', description: 'Integração automática ainda não configurada.', action: 'Indisponível', color: 'bg-[#ff0033]', enabled: false }
];

export default function LivesPage() {
  const [lives, setLives] = useState<LiveItem[]>([]);
  const [settings, setSettings] = useState<Settings>({
    enabled: true,
    defaultAlertChannelId: '',
    defaultMentionRoleId: '',
    defaultMessage,
    checkIntervalSeconds: 30
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
    alertChannelId: '',
    mentionRoleId: '',
    enabled: true
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
      setMessage((current) => current === 'Vortex API unavailable' ? '' : current);
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
    setForm({ url: '', alertChannelId: '', mentionRoleId: '', enabled: true });
  }

  function openAdd(platform: string) {
    if (platform !== 'twitch') return;
    if ((byPlatform.twitch || []).length >= TWITCH_LIVE_LIMIT) {
      setMessage(`Limite de ${TWITCH_LIVE_LIMIT} lives Twitch atingido.`);
      return;
    }
    resetForm(platform);
    setShowForm(true);
  }

  function startEdit(live: LiveItem) {
    setSelectedPlatform(live.platform);
    setEditingId(live.id);
    setShowForm(true);
    setForm({
      url: live.url,
      alertChannelId: live.alertChannelId || '',
      mentionRoleId: live.mentionRoleId || '',
      enabled: live.enabled
    });
  }

  async function saveLive() {
    setMessage('');
    const payload = { ...form, platform: 'twitch' };
    try {
      if (editing) {
        await apiFetch(`/lives/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        setMessage('Canal atualizado na Vortex.');
      } else {
        await apiFetch('/lives', { method: 'POST', body: JSON.stringify(payload) });
        setMessage('Canal cadastrado para alertas da Vortex.');
      }
      setShowForm(false);
      resetForm('twitch');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar live');
    }
  }

  async function saveSettings(nextSettings = settings) {
    setMessage('');
    try {
      const data = await apiFetch<{ settings: Settings }>('/lives/settings/general', {
        method: 'PUT',
        body: JSON.stringify(nextSettings)
      });
      setSettings(data.settings);
      setMessage('Configuracao de lives salva.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar configuracao');
    }
  }

  async function toggleSystem() {
    const next = { ...settings, enabled: !settings.enabled };
    setSettings(next);
    await saveSettings(next);
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
            <button
              onClick={toggleSystem}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
                settings.enabled ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-200' : 'border-slate-300/10 bg-white/[0.04] text-slate-300'
              }`}
            >
              {settings.enabled ? 'Sistema ativo' : 'Sistema pausado'}
            </button>
          </div>
        </header>

        {message ? <div className="rounded-lg border border-sky-300/15 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">{message}</div> : null}

        <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4 shadow-panel backdrop-blur">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_160px_auto] md:items-end">
            <Select
              label="Canal padrao"
              value={settings.defaultAlertChannelId || ''}
              onChange={(value) => setSettings({ ...settings, defaultAlertChannelId: value || null })}
              placeholder="Escolha o canal dos alertas"
              options={discordOptions.channels.map((channel) => ({ value: channel.id, label: `# ${channel.name}` }))}
            />
            <Select
              label="Cargo padrao"
              value={settings.defaultMentionRoleId || ''}
              onChange={(value) => setSettings({ ...settings, defaultMentionRoleId: value || null })}
              placeholder="Sem mencao padrao"
              options={discordOptions.roles.map((role) => ({ value: role.id, label: `${role.name.startsWith('@') ? role.name : `@ ${role.name}`}${role.mentionable ? '' : ' (nao mencionavel)'}` }))}
            />
            <Input
              label="Intervalo"
              value={String(settings.checkIntervalSeconds || 30)}
              onChange={(value) => setSettings({ ...settings, checkIntervalSeconds: Math.max(30, Number(value.replace(/\D/g, '') || 30)) })}
              placeholder="30"
            />
            <button onClick={() => saveSettings()} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white/[0.08] px-4 text-sm font-semibold text-white transition hover:bg-white/[0.12]">
              <Save size={16} />
              Salvar
            </button>
          </div>
        </section>

        <section className="space-y-3">
          {platformCards.map((platform) => (
            <article key={platform.id} className="rounded-lg border border-white/10 bg-white/[0.045] p-4 shadow-panel backdrop-blur">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className={`grid h-11 w-11 place-items-center rounded-lg ${platform.color} text-white shadow-lg shadow-black/20`}>
                    <PlatformIcon platform={platform.id} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold text-white">{platform.name}</h2>
                      {platform.id === 'twitch' ? (
                        <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-xs font-semibold text-slate-300">
                          {(byPlatform.twitch || []).length}/{TWITCH_LIVE_LIMIT}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-slate-400">{platform.description}</p>
                  </div>
                </div>
                <button
                  onClick={() => openAdd(platform.id)}
                  disabled={!platform.enabled}
                  className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                    platform.enabled ? 'bg-white/[0.08] text-white hover:bg-white/[0.12]' : 'cursor-not-allowed bg-white/[0.03] text-slate-500'
                  }`}
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
          <section className="rounded-lg border border-violet-300/20 bg-violet-500/[0.06] p-5 shadow-panel backdrop-blur">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Radio className="text-violet-300" size={20} />
                <h2 className="text-lg font-semibold text-white">{editing ? 'Ajustar live Twitch' : 'Nova live Twitch'}</h2>
              </div>
              <button onClick={() => setShowForm(false)} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/[0.06]">Fechar</button>
            </div>
            <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr_auto] lg:items-end">
              <Input label="Canal Twitch" value={form.url} onChange={(value) => setForm({ ...form, url: value })} placeholder="rarofps7 ou https://twitch.tv/rarofps7" />
              {editing ? (
                <>
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
                  <label className="flex h-10 items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 text-sm">
                    <span className="text-slate-300">Ativo</span>
                    <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} className="h-4 w-4 rounded border-white/20 bg-slate-900 text-violet-500" />
                  </label>
                </>
              ) : (
                <div className="text-sm text-slate-400 lg:col-span-2">
                  O nome, avatar e status sao validados automaticamente pela Twitch. Canal e cargo usam os padroes salvos acima.
                </div>
              )}
            </div>
            <button onClick={saveLive} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-400">
              <Save size={16} />
              {editing ? 'Salvar live' : 'Cadastrar live'}
            </button>
          </section>
        ) : null}

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

function PlatformIcon({ platform }: { platform: string }) {
  if (platform === 'youtube') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 fill-current">
        <path d="M21.6 7.2a3 3 0 0 0-2.1-2.1C17.6 4.6 12 4.6 12 4.6s-5.6 0-7.5.5a3 3 0 0 0-2.1 2.1A31.2 31.2 0 0 0 2 12a31.2 31.2 0 0 0 .4 4.8 3 3 0 0 0 2.1 2.1c1.9.5 7.5.5 7.5.5s5.6 0 7.5-.5a3 3 0 0 0 2.1-2.1A31.2 31.2 0 0 0 22 12a31.2 31.2 0 0 0-.4-4.8ZM10 15.5v-7l6 3.5-6 3.5Z" />
      </svg>
    );
  }

  if (platform === 'kick') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 fill-current text-slate-950">
        <path d="M5 4h5v5h2V7h2V4h5v6h-3v2h3v8h-5v-5h-2v2h-2v3H5V4Z" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 fill-current">
      <path d="M5 3h16v11l-5 5h-4l-3 3H7v-3H3V7l2-4Zm2 2-2 2v10h4v3l3-3h4l3-3V5H7Zm4 4h2v5h-2V9Zm5 0h2v5h-2V9Z" />
    </svg>
  );
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
    <div className="overflow-hidden rounded-lg border border-white/10 bg-black/15">
      <div className="relative h-28 bg-slate-950 sm:h-32">
        {live.bannerUrl ? (
          <img src={live.bannerUrl} alt={`Banner de ${live.streamerName}`} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-[radial-gradient(circle_at_20%_20%,rgba(139,92,246,0.28),transparent_32%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(49,46,129,0.55),rgba(2,6,23,0.95))]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
          <div className="flex min-w-0 items-end gap-3">
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full border border-white/20 bg-violet-500/20 text-sm font-semibold text-violet-100 shadow-lg shadow-black/30">
              {live.avatarUrl ? <img src={live.avatarUrl} alt={live.streamerName} className="relative z-10 h-full w-full object-cover" /> : null}
              <span className="absolute inset-0 grid place-items-center">{initials}</span>
            </div>
            <div className="min-w-0 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-semibold text-white">@{live.twitchLogin || live.streamerName}</p>
                <StatusBadge status={live.status} enabled={live.enabled} />
              </div>
              <p className="truncate text-sm text-slate-300">{live.url}</p>
            </div>
          </div>
          <div className="hidden shrink-0 gap-2 sm:flex">
            <IconButton label="Configurar" onClick={onEdit}><Edit3 size={15} /></IconButton>
            <IconButton label="Testar alerta" onClick={onTest}><PlayCircle size={15} /></IconButton>
            <IconButton label="Excluir" onClick={onDelete}><Trash2 size={15} /></IconButton>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2 text-xs text-slate-400">
          <span className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5">{live.alertChannelId || settings.defaultAlertChannelId || 'Sem canal'}</span>
          <span className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5">{live.mentionRoleId || settings.defaultMentionRoleId || 'Sem cargo'}</span>
        </div>
        <div className="flex shrink-0 gap-2 sm:hidden">
          <IconButton label="Configurar" onClick={onEdit}><Edit3 size={15} /></IconButton>
          <IconButton label="Testar alerta" onClick={onTest}><PlayCircle size={15} /></IconButton>
          <IconButton label="Excluir" onClick={onDelete}><Trash2 size={15} /></IconButton>
        </div>
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
