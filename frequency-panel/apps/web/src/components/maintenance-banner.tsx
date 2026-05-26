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
    <div className="fixed inset-0 z-50 grid place-items-center bg-surface-950/85 px-4 py-6 backdrop-blur-md" role="alertdialog" aria-modal="true">
      <section className="w-full max-w-lg rounded-lg border border-amber-300/30 bg-slate-950/95 p-6 text-center shadow-2xl shadow-black/50">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-lg border border-amber-300/35 bg-amber-400/15 text-amber-200 shadow-lg shadow-amber-950/30">
          <AlertTriangle size={32} />
        </div>

        <div className="mt-5 inline-flex rounded-full border border-amber-300/25 bg-amber-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-200">
          Manutencao ativa
        </div>

        <h2 className="mt-4 text-2xl font-semibold text-white">Sistema em manutencao</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-300">
          {status.message || 'O sistema esta em manutencao. Algumas funcoes podem ficar indisponiveis.'}
        </p>

        <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
          <div className="font-medium text-white">Aguarde a liberacao da equipe.</div>
          <div className="mt-1 text-xs text-slate-500">
            {status.since ? `Ativo desde ${formatDate(status.since)}` : 'O status atualiza automaticamente.'}
          </div>
        </div>
      </section>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'agora';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
