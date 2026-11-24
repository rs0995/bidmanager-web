import React from 'react';
import { cn } from '../../lib/cn.js';

export function Chip({ active, children, ...props }) {
  return (
    <button className={cn('chip', active && 'chip-on')} {...props}>
      {children}
    </button>
  );
}
