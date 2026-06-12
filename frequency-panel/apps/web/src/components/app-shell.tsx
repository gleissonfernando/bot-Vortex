'use client';

import {
  Activity,
  ArrowUpRight,
  Bot,
  CalendarOff,
  Clock3,
  Command,
  LayoutDashboard,
  LogOut,
  PackageOpen,
  Radio,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  UserCog,
  Users
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch, clearToken } from '@/lib/api';

const ANTI_ABUSE_MANAGER_IDS = new Set([
  '289227932432334869',
  '1426287249020158018'
]);

const navGroups = [
  {
    label: 'Principal',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/dashboard/members', label: 'Membros', icon: Users },
      { href: '/dashboard/site-users', label: 'Usuarios do site', icon: UserCog, roles: ['admin', 'manager'] }
    ]
  },
  {
    label: 'Operacao',
    items: [
      { href: '/dashboard/absences', label: 'Ausencias', icon: CalendarOff },
      { href: '/dashboard/bau', label: 'Bau', icon: PackageOpen },
      { href: '/dashboard/lives', label: 'Lives', icon: Radio },
      { href: '/dashboard/bot-vortex', label: 'Bot Vortex', icon: Bot }
    ]
  },
  {
    label: 'Seguranca',
    items: [
      { href: '/dashboard/anti-abuse', label: 'Anti-Abuso', icon: ShieldAlert, access: 'anti-abuse' }
    ]
  }
];

const nav = navGroups.flatMap((group) => group.items);
const IDLE_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_SESSION_IDLE_TIMEOUT_MS || 30 * 60 * 1000);

type ShellUser = { id: string; role: 'admin' | 'manager' | 'viewer'; discordId?: string };
type NavItem = typeof nav[number];

const routeMeta = [
  { match: '/dashboard/anti-abuse', title: 'Seguranca', description: 'Protecoes, punicoes e limites de abuso.' },
  { match: '/dashboard/bot-vortex', title: 'Bot Vortex', description: 'Configuracao e operacao do bot em tempo real.' },
  { match: '/dashboard/site-users', title: 'Acessos', description: 'Usuarios autorizados e niveis do painel.' },
  { match: '/dashboard/members', title: 'Membros', description: 'Frequencia, perfis e atividade da comunidade.' },
  { match: '/dashboard/absences', title: 'Ausencias', description: 'Afastamentos ativos, agendados e historico.' },
  { match: '/dashboard/lives', title: 'Lives', description: 'Canais monitorados e alertas para o Discord.' },
  { match: '/dashboard/bau', title: 'Bau', description: 'Estoque e movimentacoes sincronizadas.' },
  { match: '/dashboard', title: 'Dashboard', description: 'Visao geral da operacao Vortex.' }
];

