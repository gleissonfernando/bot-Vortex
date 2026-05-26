'use client';

import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL } from '@/lib/api';

type MaintenanceStatus = {
  enabled: boolean;
  message?: string | null;
  since?: string | null;
  by?: string | null;
};

type MaintenanceResponse = {
  ok: boolean;
  maintenance?: MaintenanceStatus;
};

export function MaintenanceBanner() {
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch(`${API_URL}/status/maintenance`, { cache: 'no-store' });
        const data = (await response.json()) as MaintenanceResponse;
        if (active && response.ok && data.ok) setStatus(data.maintenance || null);
      } catch {
        if (active) setStatus(null);
      }
    }

    load();
    const interval = window.setInterval(load, 15000);
    window.addEventListener('vortex-maintenance-updated', load);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('vortex-maintenance-updated', load);
    };
  }, []);

  if (!status?.enabled) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 border-b border-amber-300/25 bg-amber-500/95 px-4 py-3 text-slate-950 shadow-lg shadow-black/30">
      <div className="mx-auto flex max-w-7xl flex-col gap-1 sm:flex-row sm:items-center sm:justify-center sm:gap-3">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle size={18} />
          <span>Sistema em manutencao</span>
        </div>
        <p className="text-sm font-medium">
          {status.message || 'O sistema esta em manutencao. Algumas funcoes podem ficar indisponiveis.'}
        </p>
      </div>
    </div>
  );
}
