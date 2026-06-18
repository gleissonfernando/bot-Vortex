'use client';

import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import {
  BadgeDollarSign,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardList,
  Crosshair,
  DoorOpen,
  FileText,
  Image as ImageIcon,
  Medal,
  Pencil,
  Plus,
  Radio,
  Rocket,
  ShieldCheck,
  Trash2,
  Trophy,
  UserMinus,
  Users,
  X
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type ActionStatus = 'Aberta' | 'Em andamento' | 'Vitoria' | 'Derrota' | 'Cancelada';
type ActionView = 'user' | 'admin' | 'manager' | 'report';
type ShellUser = { id: string; role: 'admin' | 'manager' | 'viewer'; discordId?: string };
type Participant = { id: string; name: string; joinedAt: string };
type VortexAction = {
  id: string;
  name: string;
  date: string;
  limit: number;
  status: ActionStatus;
  weapons: string;
  stolenValue: number;
  negotiator: string;
  mvp: string;
  finalResult: string;
  bannerUrl: string;
  confirmed: Participant[];
  reserves: Participant[];
  createdAt: string;
  finalizedAt?: string;
};

const STORAGE_KEY = 'vortex_action_system_v1';
const DEFAULT_BANNER = '/vortex-logo.png';
const statusOptions: ActionStatus[] = ['Aberta', 'Em andamento', 'Vitoria', 'Derrota', 'Cancelada'];

const emptyForm = {
  id: '',
  name: '',
  date: '',
  limit: '6',
  status: 'Aberta' as ActionStatus,
  weapons: '',
  stolenValue: '0',
  negotiator: '',
  mvp: '',
  finalResult: '',
  bannerUrl: DEFAULT_BANNER
};

function seedActions(): VortexAction[] {
  return [{
    id: 'acao-15062026-cf-acougue',
    name: 'cf - acougue',
    date: '15/06/2026',
    limit: 6,
    status: 'Aberta',
    weapons: '3 mtar + 3 g3',
    stolenValue: 0,
    negotiator: '',
    mvp: '',
    finalResult: '',
    bannerUrl: DEFAULT_BANNER,
    confirmed: [],
    reserves: [],
    createdAt: new Date().toISOString()
  }];
}

function readActions() {
  if (typeof window === 'undefined') return seedActions();
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as VortexAction[];
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    return seedActions();
  }
  return seedActions();
}

