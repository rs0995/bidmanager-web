import React from 'react';
import { cn } from '../../lib/cn.js';

const VARIANTS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  fbtnGhost: 'fbtn-ghost',
  fbtnAdd: 'fbtn-add',
  mini: 'mini-btn',
};

export function Button({ variant = 'primary', className, children, ...props }) {
  return (
    <button className={cn(VARIANTS[variant], className)} {...props}>
      {children}
    </button>
  );
}
