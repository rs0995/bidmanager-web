import React from 'react';

export function Field({ label, error, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      {label && <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>}
      {children}
      {error && <span className="text-xs" style={{ color: 'var(--danger)' }}>{error}</span>}
    </label>
  );
}

export function Input(props) {
  return <input className="input-field" {...props} />;
}

export function Select(props) {
  return <select className="input-field" {...props} />;
}
