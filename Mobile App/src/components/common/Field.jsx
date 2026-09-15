import React from 'react';
import { cn } from '../../lib/cn.js';

export function Field({ label, error, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      {label && <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>}
      {children}
      {error && <span className="text-xs" style={{ color: 'var(--danger)' }}>{error}</span>}
    </label>
  );
}

export function Input({ className, ...props }) {
  return <input className={cn('input-field', className)} {...props} />;
}

export function Select({ className, ...props }) {
  return <select className={cn('input-field', className)} {...props} />;
}
