import React from 'react';
import { useNavigate } from 'react-router-dom';

export function StatCard({ label, value, to, icon: Icon, variant = 'accent', alert }) {
  const navigate = useNavigate();
  return (
    <button
      className="tile"
      style={{ borderColor: alert ? 'var(--warn)' : undefined }}
      onClick={() => to && navigate(to, { state: { fromCard: true } })}
    >
      {Icon && (
        <span className={`tile-icon ${variant}`}>
          <Icon size={17} />
        </span>
      )}
      <div className="n">{value}</div>
      <div className="l">{label}</div>
    </button>
  );
}
