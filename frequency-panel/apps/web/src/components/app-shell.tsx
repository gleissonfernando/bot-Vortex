'use client';

import { BarChart3, Bot, LayoutDashboard, LogOut, PackageOpen, Radio, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clearToken } from '@/lib/api';

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/members', label: 'Membros', icon: Users },
  { href: '/dashboard/members', label: 'Relatorios', icon: BarChart3 },
  { href: '/dashboard/bau', label: 'Bau', icon: PackageOpen },
  { href: '/dashboard/lives', label: 'Lives', icon: Radio },
  { href: '/dashboard/bot-vortex', label: 'Bot Vortex', icon: Bot }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  function logout() {
    clearToken();
    router.push('/');
  }

  return (
    <div className="min-h-screen bg-surface-950 text-slate-100">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-white/10 bg-black/20 p-5 backdrop-blur-xl lg:block">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-lg border border-white/10 bg-white/[0.06]">
            <img src="/vortex-logo.png" alt="Vortex" className="h-full w-full object-cover" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Vortex Frequency</h1>
            <p className="text-xs text-slate-500">Operacao em tempo real</p>
          </div>
        </div>

        <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.035] p-3">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Search size={16} />
            Busca por nome, ID ou cargo
          </div>
        </div>

        <nav className="mt-6 space-y-1">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link
                key={`${item.href}-${item.label}`}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active ? 'bg-white/[0.08] text-white shadow-sm' : 'text-slate-500 hover:bg-white/[0.04] hover:text-white'
                }`}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={logout}
          className="absolute bottom-5 left-5 right-5 flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/[0.07] hover:text-white"
        >
          <LogOut size={16} />
          Sair
        </button>
      </aside>

      <main className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-surface-950/90 px-4 py-3 backdrop-blur-xl lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <Link href="/dashboard" className="flex min-w-0 items-center gap-3">
              <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-blue-400/20 bg-black">
                <img src="/vortex-logo.png" alt="Vortex" className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold">Vortex Frequency</h1>
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
            {nav.map((item) => {
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

        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
