'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatSeconds } from '@/lib/format';
import type { FrequencyDay } from '@/lib/types';

export function PresenceChart({ data }: { data: FrequencyDay[] }) {
  const chartData = data.map((item) => ({
    date: String(item.date_key).slice(5, 10),
    horas: Number((Number(item.total_seconds || 0) / 3600).toFixed(2)),
    pontos: item.points || item.sessions || 0,
    totalSeconds: Number(item.total_seconds || 0)
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <AreaChart data={chartData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="presence" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--vx-primary)" stopOpacity={0.42} />
              <stop offset="95%" stopColor="var(--vx-primary)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--vx-border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: 'var(--vx-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: 'var(--vx-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{
              background: 'color-mix(in srgb, var(--vx-surface) 96%, transparent)',
              border: '1px solid color-mix(in srgb, var(--vx-primary) 18%, transparent)',
              borderRadius: 16,
              color: 'var(--vx-text)'
            }}
            formatter={(value, name, props) => {
              if (name === 'horas') return [formatSeconds(props.payload.totalSeconds), 'Tempo'];
              return [value, name];
            }}
          />
          <Area type="monotone" dataKey="horas" stroke="var(--vx-primary)" fill="url(#presence)" strokeWidth={2.4} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
