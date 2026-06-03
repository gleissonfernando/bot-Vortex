'use client';

import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import { Bell, CheckCircle2, Edit3, ExternalLink, Plus, Radio, Save, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type LiveItem = {
  id: string;
  platform: PlatformId;
  channelUrl: string;
  streamerName: string;
  discordChannelId: string;
  discordRoleId: string | null;
  customMessage: string | null;
  lastStatus: 'online' | 'offline' | 'unknown';
  lastTitle?: string | null;
  lastGame?: string | null;
  lastViewers?: number | null;
  lastThumbnail?: string | null;
  lastCheckedAt?: string | null;
  lastNotifiedAt?: string | null;
};

type DiscordOption = {
  id: string;
  name: string;
  color?: number;
  mentionable?: boolean;
};

type Stats = {
  totalMonitored: number;
  detectedToday: number;
  lastLiveSent: string | null;
  connectedPlatforms: number;
};

type PlatformId = 'twitch' | 'youtube' | 'tiktok' | 'kick' | 'facebook' | 'trovo';

const defaultMessage = '🔴 {streamer} iniciou uma live!\n\n🎮 Jogo: {game}\n👥 Assistindo: {viewers}\n\nAssista agora:\n{url}';

const platformCards: Array<{ id: PlatformId; name: string; description: string; color: string; accent: string }> = [
  { id: 'twitch', name: 'Twitch', description: 'Monitora lives pela Twitch Helix API.', color: 'bg-[#9146ff]', accent: 'text-violet-200' },
  { id: 'youtube', name: 'YouTube Live', description: 'Monitora canais e transmissões públicas.', color: 'bg-[#ff0033]', accent: 'text-red-200' },
  { id: 'tiktok', name: 'TikTok Live', description: 'Detecta lives públicas por URL de criador.', color: 'bg-[#00f2ea]', accent: 'text-cyan-100' },
  { id: 'kick', name: 'Kick', description: 'Consulta status público do canal Kick.', color: 'bg-[#53fc18]', accent: 'text-lime-200' },
  { id: 'facebook', name: 'Facebook Gaming', description: 'Preparado para páginas públicas de gaming.', color: 'bg-[#1877f2]', accent: 'text-blue-200' },
  { id: 'trovo', name: 'Trovo', description: 'Preparado para canais Trovo Live.', color: 'bg-[#19d66b]', accent: 'text-emerald-200' }
];

const initialForm = {
  platform: 'twitch' as PlatformId,
  discordChannelId: '',
  discordRoleId: '',
  url: '',
  customMessage: defaultMessage
};

export default function LivesPage() {
  const [lives, setLives] = useState<LiveItem[]>([]);
  const [stats, setStats] = useState<Stats>({ totalMonitored: 0, detectedToday: 0, lastLiveSent: null, connectedPlatforms: 0 });
  const [discordOptions, setDiscordOptions] = useState<{ channels: DiscordOption[]; roles: DiscordOption[]; error?: string | null }>({ channels: [], roles: [] });
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const byPlatform = useMemo(() => {
    return platformCards.reduce<Record<string, LiveItem[]>>((acc, platform) => {
      acc[platform.id] = lives.filter((live) => live.platform === platform.id);
      return acc;
    }, {});
  }, [lives]);

  async function load() {
    setLoading(true);
    try {
      const [liveData, options] = await Promise.all([
        apiFetch<{ lives: LiveItem[]; stats: Stats }>('/lives'),
        apiFetch<{ channels: DiscordOption[]; roles: DiscordOption[]; error?: string | null }>('/lives/discord-options').catch(() => null)
      ]);
      setLives(liveData.lives || []);
      setStats(liveData.stats || stats);
      if (options) setDiscordOptions({ channels: options.channels || [], roles: options.roles || [], error: options.error });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao carregar notificacoes de live');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openAdd(platform: PlatformId) {
    setEditingId(null);
    setForm({ ...initialForm, platform, customMessage: defaultMessage });
    setModalOpen(true);
  }

  function openEdit(live: LiveItem) {
    setEditingId(live.id);
    setForm({
      platform: live.platform,
      discordChannelId: live.discordChannelId || '',
      discordRoleId: live.discordRoleId || '',
      url: live.channelUrl,
      customMessage: live.customMessage || defaultMessage
    });
    setModalOpen(true);
  }

  async function saveLive() {
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        platform: form.platform,
        url: form.url,
        discordChannelId: form.discordChannelId,
        discordRoleId: form.discordRoleId || null,
        customMessage: form.customMessage || null
      };
      if (editingId) {
        await apiFetch(`/lives/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        setMessage('✅ Canal atualizado com sucesso.');
      } else {
        const data = await apiFetch<{ live: LiveItem }>('/lives', { method: 'POST', body: JSON.stringify(payload) });
        setMessage(`✅ Canal cadastrado com sucesso.\n\nStreamer: ${data.live.streamerName}\nPlataforma: ${platformName(data.live.platform)}\nCanal Discord: #${channelName(data.live.discordChannelId)}`);
      }
      setModalOpen(false);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar canal');
    } finally {
      setSaving(false);
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
      setMessage('✅ Notificacao de teste enviada no Discord.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao testar notificacao');
    }
  }

  function channelName(id?: string | null) {
    return discordOptions.channels.find((channel) => channel.id === id)?.name || id || 'nao configurado';
  }

  function roleName(id?: string | null) {
    return discordOptions.roles.find((role) => role.id === id)?.name || (id ? id : '@everyone');
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-lg border border-sky-300/20 bg-sky-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-100">
              <Bell size={14} />
              Social Notifications
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Notificacoes de Lives</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Conecte canais de streaming e envie alertas automaticos no Discord quando uma transmissao iniciar.
            </p>
          </div>
          <button onClick={load} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.1]">
            <Radio size={16} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </header>

        {message ? <pre className="whitespace-pre-wrap rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm leading-6 text-emerald-100">{message}</pre> : null}
        {discordOptions.error ? <div className="rounded-lg border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">{discordOptions.error}</div> : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Canais monitorados" value={stats.totalMonitored} />
          <StatCard label="Lives hoje" value={stats.detectedToday} />
          <StatCard label="Ultima live" value={stats.lastLiveSent ? formatDate(stats.lastLiveSent) : 'Nenhuma'} />
          <StatCard label="Plataformas" value={stats.connectedPlatforms} />
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          {platformCards.map((platform) => (
            <article key={platform.id} className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.045] shadow-panel backdrop-blur">
              <div className="flex flex-col gap-4 border-b border-white/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-lg ${platform.color} text-white shadow-lg shadow-black/20`}>
                    <PlatformIcon platform={platform.id} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-white">{platform.name}</h2>
                      <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-xs font-semibold text-slate-300">
                        {(byPlatform[platform.id] || []).length} canal(is)
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-400">{platform.description}</p>
                  </div>
                </div>
                <button onClick={() => openAdd(platform.id)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/[0.08] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.12]">
                  <Plus size={16} />
                  Adicionar Canal
                </button>
              </div>

              <div className="space-y-2 p-4">
                {(byPlatform[platform.id] || []).map((live) => (
                  <LiveRow
                    key={live.id}
                    live={live}
                    platform={platform}
                    channelName={channelName}
                    roleName={roleName}
                    onEdit={() => openEdit(live)}
                    onDelete={() => deleteLive(live.id)}
                    onTest={() => testLive(live.id)}
                  />
                ))}
                {!loading && !(byPlatform[platform.id] || []).length ? (
                  <div className="rounded-lg border border-dashed border-white/10 bg-black/10 p-4 text-sm text-slate-500">
                    Nenhum canal cadastrado para {platform.name}.
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </section>

        {modalOpen ? (
          <LiveModal
            form={form}
            editing={Boolean(editingId)}
            saving={saving}
            channels={discordOptions.channels}
            roles={discordOptions.roles}
            onChange={setForm}
            onClose={() => setModalOpen(false)}
            onSave={saveLive}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

function LiveModal({
  form,
  editing,
  saving,
  channels,
  roles,
  onChange,
  onClose,
  onSave
}: {
  form: typeof initialForm;
  editing: boolean;
  saving: boolean;
  channels: DiscordOption[];
  roles: DiscordOption[];
  onChange: (value: typeof initialForm) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
      <section className="w-full max-w-2xl overflow-hidden rounded-lg border border-white/10 bg-vortex-surface shadow-2xl shadow-black/40">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Social Notifications</p>
            <h2 className="text-xl font-semibold text-white">{editing ? 'Editar canal' : 'Adicionar Canal'}</h2>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]">
            <X size={17} />
          </button>
        </header>

        <div className="grid gap-4 p-5">
          <Select
            label="Plataforma"
            value={form.platform}
            onChange={(value) => onChange({ ...form, platform: value as PlatformId })}
            options={platformCards.map((platform) => ({ value: platform.id, label: platform.name }))}
          />
          <Select
            label="Canal do Discord"
            value={form.discordChannelId}
            onChange={(value) => onChange({ ...form, discordChannelId: value })}
            placeholder="Selecione onde enviar a notificacao"
            options={channels.map((channel) => ({ value: channel.id, label: `#${channel.name}` }))}
          />
          <Select
            label="Cargo para mencionar"
            value={form.discordRoleId}
            onChange={(value) => onChange({ ...form, discordRoleId: value })}
            placeholder="@everyone"
            options={roles.map((role) => ({ value: role.id, label: role.name.startsWith('@') ? role.name : `@${role.name}` }))}
          />
          <Input
            label="URL do Canal"
            value={form.url}
            onChange={(value) => onChange({ ...form, url: value })}
            placeholder={placeholderFor(form.platform)}
          />
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Mensagem personalizada</span>
            <textarea
              value={form.customMessage}
              onChange={(event) => onChange({ ...form, customMessage: event.target.value })}
              className="mt-1 h-40 w-full resize-none rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm leading-6 text-white outline-none transition placeholder:text-slate-600 focus:border-sky-300/60"
              placeholder={defaultMessage}
            />
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Variaveis: {'{streamer}'}, {'{title}'}, {'{game}'}, {'{viewers}'}, {'{url}'}, {'{thumbnail}'}, {'{platform}'}
            </p>
          </label>
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-white/10 px-5 py-4 sm:flex-row sm:justify-end">
          <button onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/[0.06]">Cancelar</button>
          <button onClick={onSave} disabled={saving || !form.discordChannelId || !form.url} className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
            <Save size={16} />
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function LiveRow({
  live,
  platform,
  channelName,
  roleName,
  onEdit,
  onDelete,
  onTest
}: {
  live: LiveItem;
  platform: { id: PlatformId; name: string; accent: string };
  channelName: (id?: string | null) => string;
  roleName: (id?: string | null) => string;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/15 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold text-white">{live.streamerName}</h3>
            <StatusBadge status={live.lastStatus} />
          </div>
          <a href={live.channelUrl} target="_blank" rel="noreferrer" className={`mt-1 inline-flex max-w-full items-center gap-1 truncate text-sm ${platform.accent}`}>
            {live.channelUrl}
            <ExternalLink size={13} />
          </a>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
            <span className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5">#{channelName(live.discordChannelId)}</span>
            <span className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5">{roleName(live.discordRoleId)}</span>
            <span className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5">Checado: {formatDate(live.lastCheckedAt)}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <IconButton label="Editar" onClick={onEdit}><Edit3 size={15} /></IconButton>
          <IconButton label="Testar" onClick={onTest}><CheckCircle2 size={15} /></IconButton>
          <IconButton label="Remover" onClick={onDelete}><Trash2 size={15} /></IconButton>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.045] p-4 shadow-panel backdrop-blur">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <strong className="mt-2 block truncate text-2xl font-semibold text-white">{value}</strong>
    </article>
  );
}

function Select({ label, value, onChange, options, placeholder = 'Selecione' }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-300/60">
        <option value="">{placeholder}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-sky-300/60" />
    </label>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button title={label} onClick={onClick} className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.05] text-slate-200 hover:bg-white/[0.1]">{children}</button>;
}

function StatusBadge({ status }: { status: string }) {
  const classes = status === 'online'
    ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100'
    : status === 'offline'
      ? 'border-slate-300/15 bg-slate-400/10 text-slate-300'
      : 'border-sky-300/25 bg-sky-400/10 text-sky-100';
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${classes}`}>{status === 'online' ? 'Ao vivo' : status === 'offline' ? 'Offline' : 'Aguardando'}</span>;
}

function PlatformIcon({ platform }: { platform: PlatformId }) {
  const common = 'h-7 w-7';

  if (platform === 'youtube') {
    return (
      <svg className={common} viewBox="0 0 28 20" aria-hidden="true">
        <path fill="currentColor" d="M27.4 3.1a3.5 3.5 0 0 0-2.5-2.5C22.7 0 14 0 14 0S5.3 0 3.1.6A3.5 3.5 0 0 0 .6 3.1C0 5.3 0 10 0 10s0 4.7.6 6.9a3.5 3.5 0 0 0 2.5 2.5c2.2.6 10.9.6 10.9.6s8.7 0 10.9-.6a3.5 3.5 0 0 0 2.5-2.5c.6-2.2.6-6.9.6-6.9s0-4.7-.6-6.9Z" />
        <path fill="#fff" d="M11.2 14.3V5.7L18.5 10l-7.3 4.3Z" />
      </svg>
    );
  }

  if (platform === 'tiktok') {
    return (
      <svg className={common} viewBox="0 0 32 32" aria-hidden="true">
        <path fill="#25F4EE" d="M20 4h4.1c.3 2.4 1.7 4.3 4.2 5.2v4.2a10.4 10.4 0 0 1-4.4-1.1v8.1c0 4.8-3.4 8-8.2 8-4.1 0-7.4-2.7-7.4-6.8 0-4.5 3.7-7.2 8.5-6.5v4.3c-2.2-.7-4.1.2-4.1 2.1 0 1.6 1.3 2.6 3 2.6 2 0 3.2-1.1 3.2-3.7V4h1Z" />
        <path fill="#FE2C55" d="M22.1 4h4.1c.3 2.4 1.7 4.3 4.2 5.2v4.2a10.4 10.4 0 0 1-4.4-1.1v8.1c0 4.8-3.4 8-8.2 8-4.1 0-7.4-2.7-7.4-6.8 0-4.5 3.7-7.2 8.5-6.5v4.3c-2.2-.7-4.1.2-4.1 2.1 0 1.6 1.3 2.6 3 2.6 2 0 3.2-1.1 3.2-3.7V4h1Z" />
        <path fill="#fff" d="M21 4h4.1c.3 2.4 1.7 4.3 4.2 5.2v3.3a10.7 10.7 0 0 1-4.4-1.2v8.2c0 4.8-3.4 8-8.2 8-4.1 0-7.4-2.7-7.4-6.8 0-4.5 3.7-7.2 8.5-6.5v3.4c-2.2-.7-4.1.2-4.1 2.1 0 1.6 1.3 2.6 3 2.6 2 0 3.2-1.1 3.2-3.7V4h1Z" />
      </svg>
    );
  }

  if (platform === 'kick') {
    return (
      <svg className="h-7 w-7 text-slate-950" viewBox="0 0 32 32" aria-hidden="true">
        <path fill="currentColor" d="M6 4h7v6h3V7h3V4h7v8h-3v4h3v12h-7v-6h-3v3h-3v3H6V4Z" />
      </svg>
    );
  }

  if (platform === 'facebook') {
    return (
      <svg className="h-8 w-8" viewBox="0 0 32 32" aria-hidden="true">
        <path fill="currentColor" d="M20.7 17.8h3.7l.6-4.3h-4.3v-2.8c0-1.2.3-2 2.1-2H25V4.8c-.4-.1-1.8-.2-3.5-.2-3.5 0-5.9 2.1-5.9 6.1v3.4h-4v4.3h4V29h4.7V17.8Z" />
      </svg>
    );
  }

  if (platform === 'trovo') {
    return (
      <svg className={common} viewBox="0 0 32 32" aria-hidden="true">
        <path fill="currentColor" d="M5 5h22v15.4L20.4 27h-6.8L7 20.4V5Z" />
        <path fill="#19d66b" d="M9.3 9h13.4v8.6l-4.2 4.2h-5L9.3 17.6V9Z" />
        <path fill="#fff" d="M12 12.2h3.1v3.1H12v-3.1Zm5.9 0H21v3.1h-3.1v-3.1Zm-4.1 6.1h8.1l-2.4 2.4h-5.7v-2.4Z" />
      </svg>
    );
  }

  return (
    <svg className={common} viewBox="0 0 32 32" aria-hidden="true">
      <path fill="currentColor" d="M7 5h20v14L20 26h-5l-4 4v-4H7V5Zm4 4v12h4v4l4-4h5V9H11Zm9 4h2v5h-2v-5Zm-6 0h2v5h-2v-5Z" />
    </svg>
  );
}

function platformName(platform: string) {
  return platformCards.find((item) => item.id === platform)?.name || platform;
}

function placeholderFor(platform: PlatformId) {
  const samples: Record<PlatformId, string> = {
    twitch: 'https://www.twitch.tv/usuario',
    kick: 'https://kick.com/usuario',
    youtube: 'https://youtube.com/@usuario',
    tiktok: 'https://www.tiktok.com/@usuario',
    facebook: 'https://facebook.com/gaming/usuario',
    trovo: 'https://trovo.live/s/usuario'
  };
  return samples[platform];
}

function formatDate(value?: string | null) {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Nunca';
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