function writeActions(actions: VortexAction[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
  window.dispatchEvent(new CustomEvent('vortex-actions-updated'));
}

function slug(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || `acao-${Date.now()}`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function userParticipant(user: ShellUser | null): Participant {
  const id = String(user?.discordId || user?.id || 'local-user');
  return {
    id,
    name: user?.discordId ? `@${user.discordId}` : '@Vortex',
    joinedAt: new Date().toISOString()
  };
}

function isManager(user: ShellUser | null) {
  return ['admin', 'manager'].includes(String(user?.role || ''));
}

function isClosed(action?: VortexAction | null) {
  return ['Vitoria', 'Derrota', 'Cancelada'].includes(String(action?.status || ''));
}

export default function ActionsPage() {
  const [actions, setActions] = useState<VortexAction[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [view, setView] = useState<ActionView>('user');
  const [user, setUser] = useState<ShellUser | null>(null);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    const load = () => {
      const next = readActions();
      setActions(next);
      setSelectedId((current) => current || next[0]?.id || '');
    };
    load();
    window.addEventListener('storage', load);
    window.addEventListener('vortex-actions-updated', load);
    apiFetch<{ user: ShellUser }>('/auth/me').then((data) => setUser(data.user)).catch(() => setUser(null));
    return () => {
      window.removeEventListener('storage', load);
      window.removeEventListener('vortex-actions-updated', load);
    };
  }, []);

  const selected = actions.find((item) => item.id === selectedId) || actions[0] || null;
  const participant = useMemo(() => userParticipant(user), [user]);
  const alreadyIn = Boolean(selected && [...selected.confirmed, ...selected.reserves].some((item) => item.id === participant.id));

  function updateActions(mutator: (items: VortexAction[]) => VortexAction[]) {
    const next = mutator(readActions());
    setActions(next);
    if (!next.some((item) => item.id === selectedId)) setSelectedId(next[0]?.id || '');
    writeActions(next);
  }

  function resetForm(action?: VortexAction | null) {
    if (!action) {
      setForm(emptyForm);
      return;
    }
    setForm({
      id: action.id,
      name: action.name,
      date: action.date,
      limit: String(action.limit),
      status: action.status,
      weapons: action.weapons,
      stolenValue: String(action.stolenValue),
      negotiator: action.negotiator,
      mvp: action.mvp,
      finalResult: action.finalResult,
      bannerUrl: action.bannerUrl || DEFAULT_BANNER
    });
    setView('admin');
  }

  function saveAction() {
    const name = form.name.trim();
    const date = form.date.trim();
    const limit = Math.max(1, Math.floor(Number(form.limit || 1)));
    if (!name || !date) return;
    const id = form.id || `${slug(name)}-${Date.now()}`;
    const doc: VortexAction = {
      id,
      name,
      date,
      limit,
      status: form.status,
      weapons: form.weapons.trim(),
      stolenValue: Math.max(0, Number(form.stolenValue || 0)),
      negotiator: form.negotiator.trim(),
      mvp: form.mvp.trim(),
      finalResult: form.finalResult.trim(),
      bannerUrl: form.bannerUrl.trim() || DEFAULT_BANNER,
      confirmed: actions.find((item) => item.id === id)?.confirmed || [],
      reserves: actions.find((item) => item.id === id)?.reserves || [],
      createdAt: actions.find((item) => item.id === id)?.createdAt || new Date().toISOString(),
      finalizedAt: ['Vitoria', 'Derrota'].includes(form.status) ? new Date().toISOString() : undefined
    };
    updateActions((items) => [doc, ...items.filter((item) => item.id !== id)]);
    setSelectedId(id);
    setForm(emptyForm);
    setView('user');
  }

  function deleteAction(id: string) {
    updateActions((items) => items.filter((item) => item.id !== id));
    setForm(emptyForm);
  }

  function participate() {
    if (!selected || alreadyIn || isClosed(selected)) return;
    updateActions((items) => items.map((action) => {
      if (action.id !== selected.id) return action;
      const next = { ...action, confirmed: [...action.confirmed], reserves: [...action.reserves] };
      if (next.confirmed.length < next.limit) next.confirmed.push(participant);
      else next.reserves.push(participant);
      return next;
    }));
  }

  function leaveAction(id = participant.id) {
    if (!selected) return;
    updateActions((items) => items.map((action) => {
      if (action.id !== selected.id) return action;
      const wasConfirmed = action.confirmed.some((item) => item.id === id);
      const confirmed = action.confirmed.filter((item) => item.id !== id);
      const reserves = action.reserves.filter((item) => item.id !== id);
      if (wasConfirmed && reserves.length) confirmed.push(reserves.shift()!);
      return { ...action, confirmed, reserves };
    }));
  }

  function patchSelected(patch: Partial<VortexAction>) {
    if (!selected) return;
    updateActions((items) => items.map((action) => action.id === selected.id ? { ...action, ...patch } : action));
  }

  function moveReserve(id: string) {
    if (!selected) return;
    updateActions((items) => items.map((action) => {
      if (action.id !== selected.id) return action;
      const reserve = action.reserves.find((item) => item.id === id);
      if (!reserve || action.confirmed.length >= action.limit) return action;
      return {
        ...action,
        confirmed: [...action.confirmed, reserve],
        reserves: action.reserves.filter((item) => item.id !== id)
      };
    }));
  }

  function finalizeAction(result: ActionStatus = 'Vitoria') {
    patchSelected({ status: result, finalizedAt: new Date().toISOString(), finalResult: selected?.finalResult || result });
    setView('report');
  }

  async function uploadBanner(file: File | null) {
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
    setForm((current) => ({ ...current, bannerUrl: dataUrl }));
  }

  return (
    <AppShell>
      <div className="app-content">
        <section className="vortex-action-hero">
          <div className="vortex-action-rail" />
          <div className="relative z-10 max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-lg border border-red-300/15 bg-red-500/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-red-100">
              <Crosshair size={14} /> Vortex - Sistema de Acao
            </div>
            <h1 className="mt-4 text-3xl font-semibold text-white md:text-4xl">Sistema de Acao - Vortex</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Acompanhe a acao, gerencie participacao, reservas, gerencia e relatorio final em um unico painel.</p>
          </div>
          <img src="/vortex-logo.png" alt="Vortex" className="absolute right-5 top-5 h-24 w-24 rounded-lg object-cover opacity-90 shadow-2xl shadow-black/40 md:h-32 md:w-32" />
        </section>

        <section className="grid gap-4 xl:grid-cols-[280px_1fr]">
          <aside className="vortex-action-menu">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><Radio size={17} /> Acoes</h2>
              {isManager(user) ? <button className="vortex-icon-btn" onClick={() => { resetForm(null); setView('admin'); }}><Plus size={15} /></button> : null}
            </div>
            <select value={selected?.id || ''} onChange={(event) => setSelectedId(event.target.value)} className="mt-3 w-full">
              {actions.map((action) => <option key={action.id} value={action.id}>{action.name}</option>)}
            </select>
            <div className="mt-3 grid gap-2">
              {actions.map((action) => (
                <button key={action.id} onClick={() => { setSelectedId(action.id); setView('user'); }} className={`vortex-action-item ${action.id === selected?.id ? 'is-active' : ''}`}>
                  <span className="truncate">{action.name}</span>
                  <StatusBadge status={action.status} />
                </button>
              ))}
            </div>
          </aside>

          <main className="min-w-0">
            <div className="mb-4 flex flex-wrap gap-2">
              <TabButton active={view === 'user'} icon={Crosshair} label="Painel da Acao" onClick={() => setView('user')} />
              {isManager(user) ? <TabButton active={view === 'admin'} icon={Pencil} label="Cadastrar Acao" onClick={() => setView('admin')} /> : null}
              {isManager(user) ? <TabButton active={view === 'manager'} icon={ShieldCheck} label="Gerencia" onClick={() => setView('manager')} /> : null}
              <TabButton active={view === 'report'} icon={FileText} label="Relatorio" onClick={() => setView('report')} />
            </div>

            {view === 'admin' && isManager(user) ? (
              <AdminPanel form={form} setForm={setForm} saveAction={saveAction} selected={selected} resetForm={resetForm} deleteAction={deleteAction} finalizeAction={finalizeAction} uploadBanner={uploadBanner} />
            ) : null}

            {view === 'user' ? (
              <ActionPanel action={selected} alreadyIn={alreadyIn} canManage={isManager(user)} onParticipate={participate} onLeave={() => leaveAction()} onManager={() => setView('manager')} />
            ) : null}

            {view === 'manager' && isManager(user) ? (
              <ManagerPanel action={selected} patchSelected={patchSelected} leaveAction={leaveAction} moveReserve={moveReserve} finalizeAction={finalizeAction} />
            ) : null}

            {view === 'report' ? <ReportPanel action={selected} /> : null}
          </main>
        </section>
      </div>
    </AppShell>
  );
}

function AdminPanel({ form, setForm, saveAction, selected, resetForm, deleteAction, finalizeAction, uploadBanner }: {
  form: typeof emptyForm;
  setForm: React.Dispatch<React.SetStateAction<typeof emptyForm>>;
  saveAction: () => void;
  selected: VortexAction | null;
  resetForm: (action?: VortexAction | null) => void;
  deleteAction: (id: string) => void;
  finalizeAction: (status?: ActionStatus) => void;
  uploadBanner: (file: File | null) => void;
}) {
  return (
    <section className="vortex-card">
      <SectionTitle icon={ClipboardList} title="Cadastrar Acao" helper="Barra Painel Vortex" />
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <Field label="Nome da acao"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="cf - acougue" /></Field>
        <Field label="Data da acao"><input value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} placeholder="15/06/2026" /></Field>
        <Field label="Limite de participantes"><input type="number" min={1} value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} placeholder="6" /></Field>
        <Field label="Status inicial">
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ActionStatus })}>{statusOptions.map((item) => <option key={item}>{item}</option>)}</select>
        </Field>
        <Field label="Armamentos"><input value={form.weapons} onChange={(e) => setForm({ ...form, weapons: e.target.value })} placeholder="3 mtar + 3 g3" /></Field>
        <Field label="Valor roubado"><input type="number" min={0} value={form.stolenValue} onChange={(e) => setForm({ ...form, stolenValue: e.target.value })} /></Field>
        <Field label="Negociador"><input value={form.negotiator} onChange={(e) => setForm({ ...form, negotiator: e.target.value })} placeholder="Opcional" /></Field>
        <Field label="MVP"><input value={form.mvp} onChange={(e) => setForm({ ...form, mvp: e.target.value })} placeholder="Opcional" /></Field>
        <Field label="Resultado final"><input value={form.finalResult} onChange={(e) => setForm({ ...form, finalResult: e.target.value })} placeholder="Opcional" /></Field>
        <Field label="Banner/logo da acao">
          <div className="grid gap-2">
            <input value={form.bannerUrl} onChange={(e) => setForm({ ...form, bannerUrl: e.target.value })} placeholder="/vortex-logo.png ou URL" />
            <label className="vortex-upload"><ImageIcon size={15} /> Upload de imagem<input type="file" accept="image/*" className="hidden" onChange={(e) => uploadBanner(e.target.files?.[0] || null)} /></label>
          </div>
        </Field>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <ActionButton tone="green" icon={Plus} label="Criar acao" onClick={saveAction} />
        <ActionButton tone="blue" icon={Pencil} label="Editar acao" onClick={() => selected && resetForm(selected)} disabled={!selected} />
        <ActionButton tone="gray" icon={CheckCircle2} label="Finalizar acao" onClick={() => finalizeAction('Vitoria')} disabled={!selected} />
        <ActionButton tone="red" icon={Trash2} label="Excluir acao" onClick={() => selected && deleteAction(selected.id)} disabled={!selected} />
      </div>
    </section>
  );
}

