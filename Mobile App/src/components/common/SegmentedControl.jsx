import React from 'react';
import { cn } from '../../lib/cn.js';

export function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="segmented">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={cn('segmented-item', value === opt.value && 'segmented-item-active')}
          onClick={() => onChange(opt.value)}
          type="button"
        >
          {opt.icon && <opt.icon size={14} />}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
