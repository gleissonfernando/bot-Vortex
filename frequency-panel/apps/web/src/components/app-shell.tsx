'use client';

import { BarChart3, LayoutDashboard, LogOut, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clearToken } from '@/lib/api';

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/members', label: 'Membros', icon: Users },
  { href: '/dashboard/members', label: 'Relatorios', icon: BarChart3 }
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
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-blue-400/10 bg-surface-900/95 p-5 lg:block">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 overflow-hidden rounded-lg border border-blue-400/20 bg-black">
            <img src="/vortex-logo.png" alt="Vortex" className="h-full w-full object-cover" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Vortex Frequency</h1>
            <p className="text-xs text-slate-400">Gestao de frequencia</p>
          </div>
        </div>

        <div className="mt-8 rounded-lg border border-white/5 bg-white/[0.03] p-3">
          <div className="flex items-center gap-2 text-sm text-slate-400">
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
                  active ? 'bg-blue-500/15 text-blue-200' : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
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
          className="absolute bottom-5 left-5 right-5 flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.07]"
        >
          <LogOut size={16} />
          Sair
        </button>
      </aside>

      <main className="lg:pl-72">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
