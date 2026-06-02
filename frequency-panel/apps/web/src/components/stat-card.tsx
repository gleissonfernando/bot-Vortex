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
    blue: 'border-sky-300/20 bg-sky-400/10 text-sky-100',
    emerald: 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100',
    rose: 'border-rose-300/20 bg-rose-400/10 text-rose-100',
    violet: 'border-violet-300/20 bg-violet-400/10 text-violet-100'
  }[tone];
  const glowClass = {
    blue: 'from-sky-400/18',
    emerald: 'from-emerald-400/18',
    rose: 'from-rose-400/18',
    violet: 'from-violet-400/18'
  }[tone];

  return (
    <div className="premium-card hover-glow group relative overflow-hidden rounded-2xl p-5">
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b ${glowClass} to-transparent opacity-70 transition duration-300 group-hover:opacity-100`} />
      <div className="flex items-start justify-between gap-3">
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
          <strong className="mt-2 block text-3xl font-semibold tracking-tight text-white">{value}</strong>
        </div>
        <div className={`relative rounded-2xl border p-2.5 shadow-lg shadow-black/10 ${toneClass}`}>
          <Icon size={18} />
        </div>
      </div>
      {helper ? (
        <div className="relative mt-4 flex items-center justify-between gap-3">
          <p className="text-sm text-slate-400">{helper}</p>
          <span className="rounded-full border border-emerald-300/15 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
            + ativo
          </span>
        </div>
      ) : null}
    </div>
  );
}
