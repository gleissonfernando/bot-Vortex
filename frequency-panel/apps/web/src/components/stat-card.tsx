import type { LucideIcon } from 'lucide-react';

export function StatCard({
  label,
  value,
  helper,
  icon: Icon
}: {
  label: string;
  value: string | number;
  helper?: string;
  icon: LucideIcon;
}) {
  return (
    <div className="panel rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
          <strong className="mt-2 block text-2xl font-semibold text-white">{value}</strong>
        </div>
        <div className="rounded-lg border border-blue-400/20 bg-blue-500/10 p-2 text-blue-300">
          <Icon size={18} />
        </div>
      </div>
      {helper ? <p className="mt-3 text-sm text-slate-400">{helper}</p> : null}
    </div>
  );
}
