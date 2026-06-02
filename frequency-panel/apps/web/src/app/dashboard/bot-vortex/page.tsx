'use client';

import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Command,
  CreditCard,
  Database,
  Eye,
  FileText,
  Gauge,
  Loader2,
  Lock,
  MessageSquare,
  PackageOpen,
  Palette,
  Radio,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Timer,
  ToggleLeft,
  Users,
  Wifi,
  Wrench,
  type LucideIcon
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

type Tool = { id: string; label: string; description: string };
type Option = { id: string; name: string; type?: number };
type BotConfig = Record<string, any>;
type SaveStatus = 'idle' | 'saving' | 'error';
type DashboardMetrics = {
  metrics: {
    total_members: number;
    active_members: number;
    open_points: number;
    month_seconds: number;
  };
};

type CommandOption = {
  key: string;
  label: string;
  description: string;
};

const commandOptions: CommandOption[] = [
  { key: 'painel', label: '/painel', description: 'Quem pode usar o painel de controle.' },
  { key: 'avisos', label: '/avisos', description: 'Quem pode abrir e enviar avisos.' },
  { key: 'clear', label: '/clear', description: 'Quem pode limpar mensagens no chat.' },
  { key: 'clipe', label: '/clipe', description: 'Quem pode enviar clipes.' },
  { key: 'set', label: '/set', description: 'Quem pode usar o sistema de set.' },
  { key: 'serve', label: '/serve', description: 'Quem pode consultar ou usar serve.' },
  { key: 'registro', label: '/registro', description: 'Quem pode consultar registros.' },
  { key: 'ausencia', label: '/ausencia', description: 'Quem pode usar ausencia.' },
  { key: 'perfil', label: '/perfil', description: 'Quem pode consultar e atualizar perfil.' },
  { key: 'cadastro', label: '/cadastro', description: 'Quem pode ligar cadastro por mensagens.' },
  { key: 'ativarponto', label: '/ativarponto', description: 'Quem pode publicar o painel de ponto.' },
  { key: 'bau', label: '/bau membro', description: 'Quem pode publicar e cadastrar produtos no bau.' },
  { key: 'bau-membros', label: '/bau-membros', description: 'Quem pode gerenciar bau de membros.' }
];

const visualTargets = [
  { id: 'global', name: 'Todos os paineis' },
  { id: 'painel', name: '/painel' },
  { id: 'set', name: '/set' },
  { id: 'avisos', name: '/avisos' },
  { id: 'mirrorMessages', name: 'Mensagens em painel' },
  { id: 'ausencia', name: '/ausencia' },
  { id: 'ponto', name: 'Painel de ponto' },
  { id: 'pontoStatus', name: 'Status do ponto' },
  { id: 'exibir', name: '/exibir' },
  { id: 'facHierarchy', name: 'Hierarquia FAC' },
  { id: 'bau', name: 'Bau' }
];

const hierarchyRoles = [
  { key: 'leader', label: 'Lider' },
  { key: 'second', label: 'Segundo' },
  { key: 'generalManager', label: 'Gerente geral' },
  { key: 'manager', label: 'Gerente' },
  { key: 'actionManager', label: 'Gerente de acao' },
  { key: 'soldier', label: 'Soldado' },
  { key: 'member', label: 'Membro' }
];

const ratioOptions = [
  { id: '16:9', name: '16:9' },
  { id: '4:3', name: '4:3' },
  { id: '1:1', name: '1:1' },
  { id: '21:9', name: '21:9' }
];

const toolMeta: Record<string, { icon: LucideIcon; keys: string[] }> = {
  stats: { icon: Gauge, keys: ['MAINTENANCE_MODE', 'PANEL_PRIVATE_MODE', 'POINT_MONITOR_ENABLED', 'POINT_OFFLINE_CHARGE_ENABLED'] },
  roles: { icon: Shield, keys: ['VORTEX_ROLE_LEVELS', 'VORTEX_AUTO_ROLES'] },
  points: { icon: Radio, keys: ['POINT_'] },
  absence: { icon: Clock3, keys: ['ABSENCE_'] },
  commands: { icon: Lock, keys: ['COMMAND_ROLE_PERMISSIONS', 'COMMAND_DISABLED_COMMANDS'] },
  profile: { icon: Users, keys: ['PROFILE_'] },
  billing: { icon: CreditCard, keys: ['PROFILE_BILLING_ENABLED', 'POINT_OFFLINE_CHARGE_ENABLED', 'POINT_OFFLINE_THRESHOLD_HOURS'] },
  messages: { icon: MessageSquare, keys: ['MIRROR_MESSAGE_CHANNEL_IDS', 'DISABLE_NOTICE_DMS', 'NOTICE_MENTION_ROLE_ID'] },
  adjust: { icon: Wrench, keys: ['ADJUST_CALL_CHANNEL_IDS', 'POINT_ADJUST_'] },
  bau: { icon: PackageOpen, keys: ['COMMAND_ROLE_PERMISSIONS'] },
  visual: { icon: Palette, keys: ['PANEL_VISUALS', 'PANEL_THEME'] },
  hierarchy: { icon: Eye, keys: ['FACTION_HIERARCHY'] },
  maintenance: { icon: ToggleLeft, keys: ['MAINTENANCE_MODE', 'PANEL_PRIVATE_MODE', 'DISABLE_', 'LOG_CHANNEL', 'DISABLED_LOG_CHANNEL_IDS'] }
};

const keyLabels: Record<string, string> = {
  MAINTENANCE_MODE: 'manutencao',
  PANEL_PRIVATE_MODE: 'painel privado',
  POINT_MONITOR_ENABLED: 'monitor de ponto',
  POINT_OFFLINE_CHARGE_ENABLED: 'cobranca offline',
  COMMAND_ROLE_PERMISSIONS: 'permissoes',
  COMMAND_DISABLED_COMMANDS: 'comandos desativados',
  VORTEX_ROLE_LEVELS: 'cargos vortex',
  VORTEX_AUTO_ROLES: 'cargos automaticos',
  PANEL_VISUALS: 'visual',
  FACTION_HIERARCHY: 'hierarquia',
  MIRROR_MESSAGE_CHANNEL_IDS: 'mensagens em painel'
};