function canSeeNavItem(item: NavItem, user: ShellUser | null) {
  if ('access' in item && item.access === 'anti-abuse') {
    return Boolean(user?.discordId && ANTI_ABUSE_MANAGER_IDS.has(user.discordId));
  }
  return !('roles' in item) || !item.roles || item.roles.includes(user?.role || 'viewer');
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const [user, setUser] = useState<ShellUser | null>(null);
  const [navQuery, setNavQuery] = useState('');

  const currentRoute = routeMeta.find((item) => pathname === item.match || (item.match !== '/dashboard' && pathname.startsWith(item.match))) || routeMeta.at(-1)!;
  const visibleGroups = useMemo(() => {
    const query = navQuery.trim().toLowerCase();
    return navGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => (
          canSeeNavItem(item, user)
          && (!query || `${group.label} ${item.label}`.toLowerCase().includes(query))
        ))
      }))
      .filter((group) => group.items.length);
  }, [navQuery, user]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    apiFetch<{ user: ShellUser }>('/auth/me').then((data) => setUser(data.user)).catch(() => router.push('/'));
  }, [router]);

  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout>;
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        clearToken();
        router.push('/');
      }, IDLE_TIMEOUT_MS);
    };
    const events = ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'];

    resetIdleTimer();
    events.forEach((eventName) => window.addEventListener(eventName, resetIdleTimer, { passive: true }));

    return () => {
      clearTimeout(idleTimer);
      events.forEach((eventName) => window.removeEventListener(eventName, resetIdleTimer));
    };
  }, [router]);

  function logout() {
    apiFetch('/auth/logout', { method: 'POST', body: JSON.stringify({}) }).catch(() => undefined);
    clearToken();
    router.push('/');
  }

  return (
    <div className="min-h-screen text-slate-100">
      <aside className="app-sidebar fixed inset-y-0 left-0 z-40 hidden w-[17.5rem] p-4 lg:flex lg:flex-col">
        <Link href="/dashboard" className="group relative block h-36 overflow-hidden rounded-lg bg-slate-950">
          <img src="/vortex-logo.png" alt="" className="absolute inset-0 h-full w-full object-cover opacity-45 transition duration-500 group-hover:scale-[1.03] group-hover:opacity-55" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/80 to-blue-950/20" />
          <div className="absolute inset-x-0 bottom-0 p-4">
            <h1 className="text-xl font-semibold text-white">Vortex</h1>
            <div className="mt-1 flex items-center gap-2 text-xs font-medium text-emerald-200">
              <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(52,211,153,.8)]" />
              Online
            </div>
          </div>
        </Link>

        <label className="mt-4 flex items-center gap-2 rounded-lg bg-white/[0.035] px-3 py-2.5 text-sm text-slate-400 shadow-inner shadow-black/10">
          <Search size={16} />
          <input
            value={navQuery}
            onChange={(event) => setNavQuery(event.target.value)}
            placeholder="Buscar modulo"
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:ring-0"
          />
        </label>

        <nav className="mt-5 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">{group.label}</p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
                  return (
                    <Link
                      key={`${item.href}-${item.label}`}
                      href={item.href}
                      className={`group relative flex min-h-11 items-center gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-sm font-medium ${
                        active
                          ? 'bg-blue-500/15 text-white shadow-[0_0_24px_rgba(59,130,246,.14)]'
                          : 'text-slate-400 hover:bg-white/[0.045] hover:text-white'
                      }`}
                    >
                      {active ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-blue-400 shadow-[0_0_12px_rgba(96,165,250,.9)]" /> : null}
                      <Icon size={18} className={active ? 'text-blue-200' : 'text-slate-500 group-hover:text-slate-200'} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-4 flex items-center gap-3 rounded-lg bg-white/[0.025] p-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-500/15 text-xs font-bold text-blue-100">
            {(user?.role || 'V').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">Vortex Admin</p>
            <p className="truncate text-xs capitalize text-slate-500">{user?.role || 'conectando'}</p>
          </div>
          <button
            onClick={logout}
            title="Sair"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-rose-400/10 hover:text-rose-200"
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <main className="lg:pl-[17.5rem]">
        <header className="sticky top-0 z-30 bg-[#020617]/84 px-4 py-3 backdrop-blur-2xl sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <Link href="/dashboard" className="h-9 w-9 shrink-0 overflow-hidden rounded-lg lg:hidden">
                <img src="/vortex-logo.png" alt="Vortex" className="h-full w-full object-cover" />
              </Link>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{currentRoute.title}</p>
                <p className="hidden truncate text-xs text-slate-500 sm:block">{currentRoute.description}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 text-xs font-medium text-emerald-200 sm:flex">
                <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(52,211,153,.7)]" />
                Sistema online
              </div>
              <div className="hidden h-4 w-px bg-white/10 sm:block" />
              <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                <Clock3 size={14} />
                {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </div>
              <button onClick={logout} title="Sair" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-white/[0.05] hover:text-white lg:hidden">
                <LogOut size={16} />
              </button>
            </div>
          </div>

          <nav className="mx-auto mt-3 flex max-w-[1480px] gap-2 overflow-x-auto pb-1 lg:hidden">
            {nav.filter((item) => canSeeNavItem(item, user)).map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
              return (
                <Link
                  key={`mobile-${item.href}-${item.label}`}
                  href={item.href}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${
                    active ? 'bg-blue-500/15 text-blue-100' : 'bg-white/[0.035] text-slate-400'
                  }`}
                >
                  <Icon size={15} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        <div className="app-content mx-auto max-w-[1480px] px-4 sm:px-6 lg:px-8">
          <ProductBanner canManageSecurity={user?.role === 'admin' || user?.role === 'manager'} />
          {children}
        </div>
      </main>
    </div>
  );
}

function ProductBanner({ canManageSecurity }: { canManageSecurity: boolean }) {
  return (
    <section className="product-banner flex items-end p-6 sm:p-8">
      <div className="relative z-10 max-w-2xl">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-blue-200">
          <Activity size={15} />
          Operacao protegida
        </div>
        <h2 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">Vortex Management</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
          Seu servidor monitorado em tempo real, com protecoes, automacoes e configuracoes sincronizadas.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {canManageSecurity ? (
            <Link href="/dashboard/anti-abuse" className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_24px_rgba(59,130,246,.25)] hover:bg-blue-400">
              <ShieldCheck size={16} />
              Ver protecoes
            </Link>
          ) : null}
          <Link href="/dashboard/bot-vortex" className="inline-flex items-center gap-2 rounded-lg bg-white/[0.08] px-4 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-white/[0.13]">
            <Settings2 size={16} />
            Configuracoes
            <ArrowUpRight size={15} />
          </Link>
        </div>
      </div>
    </section>
  );
}