function ActionPanel({ action, alreadyIn, canManage, onParticipate, onLeave, onManager }: {
  action: VortexAction | null;
  alreadyIn: boolean;
  canManage: boolean;
  onParticipate: () => void;
  onLeave: () => void;
  onManager: () => void;
}) {
  if (!action) return <EmptyState text="Cadastre uma acao para iniciar o painel." />;
  const blocked = isClosed(action);
  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="vortex-card">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-semibold text-white"><Crosshair size={24} /> Sistema de Acao - Vortex</h2>
            <p className="mt-2 text-sm text-slate-400">Acompanhe a acao e gerencie sua participacao.</p>
          </div>
          <img src={action.bannerUrl || DEFAULT_BANNER} alt="" className="h-24 w-24 rounded-lg object-cover md:h-32 md:w-32" />
        </div>
        <Details action={action} />
      </div>
      <div className="grid gap-4">
        <JoinCard title="Participar da acao" text="Entra como Titular ou Reserva se lotar." button={alreadyIn ? 'Ja participando' : 'Participar'} icon={Rocket} tone="green" disabled={alreadyIn || blocked} onClick={onParticipate} />
        <JoinCard title="Sair da acao" text="Sai da acao e atualiza a fila automaticamente." button="Sair" icon={DoorOpen} tone="gray" disabled={!alreadyIn} onClick={onLeave} />
        {canManage ? <JoinCard title="Gerencia" text="Acesso restrito. Abre um painel exclusivo com ferramentas de gerente." button="Painel do Gerente" icon={Rocket} tone="red" onClick={onManager} /> : null}
      </div>
      <ParticipantsCard title="Confirmados" icon={Check} items={action.confirmed} />
      <ParticipantsCard title="Reservas" icon={CalendarDays} items={action.reserves} empty="Nenhum" />
    </section>
  );
}

