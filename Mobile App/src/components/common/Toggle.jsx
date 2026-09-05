import React from 'react';
import { cn } from '../../lib/cn.js';

export function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cn('toggle-switch', checked && 'toggle-switch-on')}
      onClick={() => onChange?.(!checked)}
    >
      <span className="toggle-thumb" />
    </button>
  );
}
