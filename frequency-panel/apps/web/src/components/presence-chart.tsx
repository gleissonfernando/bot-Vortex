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
              <stop offset="5%" stopColor="#0b6bff" stopOpacity={0.55} />
              <stop offset="95%" stopColor="#0b6bff" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{
              background: '#07111f',
              border: '1px solid rgba(76,145,255,.25)',
              borderRadius: 8,
              color: '#fff'
            }}
            formatter={(value, name, props) => {
              if (name === 'horas') return [formatSeconds(props.payload.totalSeconds), 'Tempo'];
              return [value, name];
            }}
          />
          <Area type="monotone" dataKey="horas" stroke="#4aa3ff" fill="url(#presence)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
