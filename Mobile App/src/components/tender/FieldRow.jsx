import React from 'react';

export function FieldRow({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex justify-between gap-3 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-sm font-medium text-right" style={{ maxWidth: '62%' }}>{value}</span>
    </div>
  );
}