function ManagerPanel({ action, patchSelected, leaveAction, moveReserve, finalizeAction }: {
  action: VortexAction | null;
  patchSelected: (patch: Partial<VortexAction>) => void;
  leaveAction: (id: string) => void;
  moveReserve: (id: string) => void;
  finalizeAction: (status?: ActionStatus) => void;
}) {
  if (!action) return <EmptyState text="Selecione uma acao para abrir a gerencia." />;
  return (
    <section className="vortex-card">
      <SectionTitle icon={ShieldCheck} title="Gerencia" helper="Ferramentas exclusivas para gerente/admin" />
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Status da acao"><select value={action.status} onChange={(e) => patchSelected({ status: e.target.value as ActionStatus })}>{statusOptions.map((item) => <option key={item}>{item}</option>)}</select></Field>
        <Field label="MVP"><input value={action.mvp} onChange={(e) => patchSelected({ mvp: e.target.value })} /></Field>
        <Field label="Valor roubado"><input type="number" value={action.stolenValue} onChange={(e) => patchSelected({ stolenValue: Math.max(0, Number(e.target.value || 0)) })} /></Field>
        <Field label="Negociador"><input value={action.negotiator} onChange={(e) => patchSelected({ negotiator: e.target.value })} /></Field>
        <Field label="Resultado final"><input value={action.finalResult} onChange={(e) => patchSelected({ finalResult: e.target.value })} /></Field>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <ActionButton tone="green" icon={Trophy} label="Finalizar Vitoria" onClick={() => finalizeAction('Vitoria')} />
        <ActionButton tone="red" icon={X} label="Finalizar Derrota" onClick={() => finalizeAction('Derrota')} />
        <ActionButton tone="blue" icon={FileText} label="Gerar relatorio" onClick={() => finalizeAction(action.status === 'Derrota' ? 'Derrota' : 'Vitoria')} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ManagerList title="Confirmados" items={action.confirmed} onRemove={leaveAction} />
        <ManagerList title="Reservas" items={action.reserves} onRemove={leaveAction} onMove={moveReserve} />
      </div>
    </section>
  );
}

