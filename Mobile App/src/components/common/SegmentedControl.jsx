import React from 'react';
import { cn } from '../../lib/cn.js';

export function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={cn(value === opt.value && 'on')}
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
