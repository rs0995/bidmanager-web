import React from 'react';
import { useNavigate } from 'react-router-dom';

export function StatCard({ icon: Icon, label, value, to, alert }) {
  const navigate = useNavigate();
  return (
    <button
      className="card p-3 text-left"
      style={{ border: alert ? '1px solid var(--warn)' : '1px solid var(--border)' }}
      onClick={() => to && navigate(to)}
    >
      <Icon size={16} style={{ color: 'var(--accent)' }} />
      <p className="m-0 mt-2 text-xl font-bold">{value}</p>
      <p className="m-0 text-[11px]" style={{ color: 'var(--text-muted)' }}>{label}</p>
    </button>
  );
}