function ReportPanel({ action }: { action: VortexAction | null }) {
  if (!action) return <EmptyState text="Selecione uma acao para gerar o relatorio." />;
  return (
    <section className="vortex-card">
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-semibold text-white"><Crosshair size={24} /> Relatorio da Acao</h2>
          <p className="mt-2 text-sm text-slate-400">Relatorio gerado automaticamente ao concluir a acao.</p>
        </div>
        <img src={action.bannerUrl || DEFAULT_BANNER} alt="" className="h-24 w-24 rounded-lg object-cover md:h-32 md:w-32" />
      </div>
      <Details action={action} report />
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <SummaryItem icon={Medal} label="MVP" value={action.mvp || 'Nao informado'} />
        <SummaryItem icon={BadgeDollarSign} label="Valor roubado" value={formatMoney(action.stolenValue)} />
        <SummaryItem icon={Users} label="Negociador" value={action.negotiator || 'Nao informado'} />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <ReportBlock title="Armamentos" icon={Crosshair} lines={(action.weapons || 'Nao informado').split(/\r?\n|\+/).map((line) => line.trim()).filter(Boolean)} />
        <ReportBlock title="Confirmados" icon={Check} lines={action.confirmed.map((item, index) => `${index + 1}. ${item.name} | ${item.id}`)} />
        <ReportBlock title="Reservas" icon={CalendarDays} lines={action.reserves.length ? action.reserves.map((item, index) => `${index + 1}. ${item.name} | ${item.id}`) : ['Nenhum']} />
      </div>
      <p className="mt-6 border-t border-white/10 pt-4 text-center text-xs text-slate-500">Vortex - Todos os direitos reservados</p>
    </section>
  );
}

