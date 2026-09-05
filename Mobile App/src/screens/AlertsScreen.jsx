import React, { useEffect } from 'react';
import { Clock, TriangleAlert, CheckCircle2, Info } from 'lucide-react';
import { ScreenHeader } from '../components/shell/ScreenHeader.jsx';
import { Toggle } from '../components/common/Toggle.jsx';
import { EmptyState } from '../components/feedback/EmptyState.jsx';
import { useAlerts, markAllRead } from '../lib/alerts.js';
import { useSettings, setSettings } from '../lib/store.js';
import { requestNotificationPermission, canNotify, startDeadlineChecks, stopDeadlineChecks } from '../lib/deadlineCheck.js';
import { api } from '../lib/api.js';
import { useToast } from '../components/feedback/ToastProvider.jsx';

const ICONS = {
  deadline: { icon: Clock, bg: 'var(--danger-bg)', color: 'var(--danger)' },
  warning: { icon: TriangleAlert, bg: 'var(--warn-wash, var(--accent-bg))', color: 'var(--warn)' },
  success: { icon: CheckCircle2, bg: 'var(--accent-bg)', color: 'var(--ok)' },
  sync: { icon: Info, bg: 'var(--accent-bg)', color: 'var(--accent)' },
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
  const { deadlineRemindersOn } = useSettings();
  const toast = useToast();

  useEffect(() => { markAllRead(); }, []);

  useEffect(() => {
    if (deadlineRemindersOn) {
      startDeadlineChecks((id) => api.tender(id));
    } else {
      stopDeadlineChecks();
    }
    return stopDeadlineChecks;
  }, [deadlineRemindersOn]);

  const toggleReminders = async (next) => {
    if (next) {
      const granted = canNotify() ? await requestNotificationPermission() : false;
      setSettings({ deadlineRemindersOn: true });
      if (!granted) {
        toast?.push({ title: 'Reminders on', body: 'Notifications aren’t available here — you’ll still see alerts in this list while the app is open.', type: 'info' });
      }
    } else {
      setSettings({ deadlineRemindersOn: false });
    }
  };

  return (
    <div>
      <ScreenHeader title="Alerts" />
      <div className="p-4">
        <p className="m-0 mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          Local deadline reminders &amp; what changed on the last sync
        </p>
        <div className="card p-3.5 flex items-center justify-between gap-3 mb-4">
          <div>
            <p className="m-0 text-sm font-semibold">Deadline reminders</p>
            <p className="m-0 mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              On-device notifications at 72h, 24h &amp; 3h before close (while the app is open)
            </p>
          </div>
          <Toggle checked={Boolean(deadlineRemindersOn)} onChange={toggleReminders} />
        </div>

        {alerts.length === 0 ? (
          <EmptyState icon={Info} title="No alerts yet" body="Sync, bookmark deadlines, and checklist progress will show up here." />
        ) : (
          <div className="card p-1">
            {alerts.map((a) => {
              const meta = ICONS[a.kind] || ICONS.sync;
              const Icon = meta.icon;
              return (
                <div key={a.id} className="flex gap-3 p-3" style={{ borderBottom: '1px solid var(--border)' }}>
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: meta.bg }}>
                    <Icon size={15} style={{ color: meta.color }} />
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 text-sm leading-snug">{a.message}</p>
                    <p className="m-0 mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>{relativeTime(a.at)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
