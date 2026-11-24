import React from 'react';

export function FieldRow({ label, value, stacked }) {
  if (value == null || value === '') return null;

  if (stacked) {
    // Label-above-value — fits a narrow grid column (e.g. two FieldRows
    // side by side in a 2-col detail grid) without the label and the next
    // column's content running together.
    return (
      <div className="py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
        <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
        <p className="m-0 mt-1 text-sm font-medium">{value}</p>
      </div>
    );
  }

  return (
    <div className="flex justify-between gap-3 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-sm font-medium text-right" style={{ maxWidth: '62%' }}>{value}</span>
    </div>
  );
}
