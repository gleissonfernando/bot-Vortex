'use client';

import { BarChart3, Bot, CalendarOff, Clock3, Command, LayoutDashboard, LogOut, PackageOpen, Radio, Search, Server, ShieldCheck, UserCog, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch, clearToken } from '@/lib/api';

const navGroups = [
  {
    label: 'Operacao',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/dashboard/members', label: 'Membros', icon: Users },
      { href: '/dashboard/reports', label: 'Relatorios', icon: BarChart3 },
      { href: '/dashboard/site-users', label: 'Usuarios do site', icon: UserCog, roles: ['admin', 'manager'] }
    ]
  },
  {
    label: 'Modulos',
    items: [
      { href: '/dashboard/absences', label: 'Ausencias', icon: CalendarOff },
      { href: '/dashboard/bau', label: 'Bau', icon: PackageOpen },
      { href: '/dashboard/lives', label: 'Lives', icon: Radio },
      { href: '/dashboard/bot-vortex', label: 'Bot Vortex', icon: Bot }
    ]
  }
];
const nav = navGroups.flatMap((group) => group.items);
const IDLE_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_SESSION_IDLE_TIMEOUT_MS || 30 * 60 * 1000);
type ShellUser = { id: string; role: 'admin' | 'manager' | 'viewer' };
type NavItem = typeof nav[number];

function canSeeNavItem(item: NavItem, role: ShellUser['role']) {
  return !item.roles || item.roles.includes(role);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const [user, setUser] = useState<ShellUser | null>(null);

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
    <div className="min-h-screen bg-vortex-bg text-slate-100">
      <aside className="fixed inset-y-0 left-0 hidden w-[19rem] border-r border-white/10 bg-vortex-bg/82 p-5 shadow-2xl shadow-black/20 backdrop-blur-2xl lg:block">
        <div className="rounded-[18px] border border-sky-300/15 bg-vortex-surface/80 p-4 shadow-xl shadow-sky-950/20">
          <div className="flex items-center gap-3">
          <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-2xl border border-sky-300/20 bg-white/[0.06] shadow-lg shadow-sky-500/10">
            <img src="/vortex-logo.png" alt="Vortex" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-white">Vortex</h1>
            <p className="text-xs font-medium text-slate-400">Command Center</p>
          </div>
          </div>
          <div className="mt-4 flex items-center justify-between rounded-2xl border border-emerald-300/15 bg-emerald-400/10 px-3 py-2">
            <span className="flex items-center gap-2 text-xs font-semibold text-emerald-100">
              <span className="h-2 w-2 rounded-full bg-vortex-success animate-pulse-glow" />
              Sistema online
            </span>
            <ShieldCheck size={15} className="text-emerald-200" />
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-vortex-surface/70 p-3 shadow-lg shadow-black/10">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Search size={16} />
            Busca por nome, ID ou cargo
          </div>
        </div>

        <nav className="mt-6 space-y-6">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{group.label}</p>
              <div className="space-y-1">
                {group.items.filter((item) => canSeeNavItem(item, user?.role || 'viewer')).map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
                  return (
                    <Link
                      key={`${item.href}-${item.label}`}
                      href={item.href}
                      className={`group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition duration-300 ${
                        active
                          ? 'border border-sky-300/20 bg-sky-400/12 text-white shadow-[var(--vx-glow)]'
                          : 'text-slate-400 hover:bg-vortex-surface hover:text-white'
                      }`}
                    >
                      <span className={`grid h-9 w-9 place-items-center rounded-xl border transition ${active ? 'border-sky-300/25 bg-sky-400/15 text-sky-100' : 'border-white/10 bg-white/[0.035] text-slate-400 group-hover:border-sky-300/15 group-hover:text-sky-100'}`}>
                        <Icon size={18} />
                      </span>
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <button
          onClick={logout}
          className="absolute bottom-5 left-5 right-5 flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-vortex-surface/80 px-3 py-2.5 text-sm font-semibold text-slate-300 shadow-lg shadow-black/10 transition hover:border-vortex-danger/25 hover:bg-vortex-danger/10 hover:text-white"
        >
          <LogOut size={16} />
          Sair
        </button>
      </aside>

      <main className="lg:pl-[19rem]">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-vortex-bg/86 px-4 py-3 backdrop-blur-xl lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <Link href="/dashboard" className="flex min-w-0 items-center gap-3">
              <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-blue-400/20 bg-vortex-bg">
                <img src="/vortex-logo.png" alt="Vortex" className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold">Vortex</h1>
                <p className="text-xs text-slate-500">Tempo real</p>
              </div>
            </Link>
            <button
              onClick={logout}
              title="Sair"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-200"
            >
              <LogOut size={16} />
            </button>
          </div>

          <nav className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {nav.filter((item) => canSeeNavItem(item, user?.role || 'viewer')).map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
              return (
                <Link
                  key={`mobile-${item.href}-${item.label}`}
                  href={item.href}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                    active
                      ? 'border-blue-300/30 bg-blue-500/15 text-blue-100'
                      : 'border-white/10 bg-white/[0.04] text-slate-300'
                  }`}
                >
                  <Icon size={15} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        <header className="sticky top-0 z-20 hidden border-b border-white/10 bg-vortex-bg/76 px-8 py-4 backdrop-blur-2xl lg:block">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl border border-sky-300/20 bg-sky-400/10 text-sky-100">
                <Server size={19} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Servidor</p>
                <h2 className="text-sm font-semibold text-white">Vortex Management</h2>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <HeaderPill icon={Bot} label="Bot" value="Online" tone="emerald" />
              <HeaderPill icon={Clock3} label="Sincronizacao" value="Tempo real" tone="sky" />
              <HeaderPill icon={Command} label="Usuario" value="Admin" tone="sky" />
              <div className="rounded-2xl border border-white/10 bg-vortex-surface/80 px-3 py-2 text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Agora</p>
                <p className="text-xs font-semibold text-white">{now.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}

function HeaderPill({ icon: Icon, label, value, tone }: { icon: typeof Bot; label: string; value: string; tone: 'sky' | 'emerald' }) {
  return (
    <div className={`flex items-center gap-2 rounded-2xl border px-3 py-2 ${tone === 'emerald' ? 'border-emerald-300/15 bg-emerald-400/10 text-emerald-100' : 'border-sky-300/15 bg-sky-400/10 text-sky-100'}`}>
      <Icon size={15} />
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
        <p className="text-xs font-semibold text-white">{value}</p>
      </div>
    </div>
  );
}
