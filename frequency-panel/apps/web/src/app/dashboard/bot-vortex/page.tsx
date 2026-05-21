'use client';

import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import { Bot, Radio, Save, Shield, SlidersHorizontal, ToggleLeft, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type Tool = { id: string; label: string; description: string };
type Option = { id: string; name: string; type?: number };
type BotConfig = Record<string, any>;

const commandOptions = ['painel', 'ponto', 'registro', 'relatorio-ponto', 'painelponto', 'ativarponto', 'avisos', 'ausencia', 'perfil', 'lives'];

export default function BotVortexPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [selected, setSelected] = useState('points');
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [channels, setChannels] = useState<Option[]>([]);
  const [roles, setRoles] = useState<Option[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const textChannels = useMemo(() => channels.filter((channel) => channel.type === 0 || channel.type === 5), [channels]);
  const categories = useMemo(() => channels.filter((channel) => channel.type === 4), [channels]);

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ tools: Tool[]; config: BotConfig; options: { channels: Option[]; roles: Option[]; error?: string | null } }>('/bot-vortex');
      setTools(data.tools);
      setConfig(data.config);
      setChannels(data.options.channels || []);
      setRoles(data.options.roles || []);
      if (data.options.error) setMessage(data.options.error);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao carregar Bot Vortex');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function update(key: string, value: any) {
    setConfig((current) => ({ ...(current || {}), [key]: value }));
  }

  function updateNested(key: string, nestedKey: string, value: any) {
    setConfig((current) => ({ ...(current || {}), [key]: { ...((current || {})[key] || {}), [nestedKey]: value } }));
  }

  async function save(patch?: BotConfig) {
    if (!config) return;
    const payload = patch || config;
    setMessage('');
    try {
      const data = await apiFetch<{ config: BotConfig; applied: string[] }>('/bot-vortex/config', {
        method: 'PUT',
        body: JSON.stringify({ patch: payload })
      });
      setConfig(data.config);
      setMessage(`Salvo em tempo real: ${data.applied.join(', ') || 'configuracao'}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar');
    }
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-slate-300">
              <Bot size={14} />
              Controle conectado ao bot
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Bot Vortex</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Escolha uma ferramenta e gerencie as configuracoes que o bot usa no Discord em tempo real.
            </p>
          </div>
          <button onClick={() => save()} className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400">
            <Save size={16} />
            Salvar tudo
          </button>
        </header>

        {message ? <div className="rounded-lg border border-sky-300/15 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">{message}</div> : null}

        <section className="grid gap-5 xl:grid-cols-[310px_1fr]">
          <aside className="panel rounded-lg p-3">
            <div className="mb-3 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Ferramentas</div>
            <div className="space-y-1">
              {tools.map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => setSelected(tool.id)}
                  className={`w-full rounded-lg px-3 py-3 text-left transition ${selected === tool.id ? 'bg-white/[0.08] text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'}`}
                >
                  <div className="font-semibold">{tool.label}</div>
                  <div className="mt-1 text-xs text-slate-500">{tool.description}</div>
                </button>
              ))}
            </div>
          </aside>

          <main className="panel rounded-lg p-5">
            {loading || !config ? <div className="text-sm text-slate-400">Carregando configuracoes...</div> : null}
            {config && selected === 'points' ? (
              <ToolPanel title="Gestao de Pontos" icon={<Radio size={20} />}>
                <div className="grid gap-4 md:grid-cols-2">
                  <Select label="Canal para bater ponto" value={config.POINT_ACTION_CHANNEL_ID || ''} options={textChannels} onChange={(value) => update('POINT_ACTION_CHANNEL_ID', value)} />
                  <Select label="Canal de membros online" value={config.POINT_ONLINE_CHANNEL_ID || ''} options={textChannels} onChange={(value) => update('POINT_ONLINE_CHANNEL_ID', value)} />
                  <Select label="Categoria de ajuste" value={config.POINT_ADJUST_CATEGORY_ID || ''} options={categories} onChange={(value) => update('POINT_ADJUST_CATEGORY_ID', value)} />
                  <MultiSelect label="Cargos que podem bater ponto" value={config.POINT_ALLOWED_ROLE_IDS || []} options={roles} onChange={(value) => update('POINT_ALLOWED_ROLE_IDS', value)} />
                  <MultiSelect label="Cargos staff de ajuste" value={config.POINT_ADJUST_STAFF_ROLES || []} options={roles} onChange={(value) => update('POINT_ADJUST_STAFF_ROLES', value)} />
                  <NumberInput label="Fechar automatico apos horas" value={config.POINT_MONITOR_AUTO_CLOSE_HOURS} onChange={(value) => update('POINT_MONITOR_AUTO_CLOSE_HOURS', value)} />
                </div>
                <SwitchRow label="Monitor de ponto" value={config.POINT_MONITOR_ENABLED} onChange={(value) => update('POINT_MONITOR_ENABLED', value)} />
                <SwitchRow label="Cobranca offline" value={config.POINT_OFFLINE_CHARGE_ENABLED} onChange={(value) => update('POINT_OFFLINE_CHARGE_ENABLED', value)} />
              </ToolPanel>
            ) : null}

            {config && selected === 'roles' ? (
              <ToolPanel title="Cargos Vortex" icon={<Shield size={20} />}>
                <div className="grid gap-4 md:grid-cols-3">
                  <MultiSelect label="Admin Vortex" value={config.VORTEX_ROLE_LEVELS?.admin || []} options={roles} onChange={(value) => updateNested('VORTEX_ROLE_LEVELS', 'admin', value)} />
                  <MultiSelect label="Medio Vortex" value={config.VORTEX_ROLE_LEVELS?.medio || []} options={roles} onChange={(value) => updateNested('VORTEX_ROLE_LEVELS', 'medio', value)} />
                  <MultiSelect label="Membro Vortex" value={config.VORTEX_ROLE_LEVELS?.membro || []} options={roles} onChange={(value) => updateNested('VORTEX_ROLE_LEVELS', 'membro', value)} />
                </div>
              </ToolPanel>
            ) : null}

            {config && selected === 'commands' ? (
              <ToolPanel title="Permissoes de Comandos" icon={<Users size={20} />}>
                <div className="grid gap-4 md:grid-cols-2">
                  {commandOptions.map((command) => (
                    <MultiSelect
                      key={command}
                      label={`/${command}`}
                      value={config.COMMAND_ROLE_PERMISSIONS?.[command] || []}
                      options={roles}
                      onChange={(value) => updateNested('COMMAND_ROLE_PERMISSIONS', command, value)}
                    />
                  ))}
                </div>
              </ToolPanel>
            ) : null}

            {config && selected === 'maintenance' ? (
              <ToolPanel title="Manutencao e Logs" icon={<ToggleLeft size={20} />}>
                <SwitchRow label="Modo manutencao" value={config.MAINTENANCE_MODE} onChange={(value) => update('MAINTENANCE_MODE', value)} />
                <SwitchRow label="Painel privado" value={config.PANEL_PRIVATE_MODE} onChange={(value) => update('PANEL_PRIVATE_MODE', value)} />
                <SwitchRow label="Desativar logs em canal" value={config.DISABLE_CHANNEL_LOGS} onChange={(value) => update('DISABLE_CHANNEL_LOGS', value)} />
                <SwitchRow label="Desativar logs de DM" value={config.DISABLE_DM_LOGS} onChange={(value) => update('DISABLE_DM_LOGS', value)} />
                <SwitchRow label="Desativar logs de atividade" value={config.DISABLE_ACTIVITY_LOGS} onChange={(value) => update('DISABLE_ACTIVITY_LOGS', value)} />
              </ToolPanel>
            ) : null}

            {config && selected === 'messages' ? (
              <ToolPanel title="Mensagens em Painel" icon={<SlidersHorizontal size={20} />}>
                <MultiSelect label="Canais que viram painel" value={config.MIRROR_MESSAGE_CHANNEL_IDS || []} options={textChannels} onChange={(value) => update('MIRROR_MESSAGE_CHANNEL_IDS', value)} />
              </ToolPanel>
            ) : null}

            {config && !['points', 'roles', 'commands', 'maintenance', 'messages'].includes(selected) ? (
              <ToolPanel title={tools.find((tool) => tool.id === selected)?.label || 'Ferramenta'} icon={<SlidersHorizontal size={20} />}>
                <p className="text-sm text-slate-400">Esta ferramenta ja aparece organizada aqui e sera expandida com os controles especificos do /painel.</p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <SwitchRow label="Avisos por DM" value={!config.DISABLE_NOTICE_DMS} onChange={(value) => update('DISABLE_NOTICE_DMS', !value)} />
                  <SwitchRow label="Mensagens de retorno de ausencia" value={config.ABSENCE_END_MESSAGE_ENABLED} onChange={(value) => update('ABSENCE_END_MESSAGE_ENABLED', value)} />
                  <SwitchRow label="Cobrancas de perfil" value={config.PROFILE_BILLING_ENABLED} onChange={(value) => update('PROFILE_BILLING_ENABLED', value)} />
                  <SwitchRow label="Notificacoes de perfil" value={config.PROFILE_UPDATE_NOTIFICATIONS_ENABLED} onChange={(value) => update('PROFILE_UPDATE_NOTIFICATIONS_ENABLED', value)} />
                </div>
              </ToolPanel>
            ) : null}

            {config ? (
              <button onClick={() => save()} className="mt-5 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.1]">
                <Save size={16} />
                Aplicar no bot
              </button>
            ) : null}
          </main>
        </section>
      </div>
    </AppShell>
  );
}

function ToolPanel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-white/[0.05] text-sky-200">{icon}</div>
        <div>
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          <p className="text-sm text-slate-500">Alteracoes salvas aqui sao lidas pelo bot automaticamente.</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: Option[]; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white">
        <option value="">Nao configurado</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </label>
  );
}

function MultiSelect({ label, value, options, onChange }: { label: string; value: string[]; options: Option[]; onChange: (value: string[]) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <select
        multiple
        value={value}
        onChange={(event) => onChange(Array.from(event.target.selectedOptions).map((option) => option.value))}
        className="mt-1 h-32 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
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
      <input type="number" value={value || 0} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white" />
    </label>
  );
}

function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-sm">
      <span className="text-slate-300">{label}</span>
      <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-white/20 bg-slate-900 text-sky-500" />
    </label>
  );
}
