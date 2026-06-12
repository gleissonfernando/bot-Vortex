import type { LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';

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
    blue: 'bg-blue-400/10 text-blue-100',
    emerald: 'bg-emerald-400/10 text-emerald-100',
    rose: 'bg-rose-400/10 text-rose-100',
    violet: 'bg-violet-400/10 text-violet-100'
  }[tone];
  const accent = {
    blue: 'linear-gradient(90deg, #3b82f6, #22d3ee)',
    emerald: 'linear-gradient(90deg, #10b981, #34d399)',
    rose: 'linear-gradient(90deg, #f43f5e, #fb7185)',
    violet: 'linear-gradient(90deg, #8b5cf6, #c084fc)'
  }[tone];

  return (
    <article
      className="metric-card hover-glow group p-5"
      style={{ '--metric-accent': accent } as CSSProperties}
    >
      <div className="flex h-full flex-col justify-between gap-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-300">{label}</p>
            <strong className="mt-2 block truncate text-4xl font-semibold text-white">{value}</strong>
          </div>
          <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-lg ${toneClass} shadow-lg shadow-black/10`}>
            <Icon size={23} />
          </div>
        </div>
        {helper ? <p className="text-sm text-slate-500">{helper}</p> : null}
      </div>
    </article>
  );
}