function Details({ action, report = false }: { action: VortexAction; report?: boolean }) {
  return (
    <div className="mt-6">
      <SectionTitle icon={ClipboardList} title="Detalhes" helper={report ? 'Resumo final da acao' : 'Informacoes cadastradas'} />
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Detail icon={Crosshair} label="Acao" value={action.name} />
        <Detail icon={CalendarDays} label="Data" value={action.date} />
        <Detail icon={Users} label="Limite" value={String(action.limit)} />
        <Detail icon={Radio} label={report ? 'Resultado' : 'Status'} value={<StatusBadge status={action.status} />} />
        <Detail icon={FileText} label="ID" value={<span className="vortex-badge">{action.id}</span>} />
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, helper }: { icon: React.ElementType; title: string; helper?: string }) {
  return <div><h2 className="flex items-center gap-2 text-lg font-semibold text-white"><Icon size={19} /> {title}</h2>{helper ? <p className="mt-1 text-sm text-slate-500">{helper}</p> : null}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-sm"><span className="font-semibold text-slate-300">{label}</span>{children}</label>;
}

function Detail({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return <div className="vortex-detail"><span><Icon size={15} /> {label}</span><strong>{value}</strong></div>;
}

function StatusBadge({ status }: { status: ActionStatus }) {
  const tone = status === 'Vitoria' ? 'green' : status === 'Derrota' || status === 'Cancelada' ? 'red' : status === 'Em andamento' ? 'blue' : 'gray';
  return <span className={`vortex-status ${tone}`}>{status}</span>;
}

function TabButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: React.ElementType; label: string; onClick: () => void }) {
  return <button onClick={onClick} className={`vortex-tab ${active ? 'is-active' : ''}`}><Icon size={16} /> {label}</button>;
}

function ActionButton({ tone, icon: Icon, label, onClick, disabled = false }: { tone: 'green' | 'red' | 'gray' | 'blue'; icon: React.ElementType; label: string; onClick: () => void; disabled?: boolean }) {
  return <button disabled={disabled} onClick={onClick} className={`vortex-btn ${tone}`}><Icon size={16} /> {label}</button>;
}

function JoinCard({ title, text, button, icon: Icon, tone, onClick, disabled = false }: { title: string; text: string; button: string; icon: React.ElementType; tone: 'green' | 'red' | 'gray'; onClick: () => void; disabled?: boolean }) {
  return <div className="vortex-card compact"><SectionTitle icon={Icon} title={title} /><p className="mt-2 text-sm text-slate-400">{text}</p><button disabled={disabled} onClick={onClick} className={`vortex-btn mt-4 w-full ${tone}`}><Icon size={16} /> {button}</button></div>;
}

function ParticipantsCard({ title, icon: Icon, items, empty = 'Nenhum' }: { title: string; icon: React.ElementType; items: Participant[]; empty?: string }) {
  return <div className="vortex-card"><SectionTitle icon={Icon} title={title} /><ol className="mt-4 space-y-2">{items.length ? items.map((item, index) => <li className="vortex-person" key={item.id}><span>{index + 1}. {item.name}</span><span>{item.id}</span></li>) : <li className="text-sm text-slate-500">{empty}</li>}</ol></div>;
}

function ManagerList({ title, items, onRemove, onMove }: { title: string; items: Participant[]; onRemove: (id: string) => void; onMove?: (id: string) => void }) {
  return <div className="rounded-lg border border-white/10 p-4"><h3 className="text-sm font-semibold text-white">{title}</h3><div className="mt-3 grid gap-2">{items.length ? items.map((item) => <div className="vortex-person" key={item.id}><span>{item.name} | {item.id}</span><span className="flex gap-1">{onMove ? <button className="vortex-icon-btn" onClick={() => onMove(item.id)}><Check size={14} /></button> : null}<button className="vortex-icon-btn danger" onClick={() => onRemove(item.id)}><UserMinus size={14} /></button></span></div>) : <p className="text-sm text-slate-500">Nenhum</p>}</div></div>;
}

function SummaryItem({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return <div className="vortex-detail"><span><Icon size={15} /> {label}</span><strong>{value}</strong></div>;
}

function ReportBlock({ title, icon: Icon, lines }: { title: string; icon: React.ElementType; lines: string[] }) {
  return <div className="rounded-lg border border-white/10 p-4"><h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Icon size={16} /> {title}</h3><div className="mt-3 grid gap-2 text-sm text-slate-300">{lines.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}</div></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="vortex-card text-sm text-slate-400">{text}</div>;
}