export default function BotVortexPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [selected, setSelected] = useState('stats');
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [originalConfig, setOriginalConfig] = useState<BotConfig | null>(null);
  const [channels, setChannels] = useState<Option[]>([]);
  const [roles, setRoles] = useState<Option[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingKeys, setSavingKeys] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [query, setQuery] = useState('');
  const [visualTarget, setVisualTarget] = useState('global');
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [bootedAt] = useState(() => new Date());
  const [now, setNow] = useState(() => new Date());
  const [commandQuery, setCommandQuery] = useState('');
  const [commandFilter, setCommandFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const [toast, setToast] = useState('');

  const configRef = useRef<BotConfig | null>(null);
  const pendingPatchRef = useRef<BotConfig>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    load();
    loadMetrics();
    const clock = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      clearInterval(clock);
    };
  }, []);

  const textChannels = useMemo(() => channels.filter((channel) => channel.type === 0 || channel.type === 5), [channels]);
  const voiceChannels = useMemo(() => channels.filter((channel) => channel.type === 2), [channels]);
  const categories = useMemo(() => channels.filter((channel) => channel.type === 4), [channels]);
  const logChannels = useMemo(() => channels.filter((channel) => [0, 2, 5].includes(Number(channel.type))), [channels]);
  const filteredTools = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return tools;
    return tools.filter((tool) => `${tool.label} ${tool.description}`.toLowerCase().includes(normalized));
  }, [query, tools]);
  const selectedTool = tools.find((tool) => tool.id === selected);
  const dirtyKeys = useMemo(() => {
    if (!config || !originalConfig) return [];
    return Object.keys(config).filter((key) => JSON.stringify(config[key]) !== JSON.stringify(originalConfig[key]));
  }, [config, originalConfig]);
  const hasChanges = dirtyKeys.length > 0;
  const visuals = useMemo(() => getPanelVisuals(config), [config]);
  const selectedTheme = visualTarget === 'global'
    ? visuals.defaults
    : { ...visuals.defaults, ...(visuals.targets?.[visualTarget] || {}) };
  const commandCount = commandOptions.length;
  const uptimeLabel = useMemo(() => formatUptime(now.getTime() - bootedAt.getTime()), [now, bootedAt]);
  const summaryCards = useMemo(() => ([
    {
      label: 'Status do Bot',
      value: config?.MAINTENANCE_MODE ? 'Manutencao' : 'Operacional',
      detail: config?.MAINTENANCE_MODE ? 'Operacao pausada' : 'Respondendo ao painel',
      icon: Bot,
      active: !config?.MAINTENANCE_MODE
    },
    {
      label: 'Ultima sincronizacao',
      value: lastSavedAt ? lastSavedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Aguardando',
      detail: saveStateLabel(saveStatus, hasChanges, lastSavedAt),
      icon: Database,
      active: saveStatus !== 'error'
    },
    {
      label: 'Tempo online',
      value: uptimeLabel,
      detail: 'Sessao atual do painel',
      icon: Timer,
      active: true
    },
    {
      label: 'Membros gerenciados',
      value: String(metrics?.metrics.total_members ?? 0),
      detail: `${metrics?.metrics.active_members ?? 0} na cidade agora`,
      icon: Users,
      active: Number(metrics?.metrics.total_members || 0) > 0
    },
    {
      label: 'Comandos ativos',
      value: String(commandCount),
      detail: 'Permissoes no Bot Vortex',
      icon: Command,
      active: commandCount > 0
    }
  ]), [config, lastSavedAt, saveStatus, hasChanges, uptimeLabel, metrics, commandCount]);
  const disabledCommands = useMemo(() => (
    new Set((Array.isArray(config?.COMMAND_DISABLED_COMMANDS) ? config?.COMMAND_DISABLED_COMMANDS : []).map(String))
  ), [config]);
  const filteredCommandOptions = useMemo(() => {
    const normalized = commandQuery.trim().toLowerCase();
    return commandOptions.filter((command) => {
      const disabled = disabledCommands.has(command.key);
      if (commandFilter === 'active' && disabled) return false;
      if (commandFilter === 'disabled' && !disabled) return false;
      if (!normalized) return true;
      return `${command.label} ${command.description}`.toLowerCase().includes(normalized);
    });
  }, [commandQuery, commandFilter, disabledCommands]);
  const commandStats = useMemo(() => {
    const disabled = commandOptions.filter((command) => disabledCommands.has(command.key)).length;
    const permissions = commandOptions.reduce((total, command) => (
      total + (Array.isArray(config?.COMMAND_ROLE_PERMISSIONS?.[command.key]) ? config.COMMAND_ROLE_PERMISSIONS[command.key].length : 0)
    ), 0);
    return {
      total: commandOptions.length,
      active: commandOptions.length - disabled,
      disabled,
      permissions
    };
  }, [config, disabledCommands]);

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      const data = await apiFetch<{ tools: Tool[]; config: BotConfig; options: { channels: Option[]; roles: Option[]; error?: string | null } }>('/bot-vortex');
      setTools(data.tools);
      setConfig(data.config);
      setOriginalConfig(data.config);
      configRef.current = data.config;
      setChannels(data.options.channels || []);
      setRoles(data.options.roles || []);
      setLastSavedAt(new Date());
      setSaveStatus('idle');
      if (data.options.error) setMessage(data.options.error);
    } catch (error) {
      setSaveStatus('error');
      setMessage(error instanceof Error ? error.message : 'Falha ao carregar Bot Vortex');
    } finally {
      setLoading(false);
    }
  }

  async function loadMetrics() {
    try {
      const response = await apiFetch<DashboardMetrics>('/dashboard/metrics');
      setMetrics(response);
    } catch {
      setMetrics(null);
    }
  }

  function applyPatch(patch: BotConfig) {
    setConfig((current) => {
      const next = { ...(current || {}), ...patch };
      configRef.current = next;
      return next;
    });
    queueSave(patch);
  }

  function update(key: string, value: any) {
    applyPatch({ [key]: value });
  }

  function updateNested(key: string, nestedKey: string, value: any) {
    const current = configRef.current || {};
    applyPatch({ [key]: { ...((current[key] || {}) as Record<string, any>), [nestedKey]: value } });
  }

  function updateCommand(command: string, value: string[]) {
    const current = configRef.current || {};
    applyPatch({
      COMMAND_ROLE_PERMISSIONS: {
        ...((current.COMMAND_ROLE_PERMISSIONS || {}) as Record<string, string[]>),
        [command]: value
      }
    });
    showToast('Permissao salva com sucesso');
  }

  function updateCommandDisabled(command: string, disabled: boolean) {
    const current = configRef.current || {};
    const list = new Set((Array.isArray(current.COMMAND_DISABLED_COMMANDS) ? current.COMMAND_DISABLED_COMMANDS : []).map(String));
    if (disabled) list.add(command);
    else list.delete(command);
    applyPatch({ COMMAND_DISABLED_COMMANDS: Array.from(list) });
    showToast('Permissao salva com sucesso');
  }

  function showToast(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(''), 2200);
  }

  function updateVisualDefault(key: string, value: string) {
    const current = getPanelVisuals(configRef.current);
    applyPatch({
      PANEL_VISUALS: {
        ...current,
        defaults: { ...current.defaults, [key]: value }
      }
    });
  }

  function updateVisualTarget(targetKey: string, key: string, value: string) {
    if (targetKey === 'global') {
      updateVisualDefault(key, value);
      return;
    }

    const current = getPanelVisuals(configRef.current);
    applyPatch({
      PANEL_VISUALS: {
        ...current,
        targets: {
          ...current.targets,
          [targetKey]: {
            ...(current.targets?.[targetKey] || {}),
            [key]: value
          }
        }
      }
    });
  }

  function updateHierarchy(key: string, value: any) {
    const current = configRef.current?.FACTION_HIERARCHY || {};
    applyPatch({ FACTION_HIERARCHY: { ...current, [key]: value } });
  }

  function updateHierarchyRole(roleKey: string, value: string[]) {
    const current = configRef.current?.FACTION_HIERARCHY || {};
    applyPatch({
      FACTION_HIERARCHY: {
        ...current,
        roles: {
          ...(current.roles || {}),
          [roleKey]: value
        }
      }
    });
  }

  function queueSave(patch: BotConfig) {
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void flushPending();
    }, 500);
  }

  async function flushPending() {
    if (savingRef.current) return;
    const patch = pendingPatchRef.current;
    if (!Object.keys(patch).length) return;
    pendingPatchRef.current = {};
    await persistPatch(patch);
  }

  async function saveNow() {
    if (!config || !originalConfig) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const patch = dirtyKeys.length
      ? Object.fromEntries(dirtyKeys.map((key) => [key, config[key]]))
      : pendingPatchRef.current;
    pendingPatchRef.current = {};
    await persistPatch(patch);
  }

  async function persistPatch(patch: BotConfig) {
    const keys = Object.keys(patch);
    if (!keys.length) return;

    savingRef.current = true;
    setSaving(true);
    setSavingKeys(keys);
    setSaveStatus('saving');
    setMessage('');
    try {
      const data = await apiFetch<{ config: BotConfig; applied: string[]; maintenance?: unknown }>('/bot-vortex/config', {
        method: 'PUT',
        body: JSON.stringify({ patch })
      });
      const hasQueuedChanges = Object.keys(pendingPatchRef.current).length > 0;
      if (hasQueuedChanges) {
        setOriginalConfig((current) => ({ ...(current || data.config || {}), ...patch }));
      } else {
        setConfig(data.config);
        setOriginalConfig(data.config);
        configRef.current = data.config;
      }
      setLastSavedAt(new Date());
      setSaveStatus('idle');
      if (data.applied.includes('MAINTENANCE_MODE')) {
        window.dispatchEvent(new Event('vortex-maintenance-updated'));
      }
      setMessage(`Sincronizado em tempo real: ${formatKeys(keys)}`);
    } catch (error) {
      setSaveStatus('error');
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar no bot');
    } finally {
      savingRef.current = false;
      setSaving(false);
      setSavingKeys([]);
      if (Object.keys(pendingPatchRef.current).length) {
        saveTimerRef.current = setTimeout(() => {
          void flushPending();
        }, 150);
      }
    }
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <section className="group overflow-hidden rounded-2xl border border-sky-300/15 bg-slate-950/70 shadow-2xl shadow-sky-950/30 backdrop-blur-xl transition duration-300 hover:border-sky-300/25 hover:shadow-sky-500/10">
          <div className="relative overflow-hidden border-b border-white/10 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--vx-primary)_18%,transparent),color-mix(in_srgb,var(--vx-surface)_96%,var(--vx-bg))_42%,var(--vx-bg)_100%)] p-6 sm:p-7">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/80 to-transparent" />
            <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-sky-400/10 blur-3xl transition duration-500 group-hover:bg-sky-400/15" />
            <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-300/25 bg-sky-400/10 px-3 py-1 text-xs font-semibold text-sky-100 shadow-lg shadow-sky-950/30">
                  <Sparkles size={14} />
                  Controle em tempo real
                </div>
                <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">Bot Vortex</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                  Configure os mesmos modulos do /painel do Discord. Cada alteracao salva automaticamente no arquivo que o bot usa.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={load}
                  disabled={loading || saving}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-slate-100 shadow-lg shadow-black/15 transition duration-200 hover:border-sky-300/25 hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                  Recarregar
                </button>
                <button
                  onClick={saveNow}
                  disabled={!config || (!hasChanges && !Object.keys(pendingPatchRef.current).length) || saving}
                  className="inline-flex items-center gap-2 rounded-xl border border-sky-300/30 bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition duration-200 hover:bg-sky-400 hover:shadow-sky-400/30 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none"
                >
                  <Save size={16} />
                  {saving ? 'Sincronizando...' : hasChanges ? 'Salvar agora' : 'Sincronizado'}
                </button>
              </div>
            </div>

            <div className="relative mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatusTile label="Bot Online" value={config?.MAINTENANCE_MODE ? 'Manutencao' : 'Online'} description={config?.MAINTENANCE_MODE ? 'Modo seguro ativo' : 'Sistema responsivo'} icon={Bot} ok={!config?.MAINTENANCE_MODE} />
              <StatusTile label="Discord" value={channels.length ? `${channels.length}` : '0'} description="Canais sincronizados" icon={Wifi} ok={channels.length > 0} />
              <StatusTile label="Cargos" value={roles.length ? `${roles.length}` : '0'} description="Cargos disponiveis" icon={Shield} ok={roles.length > 0} />
              <StatusTile label="Autosave" value={saveStateLabel(saveStatus, hasChanges, lastSavedAt)} description={hasChanges ? 'Alteracoes pendentes' : 'Configuracao salva'} icon={Database} ok={saveStatus !== 'error' && !hasChanges} busy={saveStatus === 'saving'} />
            </div>
          </div>

          {(message || hasChanges || saving) ? (
            <div className={`border-b px-5 py-3 text-sm ${saveStatus === 'error' ? 'border-rose-300/15 bg-rose-400/10 text-rose-100' : hasChanges || saving ? 'border-amber-300/15 bg-amber-400/10 text-amber-100' : 'border-emerald-300/15 bg-emerald-400/10 text-emerald-100'}`}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  {saveStatus === 'saving' ? <Loader2 size={16} className="animate-spin" /> : saveStatus === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                  <span>{message || (saving ? `Aplicando ${formatKeys(savingKeys)}...` : `${dirtyKeys.length} alteracao${dirtyKeys.length === 1 ? '' : 'es'} aguardando autosave`)}</span>
                </div>
                {hasChanges ? (
                  <button onClick={() => originalConfig && setConfig(originalConfig)} className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/10">
                    Desfazer pendentes
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        <section className="grid gap-5 xl:grid-cols-[320px_1fr]">
          <aside className="space-y-3">
            <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-400">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar modulo"
                className="min-w-0 flex-1 bg-transparent text-slate-200 outline-none placeholder:text-slate-600"
              />
            </label>

            <div className="space-y-2">
              {filteredTools.map((tool) => (
                <ToolButton
                  key={tool.id}
                  tool={tool}
                  active={selected === tool.id}
                  changed={dirtyKeys.filter((key) => toolOwnsKey(tool.id, key)).length}
                  onClick={() => setSelected(tool.id)}
                />
              ))}
              {!filteredTools.length ? <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-500">Nenhum modulo encontrado.</div> : null}
            </div>
          </aside>

          <main className="min-w-0">
            {loading || !config ? (
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400">Carregando configuracoes...</div>
            ) : null}

            {config && selected === 'stats' ? (
              <ToolPanel title="Resumo do sistema" description="Estado geral do bot, sincronizacao e operacao em tempo real." icon={Gauge}>
                <div className="grid gap-3">
                  {summaryCards.map((card) => (
                    <SystemSummaryCard key={card.label} {...card} />
                  ))}
                </div>

                <ControlGroup title="Configuracoes essenciais" description="Controles principais com salvamento automatico e estado visual ativo.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <ConfigToggleCard icon={ToggleLeft} label="Modo manutencao" description="Pausa o uso normal do bot e mostra alerta no site." value={config.MAINTENANCE_MODE} onChange={(value) => update('MAINTENANCE_MODE', value)} />
                    <ConfigToggleCard icon={Lock} label="Painel privado" description="Limita o /painel aos cargos configurados." value={config.PANEL_PRIVATE_MODE} onChange={(value) => update('PANEL_PRIVATE_MODE', value)} />
                    <ConfigToggleCard icon={Radio} label="Monitor de ponto" description="Mantem a automacao de ponto e presenca ativa." value={config.POINT_MONITOR_ENABLED} onChange={(value) => update('POINT_MONITOR_ENABLED', value)} />
                    <ConfigToggleCard icon={CreditCard} label="Cobranca offline" description="Aplica regras de cobranca por ausencia/offline." value={config.POINT_OFFLINE_CHARGE_ENABLED} onChange={(value) => update('POINT_OFFLINE_CHARGE_ENABLED', value)} />
                  </div>
                </ControlGroup>
              </ToolPanel>
            ) : null}

            {config && selected === 'points' ? (
              <ToolPanel title="Gestao de pontos" description="Canais, automacao, cargos e tempos usados pelo sistema de ponto." icon={Radio}>
                <ControlGroup title="Canais do ponto" description="Os botoes e avisos do ponto usam estes canais no Discord.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Select label="Canal para bater ponto" value={config.POINT_ACTION_CHANNEL_ID || ''} options={textChannels} onChange={(value) => update('POINT_ACTION_CHANNEL_ID', value)} />
                    <Select label="Canal de membros online" value={config.POINT_ONLINE_CHANNEL_ID || ''} options={textChannels} onChange={(value) => update('POINT_ONLINE_CHANNEL_ID', value)} />
                    <Select label="Call liberada no game" value={config.POINT_ONLINE_VOICE_CHANNEL_ID || ''} options={voiceChannels} onChange={(value) => update('POINT_ONLINE_VOICE_CHANNEL_ID', value)} />
                    <Select label="Categoria de ajuste" value={config.POINT_ADJUST_CATEGORY_ID || ''} options={categories} onChange={(value) => update('POINT_ADJUST_CATEGORY_ID', value)} />
                    <Select label="Categoria de correcao" value={config.POINT_MONITOR_CORRECTION_CATEGORY_ID || ''} options={categories} onChange={(value) => update('POINT_MONITOR_CORRECTION_CATEGORY_ID', value)} />
                    <Select label="Canal de penalidade" value={config.POINT_PENALTY_CHANNEL_ID || ''} options={textChannels} onChange={(value) => update('POINT_PENALTY_CHANNEL_ID', value)} />
                  </div>
                </ControlGroup>

                <ControlGroup title="Automacao" description="Tempos usados pelo monitor para avisar, fechar e cobrar ponto.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <SwitchRow label="Monitor de ponto" value={config.POINT_MONITOR_ENABLED} onChange={(value) => update('POINT_MONITOR_ENABLED', value)} />
                    <SwitchRow label="Cobranca offline" value={config.POINT_OFFLINE_CHARGE_ENABLED} onChange={(value) => update('POINT_OFFLINE_CHARGE_ENABLED', value)} />
                    <NumberInput label="Fechar automatico apos horas" value={config.POINT_MONITOR_AUTO_CLOSE_HOURS} onChange={(value) => update('POINT_MONITOR_AUTO_CLOSE_HOURS', value)} />
                    <NumberInput label="Intervalo de DM em horas" value={config.POINT_MONITOR_DM_INTERVAL_HOURS} onChange={(value) => update('POINT_MONITOR_DM_INTERVAL_HOURS', value)} />
                    <NumberInput label="Maximo de DMs por ponto" value={config.POINT_MONITOR_MAX_DM_ATTEMPTS} onChange={(value) => update('POINT_MONITOR_MAX_DM_ATTEMPTS', value)} />
                    <NumberInput label="Limite offline em horas" value={config.POINT_OFFLINE_THRESHOLD_HOURS} onChange={(value) => update('POINT_OFFLINE_THRESHOLD_HOURS', value)} />
                  </div>
                </ControlGroup>

                <ControlGroup title="Permissoes do ponto" description="Cargos liberados para bater ponto e analisar ajustes.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <MultiSelect label="Cargos que podem bater ponto" value={config.POINT_ALLOWED_ROLE_IDS || []} options={roles} onChange={(value) => update('POINT_ALLOWED_ROLE_IDS', value)} />
                    <MultiSelect label="Cargos staff de ajuste" value={config.POINT_ADJUST_STAFF_ROLES || []} options={roles} onChange={(value) => update('POINT_ADJUST_STAFF_ROLES', value)} />
                    <StringListInput label="Gestores por DM" value={config.POINT_MANAGER_DM_USER_IDS || []} onChange={(value) => update('POINT_MANAGER_DM_USER_IDS', value)} placeholder="IDs separados por virgula" />
                  </div>
                </ControlGroup>
              </ToolPanel>
            ) : null}

            {config && selected === 'roles' ? (
              <ToolPanel title="Cargos Vortex" description="Niveis de acesso e cargos automaticos aplicados pelo bot." icon={Shield}>
                <ControlGroup title="Niveis de permissao" description="Estes cargos viram Admin, Medio ou Membro Vortex no painel do bot.">
                  <div className="grid gap-4 md:grid-cols-3">
                    <MultiSelect label="Admin Vortex" value={config.VORTEX_ROLE_LEVELS?.admin || []} options={roles} onChange={(value) => updateNested('VORTEX_ROLE_LEVELS', 'admin', value)} />
                    <MultiSelect label="Medio Vortex" value={config.VORTEX_ROLE_LEVELS?.medio || []} options={roles} onChange={(value) => updateNested('VORTEX_ROLE_LEVELS', 'medio', value)} />
                    <MultiSelect label="Membro Vortex" value={config.VORTEX_ROLE_LEVELS?.membro || []} options={roles} onChange={(value) => updateNested('VORTEX_ROLE_LEVELS', 'membro', value)} />
                  </div>
                </ControlGroup>
                <ControlGroup title="Cargos automaticos" description="Aplicados em pendencia ou aprovacao de cadastro.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <MultiSelect label="Pendente" value={config.VORTEX_AUTO_ROLES?.pending || []} options={roles} onChange={(value) => updateNested('VORTEX_AUTO_ROLES', 'pending', value)} />
                    <MultiSelect label="Aprovado" value={config.VORTEX_AUTO_ROLES?.approved || []} options={roles} onChange={(value) => updateNested('VORTEX_AUTO_ROLES', 'approved', value)} />
                  </div>
                </ControlGroup>
              </ToolPanel>
            ) : null}

            {config && selected === 'commands' ? (
              <ToolPanel title="Permissoes de comandos" description="Central moderna para ativar comandos e gerenciar cargos autorizados." icon={Lock}>
                {toast ? (
                  <div className="fixed right-5 top-5 z-50 rounded-2xl border border-emerald-300/25 bg-emerald-400/15 px-4 py-3 text-sm font-semibold text-emerald-100 shadow-2xl shadow-emerald-950/30 backdrop-blur-xl">
                    {toast}
                  </div>
                ) : null}

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <CommandMetricCard label="Comandos Totais" value={commandStats.total} icon={Command} tone="sky" />
                  <CommandMetricCard label="Comandos Ativos" value={commandStats.active} icon={CheckCircle2} tone="emerald" />
                  <CommandMetricCard label="Desativados" value={commandStats.disabled} icon={AlertTriangle} tone="rose" />
                  <CommandMetricCard label="Total de Permissoes" value={commandStats.permissions} icon={Shield} tone="sky" />
                </div>

                <section className="rounded-2xl border border-white/10 bg-vortex-surface/80 p-4 shadow-xl shadow-black/10 backdrop-blur-xl">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <label className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-vortex-bg/80 px-3 py-2 text-sm text-slate-300 transition focus-within:border-sky-300/35">
                      <Search size={16} className="text-sky-200" />
                      <input
                        value={commandQuery}
                        onChange={(event) => setCommandQuery(event.target.value)}
                        placeholder="Pesquisar comando"
                        className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-slate-500"
                      />
                    </label>
                    <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-vortex-bg/70 p-1 text-xs font-semibold text-slate-300">
                      {[
                        { id: 'all', label: 'Todos' },
                        { id: 'active', label: 'Ativos' },
                        { id: 'disabled', label: 'Desativados' }
                      ].map((item) => (
                        <button
                          key={item.id}
                          onClick={() => setCommandFilter(item.id as 'all' | 'active' | 'disabled')}
                          className={`rounded-xl px-3 py-2 transition duration-200 ${commandFilter === item.id ? 'bg-sky-400/15 text-sky-100 shadow-lg shadow-sky-950/20' : 'hover:bg-white/[0.055] hover:text-white'}`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </section>

                <div className="grid gap-4 xl:grid-cols-2">
                  {filteredCommandOptions.map((command) => (
                    <CommandPermissionCard
                      key={command.key}
                      command={command}
                      roles={roles}
                      selectedRoles={config.COMMAND_ROLE_PERMISSIONS?.[command.key] || []}
                      disabled={disabledCommands.has(command.key)}
                      onRolesChange={(value) => updateCommand(command.key, value)}
                      onDisabledChange={(value) => updateCommandDisabled(command.key, value)}
                    />
                  ))}
                  {!filteredCommandOptions.length ? (
                    <div className="rounded-2xl border border-white/10 bg-vortex-surface/80 p-6 text-sm text-slate-400">
                      Nenhum comando encontrado com os filtros atuais.
                    </div>
                  ) : null}
                </div>

                <section className="rounded-2xl border border-white/10 bg-vortex-surface/80 p-4 shadow-xl shadow-black/10 backdrop-blur-xl">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-2xl border border-sky-300/20 bg-sky-400/10 text-sky-100">
                      <FileText size={18} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">Historico de alteracoes</h3>
                      <p className="text-sm text-slate-400">Ultimas mudancas salvas nas permissoes.</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {(Array.isArray(config.COMMAND_PERMISSION_HISTORY) ? config.COMMAND_PERMISSION_HISTORY : []).slice(-8).reverse().map((item: any, index: number) => (
                      <div key={`${item.command}-${item.at}-${index}`} className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-vortex-bg/60 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                        <span className="font-medium text-white">{item.user || 'Painel Web'}</span>
                        <span className="text-slate-400">/{item.command}</span>
                        <span className="text-xs text-slate-500">{item.at ? new Date(item.at).toLocaleString('pt-BR') : 'Agora'}</span>
                      </div>
                    ))}
                    {!Array.isArray(config.COMMAND_PERMISSION_HISTORY) || !config.COMMAND_PERMISSION_HISTORY.length ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-vortex-bg/50 p-4 text-sm text-slate-500">
                        Nenhuma alteracao registrada ainda.
                      </div>
                    ) : null}
                  </div>
                </section>
              </ToolPanel>
            ) : null}

            {config && selected === 'bau' ? (
              <ToolPanel title="Bau" description="Permissoes do sistema de estoque dos membros e gerencia." icon={PackageOpen}>
                <div className="grid gap-4 md:grid-cols-2">
                  <ControlGroup title="/bau membro" description="Publica e cadastra produtos no bau.">
                    <MultiSelect label="Cargos liberados" value={config.COMMAND_ROLE_PERMISSIONS?.bau || []} options={roles} onChange={(value) => updateCommand('bau', value)} />
                  </ControlGroup>
                  <ControlGroup title="/bau-membros" description="Gerencia o painel de bau dos membros.">
                    <MultiSelect label="Cargos liberados" value={config.COMMAND_ROLE_PERMISSIONS?.['bau-membros'] || []} options={roles} onChange={(value) => updateCommand('bau-membros', value)} />
                  </ControlGroup>
                </div>
              </ToolPanel>
            ) : null}

            {config && selected === 'maintenance' ? (
              <ToolPanel title="Manutencao e logs" description="Controle o modo manutencao e os registros do bot." icon={ToggleLeft}>
                <ControlGroup title="Operacao" description="Quando a manutencao estiver ativa, o site tambem mostra o alerta central.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <SwitchRow label="Modo manutencao" value={config.MAINTENANCE_MODE} onChange={(value) => update('MAINTENANCE_MODE', value)} />
                    <SwitchRow label="Painel privado" value={config.PANEL_PRIVATE_MODE} onChange={(value) => update('PANEL_PRIVATE_MODE', value)} />
                  </div>
                </ControlGroup>
                <ControlGroup title="Logs" description="Mesmos controles da central de logs do bot.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Select label="Canal principal de logs" value={config.LOG_CHANNEL || ''} options={textChannels} onChange={(value) => update('LOG_CHANNEL', value)} />
                    <MultiSelect label="Canais com logs bloqueados" value={config.DISABLED_LOG_CHANNEL_IDS || []} options={logChannels} onChange={(value) => update('DISABLED_LOG_CHANNEL_IDS', value)} />
                    <SwitchRow label="Desativar logs em canal" value={config.DISABLE_CHANNEL_LOGS} onChange={(value) => update('DISABLE_CHANNEL_LOGS', value)} />
                    <SwitchRow label="Desativar logs de DM" value={config.DISABLE_DM_LOGS} onChange={(value) => update('DISABLE_DM_LOGS', value)} />
                    <SwitchRow label="Desativar logs de atividade" value={config.DISABLE_ACTIVITY_LOGS} onChange={(value) => update('DISABLE_ACTIVITY_LOGS', value)} />
                    <SwitchRow label="Desativar DMs de avisos" value={config.DISABLE_NOTICE_DMS} onChange={(value) => update('DISABLE_NOTICE_DMS', value)} />
                  </div>
                </ControlGroup>
              </ToolPanel>
            ) : null}

            {config && selected === 'messages' ? (
              <ToolPanel title="Mensagens" description="Transforme canais em painel e controle avisos por DM." icon={MessageSquare}>
                <ControlGroup title="Mensagens em painel" description="Mensagens enviadas nestes canais sao tratadas como painel pelo bot.">
                  <MultiSelect label="Canais que viram painel" value={config.MIRROR_MESSAGE_CHANNEL_IDS || []} options={textChannels} onChange={(value) => update('MIRROR_MESSAGE_CHANNEL_IDS', value)} />
                </ControlGroup>
                <ControlGroup title="Avisos" description="Controle DMs e cargo extra mencionado nos comunicados.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <SwitchRow label="Enviar avisos por DM" value={!config.DISABLE_NOTICE_DMS} onChange={(value) => update('DISABLE_NOTICE_DMS', !value)} />
                    <Select label="Cargo extra mencionado" value={config.NOTICE_MENTION_ROLE_ID || ''} options={roles} onChange={(value) => update('NOTICE_MENTION_ROLE_ID', value)} />
                  </div>
                </ControlGroup>
              </ToolPanel>
            ) : null}

            {config && selected === 'absence' ? (
              <ToolPanel title="Ausencias" description="Cargo e retorno automatico de ausencias." icon={Clock3}>
                <ControlGroup title="Configuracao de ausencia" description="Usado pelo comando de ausencia e mensagens de retorno.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Select label="Cargo de ausencia" value={config.ABSENCE_ROLE_ID || ''} options={roles} onChange={(value) => update('ABSENCE_ROLE_ID', value)} />
                    <SwitchRow label="Mensagens de retorno" value={config.ABSENCE_END_MESSAGE_ENABLED} onChange={(value) => update('ABSENCE_END_MESSAGE_ENABLED', value)} />
                  </div>
                </ControlGroup>
              </ToolPanel>
            ) : null}

            {config && selected === 'profile' ? (
              <ToolPanel title="Perfil" description="Cadastros, cobrancas e notificacoes de perfil." icon={Users}>
                <ControlGroup title="Automacoes de perfil" description="Mantem as regras de cadastro iguais as do bot.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <SwitchRow label="Cobrancas de perfil" value={config.PROFILE_BILLING_ENABLED} onChange={(value) => update('PROFILE_BILLING_ENABLED', value)} />
                    <SwitchRow label="Notificacoes de perfil" value={config.PROFILE_UPDATE_NOTIFICATIONS_ENABLED} onChange={(value) => update('PROFILE_UPDATE_NOTIFICATIONS_ENABLED', value)} />
                  </div>
                </ControlGroup>
              </ToolPanel>
            ) : null}

            {config && selected === 'billing' ? (
              <ToolPanel title="Cobrancas" description="Regras automaticas de perfil e ponto offline." icon={CreditCard}>
                <ControlGroup title="Regras ativas" description="As cobrancas automaticas rodam toda segunda-feira no bot.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <SwitchRow label="Cobrancas de perfil" value={config.PROFILE_BILLING_ENABLED} onChange={(value) => update('PROFILE_BILLING_ENABLED', value)} />
                    <SwitchRow label="Cobranca offline" value={config.POINT_OFFLINE_CHARGE_ENABLED} onChange={(value) => update('POINT_OFFLINE_CHARGE_ENABLED', value)} />
                    <NumberInput label="Limite offline em horas" value={config.POINT_OFFLINE_THRESHOLD_HOURS} onChange={(value) => update('POINT_OFFLINE_THRESHOLD_HOURS', value)} />
                  </div>
                </ControlGroup>
              </ToolPanel>
            ) : null}

            {config && selected === 'visual' ? (
              <ToolPanel title="Visual dos paineis" description="Cor, banner e proporcao usados nos paineis Components V2 do bot." icon={Palette}>
                <ControlGroup title="Tema global" description="Padrao usado quando um painel nao tem estilo proprio.">
                  <div className="grid gap-4 md:grid-cols-3">
                    <ColorInput label="Cor global" value={visuals.defaults.color || '#00BFFF'} onChange={(value) => updateVisualDefault('color', value)} />
                    <TextInput label="Banner global" value={visuals.defaults.bannerUrl || ''} onChange={(value) => updateVisualDefault('bannerUrl', value)} placeholder="https://..." />
                    <Select label="Proporcao global" value={visuals.defaults.bannerRatio || '16:9'} options={ratioOptions} onChange={(value) => updateVisualDefault('bannerRatio', value)} />
                  </div>
                </ControlGroup>
                <ControlGroup title="Tema por painel" description="Sobrescreve o visual de um painel especifico sem mexer no global.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Select label="Painel editado" value={visualTarget} options={visualTargets} onChange={setVisualTarget} />
                    <ColorInput label="Cor do painel" value={selectedTheme.color || '#00BFFF'} onChange={(value) => updateVisualTarget(visualTarget, 'color', value)} />
                    <TextInput label="Banner do painel" value={selectedTheme.bannerUrl || ''} onChange={(value) => updateVisualTarget(visualTarget, 'bannerUrl', value)} placeholder="https://..." />
                    <Select label="Proporcao do painel" value={selectedTheme.bannerRatio || '16:9'} options={ratioOptions} onChange={(value) => updateVisualTarget(visualTarget, 'bannerRatio', value)} />
                  </div>
                </ControlGroup>
              </ToolPanel>
            ) : null}

            {config && selected === 'adjust' ? (
              <ToolPanel title="Ajuste" description="Calls e cargos usados para correcao de ponto." icon={Wrench}>
                <ControlGroup title="Calls de ajuste" description="Calls liberadas para o sistema de ajuste.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <MultiSelect label="Calls de ajuste" value={config.ADJUST_CALL_CHANNEL_IDS || []} options={voiceChannels} onChange={(value) => update('ADJUST_CALL_CHANNEL_IDS', value)} />
                    <MultiSelect label="Staff de ajuste" value={config.POINT_ADJUST_STAFF_ROLES || []} options={roles} onChange={(value) => update('POINT_ADJUST_STAFF_ROLES', value)} />
                  </div>
                </ControlGroup>
              </ToolPanel>
            ) : null}

            {config && selected === 'hierarchy' ? (
              <ToolPanel title="Hierarquia FAC" description="Painel automatico de hierarquia usado pelo bot." icon={Eye}>
                <ControlGroup title="Publicacao" description="Canal e mensagem onde o painel automatico fica publicado.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Select label="Canal da hierarquia" value={config.FACTION_HIERARCHY?.channelId || ''} options={textChannels} onChange={(value) => updateHierarchy('channelId', value)} />
                    <TextInput label="ID da mensagem" value={config.FACTION_HIERARCHY?.messageId || ''} onChange={(value) => updateHierarchy('messageId', value)} placeholder="Opcional" />
                  </div>
                </ControlGroup>
                <ControlGroup title="Cargos da hierarquia" description="Cada posicao atualiza o painel automatico quando cargos mudam.">
                  <div className="grid gap-4 md:grid-cols-2">
                    {hierarchyRoles.map((role) => (
                      <MultiSelect
                        key={role.key}
                        label={role.label}
                        value={config.FACTION_HIERARCHY?.roles?.[role.key] || []}
                        options={roles}
                        onChange={(value) => updateHierarchyRole(role.key, value)}
                      />
                    ))}
                  </div>
                </ControlGroup>
              </ToolPanel>
            ) : null}

            {config && selectedTool && !toolMeta[selected] ? (
              <ToolPanel title={selectedTool.label} description={selectedTool.description} icon={SlidersHorizontal}>
                <ControlGroup title="Modulo conectado" description="Este modulo ja esta registrado na API e pode receber controles especificos.">
                  <p className="text-sm text-slate-400">As configuracoes principais ja estao disponiveis nos modulos ao lado.</p>
                </ControlGroup>
              </ToolPanel>
            ) : null}
          </main>
        </section>
      </div>
    </AppShell>
  );
}

function ToolButton({ tool, active, changed, onClick }: { tool: Tool; active: boolean; changed: number; onClick: () => void }) {
  const Icon = toolMeta[tool.id]?.icon || SlidersHorizontal;
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-2xl border px-3 py-3 text-left shadow-lg shadow-black/5 backdrop-blur transition duration-200 ${
        active
          ? 'border-sky-300/30 bg-sky-400/10 text-white shadow-sky-950/20'
          : 'border-white/10 bg-white/[0.025] text-slate-400 hover:border-sky-300/20 hover:bg-white/[0.055] hover:text-white'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${active ? 'border-sky-300/25 bg-sky-400/15 text-sky-100 shadow-lg shadow-sky-500/10' : 'border-white/10 bg-white/[0.035] text-slate-400'}`}>
          <Icon size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="font-semibold">{tool.label}</span>
            {changed ? <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-200">{changed}</span> : null}
          </span>
          <span className="mt-1 block text-xs leading-5 text-slate-500">{tool.description}</span>
        </span>
      </div>
    </button>
  );
}

function ToolPanel({ title, description, icon: Icon, children }: { title: string; description: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 shadow-xl shadow-black/10 backdrop-blur-xl">
        <div className="flex items-start gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-sky-300/20 bg-sky-400/10 text-sky-100 shadow-lg shadow-sky-950/25">
            <Icon size={20} />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-white">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-300">{description}</p>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

function ControlGroup({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 shadow-xl shadow-black/10 backdrop-blur-xl transition duration-200 hover:border-sky-300/15">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-white">{title}</h3>
        {description ? <p className="mt-1 text-sm leading-5 text-slate-400">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function StatusTile({ label, value, description, icon: Icon, ok, busy = false }: { label: string; value: string; description: string; icon: LucideIcon; ok: boolean; busy?: boolean }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.055] p-4 shadow-xl shadow-black/10 backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-sky-300/30 hover:bg-white/[0.075] hover:shadow-sky-500/15">
      <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/70 to-transparent opacity-0 transition group-hover:opacity-100" />
      <div className="flex items-center justify-between gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-2xl border border-sky-300/20 bg-sky-400/10 text-sky-100 shadow-lg shadow-sky-950/20">
          <Icon size={18} />
        </span>
        <span className={`grid h-8 w-8 place-items-center rounded-xl border ${busy ? 'border-sky-300/20 bg-sky-400/10 text-sky-200' : ok ? 'border-emerald-300/15 bg-emerald-400/10 text-emerald-200' : 'border-amber-300/15 bg-amber-400/10 text-amber-200'}`}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
        </span>
      </div>
      <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 truncate text-2xl font-semibold text-white">{value}</div>
      <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
    </div>
  );
}

function SystemSummaryCard({ label, value, detail, icon: Icon, active }: { label: string; value: string; detail: string; icon: LucideIcon; active: boolean }) {
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4 shadow-xl shadow-black/10 backdrop-blur-xl transition duration-200 hover:border-sky-300/20 hover:bg-white/[0.055] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-sky-300/20 bg-sky-400/10 text-sky-100">
          <Icon size={19} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 sm:min-w-40 sm:justify-end">
        <strong className="truncate text-lg font-semibold text-white">{value}</strong>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${active ? 'bg-sky-300 shadow-[0_0_18px_var(--vx-primary)]' : 'bg-slate-500'}`} />
      </div>
    </article>
  );
}

function ConfigToggleCard({ icon: Icon, label, description, value, onChange }: { icon: LucideIcon; label: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className={`group relative flex cursor-pointer flex-col justify-between gap-5 overflow-hidden rounded-2xl border p-4 shadow-xl backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 ${
      value
        ? 'border-sky-300/30 bg-sky-400/[0.08] shadow-sky-500/10'
        : 'border-white/10 bg-slate-950/55 shadow-black/10 hover:border-sky-300/20 hover:bg-white/[0.045]'
    }`}>
      <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/70 to-transparent opacity-0 transition group-hover:opacity-100" />
      <div className="flex items-start justify-between gap-4">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl border transition ${value ? 'border-sky-300/30 bg-sky-400/15 text-sky-100 shadow-lg shadow-sky-500/15' : 'border-white/10 bg-white/[0.04] text-slate-300'}`}>
          <Icon size={19} />
        </span>
        <ToggleSwitch value={Boolean(value)} />
      </div>
      <div>
        <p className="font-semibold text-white">{label}</p>
        <p className="mt-1 text-sm leading-5 text-slate-400">{description}</p>
      </div>
      <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
    </label>
  );
}

function ToggleSwitch({ value }: { value: boolean }) {
  return (
    <span className={`relative h-7 w-12 shrink-0 rounded-full border transition ${value ? 'border-sky-300/50 bg-sky-500 shadow-[0_0_22px_var(--vx-primary)]' : 'border-white/15 bg-slate-800'}`}>
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-lg transition ${value ? 'left-5' : 'left-0.5'}`} />
    </span>
  );
}

function CommandMetricCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: LucideIcon; tone: 'sky' | 'emerald' | 'rose' }) {
  const toneClass = tone === 'emerald'
    ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100'
    : tone === 'rose'
      ? 'border-rose-300/20 bg-rose-400/10 text-rose-100'
      : 'border-sky-300/20 bg-sky-400/10 text-sky-100';
  return (
    <article className="rounded-2xl border border-white/10 bg-vortex-surface/80 p-4 shadow-xl shadow-black/10 backdrop-blur-xl transition duration-200 hover:border-sky-300/25 hover:shadow-sky-500/10">
      <div className="flex items-center justify-between gap-3">
        <span className={`grid h-10 w-10 place-items-center rounded-2xl border ${toneClass}`}>
          <Icon size={18} />
        </span>
        <span className="h-2.5 w-2.5 rounded-full bg-sky-300 shadow-[0_0_18px_var(--vx-primary)]" />
      </div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <strong className="mt-1 block text-3xl font-semibold text-white">{value}</strong>
    </article>
  );
}

function CommandPermissionCard({
  command,
  roles,
  selectedRoles,
  disabled,
  onRolesChange,
  onDisabledChange
}: {
  command: CommandOption;
  roles: Option[];
  selectedRoles: string[];
  disabled: boolean;
  onRolesChange: (value: string[]) => void;
  onDisabledChange: (disabled: boolean) => void;
}) {
  const selectedSet = new Set(selectedRoles.map(String));
  const Icon = commandIcon(command.key);

  function toggleRole(roleId: string) {
    const next = new Set(selectedSet);
    if (next.has(roleId)) next.delete(roleId);
    else next.add(roleId);
    onRolesChange(Array.from(next));
  }

  return (
    <article className={`group overflow-hidden rounded-2xl border bg-vortex-surface/85 p-4 shadow-xl shadow-black/10 backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:shadow-sky-500/10 ${
      disabled ? 'border-rose-400/30' : 'border-sky-300/25'
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl border ${disabled ? 'border-rose-300/25 bg-rose-400/10 text-rose-100' : 'border-sky-300/25 bg-sky-400/10 text-sky-100'}`}>
            <Icon size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="text-xl font-semibold tracking-tight text-white">{command.label}</h3>
            <p className="mt-1 text-sm leading-5 text-slate-400">{command.description}</p>
          </div>
        </div>
        <button
          onClick={() => onDisabledChange(!disabled)}
          className="shrink-0"
          aria-label={disabled ? 'Ativar comando' : 'Desativar comando'}
        >
          <ToggleSwitch value={!disabled} />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${disabled ? 'border-rose-300/25 bg-rose-400/10 text-rose-100' : 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100'}`}>
          <span className={`h-2 w-2 rounded-full ${disabled ? 'bg-rose-300' : 'bg-emerald-300'}`} />
          {disabled ? 'Desativado' : 'Ativado'}
        </span>
        <span className="rounded-full border border-white/10 bg-vortex-bg/70 px-3 py-1 text-xs font-semibold text-slate-300">
          {selectedRoles.length} cargo{selectedRoles.length === 1 ? '' : 's'} permitido{selectedRoles.length === 1 ? '' : 's'}
        </span>
      </div>

      {disabled ? (
        <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
          Este comando está desativado.
        </div>
      ) : null}

      <div className="mt-5">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Cargos Permitidos</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => onRolesChange(roles.map((role) => role.id))} className="rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-1 text-xs font-semibold text-sky-100 transition hover:bg-sky-400/15">
              Selecionar Todos
            </button>
            <button onClick={() => onRolesChange([])} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-300 transition hover:bg-white/[0.08] hover:text-white">
              Remover Todos
            </button>
          </div>
        </div>
        <div className="flex max-h-52 flex-wrap gap-2 overflow-auto rounded-2xl border border-white/10 bg-vortex-bg/55 p-3">
          {roles.map((role) => {
            const selected = selectedSet.has(role.id);
            return (
              <button
                key={role.id}
                onClick={() => toggleRole(role.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition duration-200 ${
                  selected
                    ? 'border-sky-300/40 bg-sky-400/15 text-sky-50 shadow-lg shadow-sky-950/20'
                    : 'border-white/10 bg-white/[0.035] text-slate-400 hover:border-sky-300/20 hover:bg-white/[0.07] hover:text-white'
                }`}
              >
                {role.name}
              </button>
            );
          })}
          {!roles.length ? <span className="text-sm text-slate-500">Nenhum cargo carregado.</span> : null}
        </div>
      </div>
    </article>
  );
}

function commandIcon(key: string): LucideIcon {
  if (key.includes('bau')) return PackageOpen;
  if (key.includes('ponto') || key === 'ativarponto') return Radio;
  if (key === 'painel') return Settings2;
  if (key === 'avisos') return MessageSquare;
  if (key === 'perfil' || key === 'cadastro') return Users;
  if (key === 'clear') return AlertTriangle;
  return Command;
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: Option[]; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-300/40">
        <option value="">Nao configurado</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </label>
  );
}

function MultiSelect({ label, value, options, onChange }: { label: string; value: string[]; options: Option[]; onChange: (value: string[]) => void }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] normal-case tracking-normal text-slate-400">{value.length} selecionado{value.length === 1 ? '' : 's'}</span>
      </span>
      <select
        multiple
        value={value}
        onChange={(event) => onChange(Array.from(event.target.selectedOptions).map((option) => option.value))}
        className="mt-1 h-36 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-300/40"
      >
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </label>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <input type="number" value={value || 0} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-300/40" />
    </label>
  );
}

function TextInput({ label, value, onChange, placeholder = '' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-sky-300/40" />
    </label>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <div className="mt-1 flex rounded-lg border border-white/10 bg-slate-950/80 p-1 focus-within:border-sky-300/40">
        <input type="color" value={normalizeColor(value)} onChange={(event) => onChange(event.target.value.toUpperCase())} className="h-9 w-12 shrink-0 rounded border-0 bg-transparent p-0" />
        <input value={value || '#00BFFF'} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 bg-transparent px-3 text-sm text-white outline-none" />
      </div>
    </label>
  );
}

function StringListInput({ label, value, onChange, placeholder }: { label: string; value: string[]; onChange: (value: string[]) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <textarea
        value={value.join(', ')}
        onChange={(event) => onChange(event.target.value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))}
        placeholder={placeholder}
        className="mt-1 h-36 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-sky-300/40"
      />
    </label>
  );
}

function SwitchRow({ label, value, onChange, description }: { label: string; value: boolean; onChange: (value: boolean) => void; description?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-3 text-sm transition hover:bg-white/[0.045]">
      <span className="min-w-0">
        <span className="block font-medium text-slate-200">{label}</span>
        {description ? <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span> : null}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full border transition ${value ? 'border-sky-300/40 bg-sky-500' : 'border-white/15 bg-slate-800'}`}>
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${value ? 'left-5' : 'left-0.5'}`} />
      </span>
    </label>
  );
}

function toolOwnsKey(toolId: string, key: string) {
  return (toolMeta[toolId]?.keys || []).some((item) => key === item || key.startsWith(item));
}

function getPanelVisuals(config: BotConfig | null) {
  const raw = config?.PANEL_VISUALS && typeof config.PANEL_VISUALS === 'object' ? config.PANEL_VISUALS : {};
  return {
    defaults: {
      color: '#00BFFF',
      bannerUrl: '',
      bannerRatio: '16:9',
      ...(raw.defaults || {})
    },
    targets: {
      ...(raw.targets || {})
    }
  };
}

function normalizeColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#00BFFF';
}

function saveStateLabel(status: SaveStatus, hasChanges: boolean, lastSavedAt: Date | null) {
  if (status === 'saving') return 'Salvando...';
  if (status === 'error') return 'Erro';
  if (hasChanges) return 'Pendente';
  if (lastSavedAt) return `Salvo ${lastSavedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  return 'Pronto';
}

function formatUptime(ms: number) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}min`;
  return `${Math.max(1, minutes)}min`;
}

function formatKeys(keys: string[]) {
  if (!keys.length) return 'configuracao';
  return keys.map((key) => keyLabels[key] || key.toLowerCase().replaceAll('_', ' ')).join(', ');
}
