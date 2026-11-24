import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, TriangleAlert, CheckCircle2, Info, Activity, Calendar, Zap, ChevronRight } from 'lucide-react';
import { ScreenHeader } from '../components/shell/ScreenHeader.jsx';
import { EmptyState } from '../components/feedback/EmptyState.jsx';
import { useAlerts, markRead, markAllRead } from '../lib/alerts.js';
import { cn } from '../lib/cn.js';

// Kinds align with the desktop Client UI's notification `type` set
// (status / prebid / new) plus this app's extra local sources
// (deadline / success). See Client UI/src/components/ui/shared.tsx.
// nicon variant (d/i/s/w) matches the reference artifact's icon-tint set.
const ICONS = {
  status: { icon: Activity, variant: 'i' },
  prebid: { icon: Calendar, variant: 'i' },
  new: { icon: Zap, variant: 'i' },
  deadline: { icon: Clock, variant: 'd' },
  warning: { icon: TriangleAlert, variant: 'w' },
  success: { icon: CheckCircle2, variant: 's' },
  sync: { icon: Info, variant: 'i' },
};

function relativeTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function AlertsScreen() {
  const alerts = useAlerts();
  const navigate = useNavigate();
  const hasUnread = alerts.some((a) => !a.read);

  const openAlert = (a) => {
    markRead(a.id);
    if (a.tenderId) navigate(`/tenders/${a.tenderId}`);
    else if (a.orgName) navigate(`/tenders/org/${encodeURIComponent(a.orgName)}?sort_by=published_date&sort_order=desc`);
  };

  return (
    <div>
      <ScreenHeader
        title="Alerts"
        actions={hasUnread && (
          <button className="text-xs font-semibold" style={{ color: 'var(--accent)', padding: 6, background: 'none', border: 'none', cursor: 'pointer' }} onClick={markAllRead}>
            Mark all read
          </button>
        )}
      />
      <div className="p-4">
        {alerts.length === 0 ? (
          <EmptyState icon={Info} title="No alerts yet" body="Sync, bookmark deadlines, and checklist progress will show up here." />
        ) : (
          <div className="panel" style={{ padding: 0 }}>
            {alerts.map((a) => {
              const meta = ICONS[a.kind] || ICONS.sync;
              const Icon = meta.icon;
              const navigable = Boolean(a.tenderId || a.orgName);
              return (
                <button
                  key={a.id}
                  className="nitem w-full text-left"
                  style={{ background: a.read ? undefined : 'var(--row-selected-bg)' }}
                  onClick={() => openAlert(a)}
                >
                  <span className={cn('nicon', meta.variant)}>
                    <Icon size={15} />
                  </span>
                  <div className="min-w-0 flex-1 flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="nmsg m-0">{a.message}</p>
                      <p className="ntime m-0">{relativeTime(a.at)}</p>
                    </div>
                    {navigable && <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                  </div>
                  {!a.read && <span className="unread" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
