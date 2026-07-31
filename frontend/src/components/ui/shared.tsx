import React from 'react';
import {
  Clock, AlertTriangle, CheckCircle2, Activity, Eye, CircleDot,
  Calendar, Zap, Bell
} from 'lucide-react';
import { cn, timeRemaining } from '../../lib/utils';

// ── Badge ──────────────────────────────────────────────────────────────────

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

const badgeStyles: Record<BadgeVariant, string> = {
  default: 'bg-[var(--accent-bg)] text-[var(--accent)]',
  success: 'bg-emerald-500/15 text-emerald-400',
  warning: 'bg-amber-500/15 text-amber-400',
  danger: 'bg-rose-500/15 text-rose-400',
  info: 'bg-sky-500/15 text-sky-400',
  muted: 'bg-[var(--surface-2)] text-[var(--text-muted)]',
};

export function Badge({
  children, variant = 'default', className = '',
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap',
      badgeStyles[variant], className
    )}>
      {children}
    </span>
  );
}

// ── StatusBadge ────────────────────────────────────────────────────────────

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = status || 'Active';
  if (s === 'Active') return <Badge variant="success"><CircleDot size={10} /> Active</Badge>;
  if (s === 'AOC' || s === 'Concluded') return <Badge variant="muted"><CheckCircle2 size={10} /> {s}</Badge>;
  if (s === 'Cancelled' || s === 'Withdrawn' || s === 'Terminated') return <Badge variant="danger"><CheckCircle2 size={10} /> {s}</Badge>;
  if (s.includes('Evaluation') || s.includes('Technical')) return <Badge variant="info"><Activity size={10} /> {s}</Badge>;
  if (s.includes('Financial Bid')) return <Badge variant="warning"><Eye size={10} /> {s}</Badge>;
  return <Badge variant="muted">{s}</Badge>;
}

// ── TimeBadge ──────────────────────────────────────────────────────────────

export function TimeBadge({ dateStr }: { dateStr: string | null | undefined }) {
  const r = timeRemaining(dateStr);
  if (r.expired) return <Badge variant="danger"><Clock size={10} /> {r.text}</Badge>;
  if (r.urgent) return <Badge variant="warning"><AlertTriangle size={10} /> {r.text}</Badge>;
  if (r.text === '-') return <span className="text-[var(--text-muted)] text-xs">-</span>;
  return <span className="text-[var(--text-muted)] text-xs flex items-center gap-1"><Clock size={10} /> {r.text}</span>;
}

// ── Tooltip ────────────────────────────────────────────────────────────────

export function Tooltip({ children, text }: { children: React.ReactNode; text: string }) {
  return (
    <span className="relative group/tip inline-flex">
      {children}
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-xs bg-[var(--surface-3)] text-[var(--text)] rounded shadow-lg opacity-0 group-hover/tip:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
        {text}
      </span>
    </span>
  );
}

// ── EmptyState ─────────────────────────────────────────────────────────────

export function EmptyState({
  icon: Icon, title, description, action,
}: {
  icon: React.ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 opacity-60">
      <Icon size={48} strokeWidth={1} className="text-[var(--text-muted)] mb-4" />
      <p className="text-lg font-medium text-[var(--text)]">{title}</p>
      <p className="text-sm text-[var(--text-muted)] mt-1">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── NotificationIcon helper ────────────────────────────────────────────────

export function NotificationIcon({ type }: { type: string }) {
  const map: Record<string, { icon: React.ComponentType<any>; color: string }> = {
    closing: { icon: AlertTriangle, color: 'text-amber-400' },
    new: { icon: Zap, color: 'text-sky-400' },
    status: { icon: Activity, color: 'text-emerald-400' },
    prebid: { icon: Calendar, color: 'text-violet-400' },
    info: { icon: Bell, color: 'text-[var(--text-muted)]' },
  };
  const { icon: Ic, color } = map[type] || map.info;
  return <Ic size={16} className={cn('mt-0.5 shrink-0', color)} />;
}

// ── Spinner ────────────────────────────────────────────────────────────────

export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-20" />
      <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
