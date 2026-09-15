import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Sun, Moon, Monitor, LogOut, RefreshCw, Wifi, WifiOff, Download, FileSpreadsheet, ClipboardList, Fingerprint, Bell, Trash2 } from 'lucide-react';
import { ScreenHeader } from '../components/shell/ScreenHeader.jsx';
import { Field, Input } from '../components/common/Field.jsx';
import { Button } from '../components/common/Button.jsx';
import { SegmentedControl } from '../components/common/SegmentedControl.jsx';
import { Sheet } from '../components/common/Sheet.jsx';
import { Toggle } from '../components/common/Toggle.jsx';
import { useToast } from '../components/feedback/ToastProvider.jsx';
import { useTheme } from '../hooks/useTheme.js';
import { api } from '../lib/api.js';
import { getUser, clearSession } from '../lib/auth.js';
import { useSettings, setSettings } from '../lib/store.js';
import { syncNow } from '../lib/sync.js';
import { exportTendersCsv } from '../lib/exportCsv.js';
import { isAppLockAvailable, isAppLockEnabled, enableAppLock, disableAppLock } from '../lib/appLock.js';
import { requestNotificationPermission, canNotify, startDeadlineChecks, stopDeadlineChecks } from '../lib/deadlineCheck.js';
import { useActiveDownloads } from '../lib/documents.js';
import { clearLocalCache } from '../lib/localCache.js';

