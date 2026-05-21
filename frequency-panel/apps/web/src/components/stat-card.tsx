import type { LucideIcon } from 'lucide-react';

export function StatCard({
  label,
  value,
  helper,
  icon: Icon,
  tone = 'blue'
}: {
  label: string;
  value: string | number;
  helper?: string;
  icon: LucideIcon;
  tone?: 'blue' | 'emerald' | 'rose' | 'violet';
}) {
  const toneClass = {
    blue: 'border-blue-300/15 bg-blue-400/10 text-blue-200',
    emerald: 'border-emerald-300/15 bg-emerald-400/10 text-emerald-200',
    rose: 'border-rose-300/15 bg-rose-400/10 text-rose-200',
    violet: 'border-violet-300/15 bg-violet-400/10 text-violet-200'
  }[tone];

  return (
    <div className="soft-panel rounded-lg p-4 transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.055]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <strong className="mt-2 block text-2xl font-semibold text-white">{value}</strong>
        </div>
        <div className={`rounded-lg border p-2 ${toneClass}`}>
          <Icon size={18} />
        </div>
      </div>
      {helper ? <p className="mt-3 text-sm text-slate-500">{helper}</p> : null}
    </div>
  );
}
