import React from 'react';

export function ProgressRing({ pct = 0, size = 40, indeterminate = false, showLabel = false }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const color = indeterminate ? 'var(--accent)' : pct >= 1 ? 'var(--ok)' : pct >= 0.6 ? 'var(--accent)' : 'var(--warn)';
  return (
    <svg width={size} height={size} className={indeterminate ? 'animate-spin' : ''} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={4} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={indeterminate ? c * 0.75 : c * (1 - pct)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {showLabel && !indeterminate && (
        <text
          x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
          style={{ fontSize: size * 0.32, fontWeight: 700, fontFamily: '"IBM Plex Mono", monospace', fill: 'var(--text)' }}
        >
          {Math.round(pct * 100)}
        </text>
      )}
    </svg>
  );
}