function relativeTime(iso) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)}h ago`;
}

function MoreRow({ icon: Icon, label, value, onClick, disabled }) {
  return (
    <button className="mrow" style={{ opacity: disabled ? 0.5 : 1 }} onClick={onClick} disabled={disabled}>
      <span className="mic"><Icon size={15} /></span>
      <span className="mlabel">{label}</span>
      {value && <span className="mval">{value}</span>}
    </button>
  );
}

export function MoreScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const user = getUser();
  const { lastSyncAt, deadlineRemindersOn } = useSettings();
  const [pwOpen, setPwOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '' });
  const [lockAvailable, setLockAvailable] = useState(false);
  const activeDownloads = useActiveDownloads();
  const [lockEnabled, setLockEnabled] = useState(isAppLockEnabled());
  const [confirmClearCache, setConfirmClearCache] = useState(false);

  useEffect(() => { isAppLockAvailable().then(setLockAvailable); }, []);

  useEffect(() => {
    if (deadlineRemindersOn) {
      startDeadlineChecks((id) => api.tender(id));
    } else {
      stopDeadlineChecks();
    }
    return stopDeadlineChecks;
  }, [deadlineRemindersOn]);

  const health = useQuery({ queryKey: ['health-check'], queryFn: api.health, enabled: false, retry: 0 });

  const sync = useMutation({
    mutationFn: syncNow,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tenders'] }); queryClient.invalidateQueries({ queryKey: ['stats'] }); toast?.push({ title: 'Synced' }); },
    onError: (e) => toast?.push({ title: 'Sync failed', body: e?.message, type: 'error' }),
  });

  const exportCsv = useMutation({
    mutationFn: () => exportTendersCsv({ archived: false }),
    onSuccess: (count) => toast?.push({ title: 'Exported', body: `${count} tenders exported as CSV.` }),
    onError: (e) => toast?.push({ title: 'Export failed', body: e?.message, type: 'error' }),
  });

  const changePassword = useMutation({
    mutationFn: () => api.changePassword(pwForm),
    onSuccess: () => { toast?.push({ title: 'Password changed' }); setPwOpen(false); setPwForm({ current_password: '', new_password: '' }); },
    onError: (e) => toast?.push({ title: 'Could not change password', body: e?.message, type: 'error' }),
  });

  const signOut = useMutation({
    mutationFn: () => api.logout().catch(() => {}),
    onSettled: () => { clearSession(); queryClient.clear(); navigate('/signin', { replace: true }); },
  });

  const handleClearCache = () => {
    clearLocalCache();
    // A full reload re-initializes every module's in-memory cache from the
    // now-cleared localStorage, and RequireAuth's mount effect re-syncs
    // bookmarks/projects from the server — simpler and more reliable than
    // trying to reset every lib/*.js module's live state in place.
    window.location.reload();
  };

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

  const toggleAppLock = async (next) => {
    try {
      if (next) { await enableAppLock(); setLockEnabled(true); toast?.push({ title: 'App lock enabled' }); }
      else { disableAppLock(); setLockEnabled(false); toast?.push({ title: 'App lock disabled' }); }
    } catch (e) {
      toast?.push({ title: 'Could not set up app lock', body: e?.message, type: 'error' });
    }
  };

  return (
    <div>
      <ScreenHeader title="More" />
      <div className="p-4">
        <p className="statusline mb-3">
          Cloud feed <b>{health.data?.status === 'ok' ? '● reachable' : health.isFetched ? '○ unreachable' : ''}</b>
          {' '}· Sync, connection &amp; workspace
        </p>

        <div className="mgroup">
          <MoreRow icon={RefreshCw} label="Sync tenders" value={sync.isPending ? 'Syncing…' : relativeTime(lastSyncAt)} onClick={() => sync.mutate()} disabled={sync.isPending} />
          <MoreRow
            icon={health.data?.status === 'ok' ? Wifi : WifiOff}
            label="Connection"
            value={health.isFetching ? 'Checking…' : health.data?.status === 'ok' ? 'reachable' : health.isFetched ? 'unreachable' : 'tap to check'}
            onClick={() => health.refetch()}
          />
          <MoreRow icon={Download} label="Downloads" value={activeDownloads.length ? `${activeDownloads.length} in progress` : '›'} onClick={() => navigate('/downloads')} />
        </div>

        <div className="mgroup">
          <MoreRow icon={FileSpreadsheet} label="Export tenders (CSV)" value={exportCsv.isPending ? 'Exporting…' : '›'} onClick={() => exportCsv.mutate()} disabled={exportCsv.isPending} />
          <MoreRow icon={ClipboardList} label="Checklist templates" value="Coming soon" onClick={() => toast?.push({ title: 'Coming soon', body: 'Checklist templates are managed on the desktop app for now.' })} disabled />
          {lockAvailable && (
            <div className="toggle-row" style={{ border: 'none', borderRadius: 0, marginBottom: 0 }}>
              <h4 className="m-0">
                <span className="mic" style={{ display: 'inline-flex', marginRight: 8, verticalAlign: -6 }}><Fingerprint size={15} /></span>
                App lock
              </h4>
              <Toggle checked={lockEnabled} onChange={toggleAppLock} />
            </div>
          )}
          <div className="toggle-row" style={{ border: 'none', borderRadius: 0, marginBottom: 0 }}>
            <div>
              <h4 className="m-0">
                <span className="mic" style={{ display: 'inline-flex', marginRight: 8, verticalAlign: -6 }}><Bell size={15} /></span>
                Deadline reminders
              </h4>
              <p>On-device notifications at 72h, 24h &amp; 3h before close (while the app is open)</p>
            </div>
            <Toggle checked={Boolean(deadlineRemindersOn)} onChange={toggleReminders} />
          </div>
        </div>

        <div className="card p-3 mb-3">
          <p className="m-0 text-sm font-medium">{user?.display_name || user?.email || 'Signed in'}</p>
          {user?.email && <p className="m-0 text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{user.email}</p>}
          <div className="flex gap-2 mt-2">
            <Button variant="secondary" className="flex-1" onClick={() => setPwOpen(true)}>Change password</Button>
            <Button variant="danger" className="flex-1" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
              <LogOut size={14} /> Sign out
            </Button>
          </div>
        </div>

        <div className="mgroup">
          <MoreRow icon={Trash2} label="Clear local cache" value="›" onClick={() => setConfirmClearCache(true)} />
        </div>

        <section className="mb-2">
          <p className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Appearance</p>
          <SegmentedControl
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'dark', label: 'Dark', icon: Moon },
              { value: 'light', label: 'Light', icon: Sun },
              { value: 'system', label: 'System', icon: Monitor },
            ]}
          />
        </section>

        <p className="statusline mt-4">
          Bookmarks and projects sync to your account. Attached documents and app-lock stay on this device only.
        </p>
      </div>

      <Sheet
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        title="Change password"
        footer={<Button className="flex-1" onClick={() => changePassword.mutate()} disabled={changePassword.isPending}>Save</Button>}
      >
        <div className="flex flex-col gap-3">
          <Field label="Current password">
            <Input type="password" value={pwForm.current_password} onChange={(e) => setPwForm((p) => ({ ...p, current_password: e.target.value }))} />
          </Field>
          <Field label="New password">
            <Input type="password" value={pwForm.new_password} onChange={(e) => setPwForm((p) => ({ ...p, new_password: e.target.value }))} />
          </Field>
        </div>
      </Sheet>

      <Sheet
        open={confirmClearCache}
        onClose={() => setConfirmClearCache(false)}
        title="Clear local cache?"
        footer={(
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmClearCache(false)}>Cancel</Button>
            <Button variant="danger" className="flex-1" onClick={handleClearCache}>Clear cache</Button>
          </>
        )}
      >
        <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
          Removes downloaded document info, alerts, and other data cached on this device, then reloads.
          Nothing is deleted from your account — bookmarks and projects are re-synced from the cloud right after.
        </p>
      </Sheet>

    </div>
  );
}
