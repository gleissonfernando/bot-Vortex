'use client';

import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  CreditCard,
  Eye,
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
  Shield,
  SlidersHorizontal,
  ToggleLeft,
  Users,
  Wrench,
  type LucideIcon
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

type Tool = { id: string; label: string; description: string };
type Option = { id: string; name: string; type?: number };
type BotConfig = Record<string, any>;
type SaveStatus = 'idle' | 'saving' | 'error';

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
  { key: 'painelponto', label: '/painelponto', description: 'Quem pode abrir o painel de ponto.' },
  { key: 'set', label: '/set', description: 'Quem pode usar o sistema de set.' },
  { key: 'serve', label: '/serve', description: 'Quem pode consultar ou usar serve.' },
  { key: 'registro', label: '/registro', description: 'Quem pode consultar registros.' },
  { key: 'ponto', label: '/ponto', description: 'Quem pode gerar relatorio de ponto.' },
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
  { id: 'painelponto', name: '/painelponto' },
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
  commands: { icon: Lock, keys: ['COMMAND_ROLE_PERMISSIONS'] },
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

  const configRef = useRef<BotConfig | null>(null);
  const pendingPatchRef = useRef<BotConfig>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    load();
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
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
        <section className="overflow-hidden rounded-lg border border-white/10 bg-slate-950/70 shadow-2xl shadow-black/20">
          <div className="border-b border-white/10 bg-gradient-to-r from-sky-500/15 via-slate-950 to-emerald-500/10 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-1 text-xs font-semibold text-sky-100">
                  <Bot size={14} />
                  Controle em tempo real
                </div>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Bot Vortex</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                  Configure os mesmos modulos do /painel do Discord. Cada alteracao salva automaticamente no arquivo que o bot usa.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={load}
                  disabled={loading || saving}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                  Recarregar
                </button>
                <button
                  onClick={saveNow}
                  disabled={!config || (!hasChanges && !Object.keys(pendingPatchRef.current).length) || saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  <Save size={16} />
                  {saving ? 'Sincronizando...' : hasChanges ? 'Salvar agora' : 'Sincronizado'}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatusTile label="Bot" value={config?.MAINTENANCE_MODE ? 'Manutencao' : 'Online'} ok={!config?.MAINTENANCE_MODE} />
              <StatusTile label="Discord" value={channels.length ? `${channels.length} canais` : 'Sem canais'} ok={channels.length > 0} />
              <StatusTile label="Cargos" value={roles.length ? `${roles.length} cargos` : 'Sem cargos'} ok={roles.length > 0} />
              <StatusTile label="Autosave" value={saveStateLabel(saveStatus, hasChanges, lastSavedAt)} ok={saveStatus !== 'error' && !hasChanges} busy={saveStatus === 'saving'} />
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
              <ToolPanel title="Resumo do sistema" description="Estado geral do bot e atalhos de operacao." icon={Gauge}>
                <div className="grid gap-3 md:grid-cols-2">
                  <SwitchRow label="Modo manutencao" description="Pausa o uso normal do bot e mostra alerta no site." value={config.MAINTENANCE_MODE} onChange={(value) => update('MAINTENANCE_MODE', value)} />
                  <SwitchRow label="Painel privado" description="Limita o /painel aos cargos configurados." value={config.PANEL_PRIVATE_MODE} onChange={(value) => update('PANEL_PRIVATE_MODE', value)} />
                  <SwitchRow label="Monitor de ponto" description="Mantem a automacao de ponto ativa." value={config.POINT_MONITOR_ENABLED} onChange={(value) => update('POINT_MONITOR_ENABLED', value)} />
                  <SwitchRow label="Cobranca offline" description="Aplica as regras de cobranca por ausencia/offline." value={config.POINT_OFFLINE_CHARGE_ENABLED} onChange={(value) => update('POINT_OFFLINE_CHARGE_ENABLED', value)} />
                </div>
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
              <ToolPanel title="Permissoes de comandos" description="Espelha a aba de comandos do /painel." icon={Lock}>
                <div className="grid gap-4 md:grid-cols-2">
                  {commandOptions.map((command) => (
                    <ControlGroup key={command.key} title={command.label} description={command.description}>
                      <MultiSelect
                        label="Cargos liberados"
                        value={config.COMMAND_ROLE_PERMISSIONS?.[command.key] || []}
                        options={roles}
                        onChange={(value) => updateCommand(command.key, value)}
                      />
                    </ControlGroup>
                  ))}
                </div>
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
                <ControlGroup title="Regras ativas" description="As cobrancas entram no mesmo fluxo automatico usado pelo bot.">
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
                    <ColorInput label="Cor global" value={visuals.defaults.color || '#7000FF'} onChange={(value) => updateVisualDefault('color', value)} />
                    <TextInput label="Banner global" value={visuals.defaults.bannerUrl || ''} onChange={(value) => updateVisualDefault('bannerUrl', value)} placeholder="https://..." />
                    <Select label="Proporcao global" value={visuals.defaults.bannerRatio || '16:9'} options={ratioOptions} onChange={(value) => updateVisualDefault('bannerRatio', value)} />
                  </div>
                </ControlGroup>
                <ControlGroup title="Tema por painel" description="Sobrescreve o visual de um painel especifico sem mexer no global.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Select label="Painel editado" value={visualTarget} options={visualTargets} onChange={setVisualTarget} />
                    <ColorInput label="Cor do painel" value={selectedTheme.color || '#7000FF'} onChange={(value) => updateVisualTarget(visualTarget, 'color', value)} />
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
      className={`w-full rounded-lg border px-3 py-3 text-left transition ${
        active
          ? 'border-sky-300/25 bg-sky-400/10 text-white shadow-lg shadow-sky-950/20'
          : 'border-white/10 bg-white/[0.025] text-slate-400 hover:bg-white/[0.05] hover:text-white'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${active ? 'border-sky-300/25 bg-sky-400/15 text-sky-100' : 'border-white/10 bg-white/[0.035] text-slate-400'}`}>
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
      <div className="rounded-lg border border-white/10 bg-slate-950/70 p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-sky-300/20 bg-sky-400/10 text-sky-100">
            <Icon size={20} />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-400">{description}</p>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

function ControlGroup({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-4">
        <h3 className="font-semibold text-white">{title}</h3>
        {description ? <p className="mt-1 text-sm leading-5 text-slate-500">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function StatusTile({ label, value, ok, busy = false }: { label: string; value: string; ok: boolean; busy?: boolean }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className={`grid h-8 w-8 place-items-center rounded-lg border ${busy ? 'border-sky-300/20 bg-sky-400/10 text-sky-200' : ok ? 'border-emerald-300/15 bg-emerald-400/10 text-emerald-200' : 'border-amber-300/15 bg-amber-400/10 text-amber-200'}`}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
        </span>
      </div>
      <div className="mt-3 truncate text-lg font-semibold text-white">{value}</div>
    </div>
  );
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
        <input value={value || '#7000FF'} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 bg-transparent px-3 text-sm text-white outline-none" />
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
      color: '#7000FF',
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
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#7000FF';
}

function saveStateLabel(status: SaveStatus, hasChanges: boolean, lastSavedAt: Date | null) {
  if (status === 'saving') return 'Salvando...';
  if (status === 'error') return 'Erro';
  if (hasChanges) return 'Pendente';
  if (lastSavedAt) return `Salvo ${lastSavedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  return 'Pronto';
}

function formatKeys(keys: string[]) {
  if (!keys.length) return 'configuracao';
  return keys.map((key) => keyLabels[key] || key.toLowerCase().replaceAll('_', ' ')).join(', ');
}
