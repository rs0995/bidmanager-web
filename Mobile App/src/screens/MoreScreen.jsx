import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Sun, Moon, Monitor, LogOut, RefreshCw, Wifi, WifiOff, Download, FileSpreadsheet, ClipboardList, Fingerprint } from 'lucide-react';
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
import { useSettings } from '../lib/store.js';
import { syncNow } from '../lib/sync.js';
import { exportTendersCsv } from '../lib/exportCsv.js';
import { isAppLockAvailable, isAppLockEnabled, enableAppLock, disableAppLock } from '../lib/appLock.js';

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
  const { lastSyncAt } = useSettings();
  const [pwOpen, setPwOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '' });
  const [downloadsInfoOpen, setDownloadsInfoOpen] = useState(false);
  const [lockAvailable, setLockAvailable] = useState(false);
  const [lockEnabled, setLockEnabled] = useState(isAppLockEnabled());

  useEffect(() => { isAppLockAvailable().then(setLockAvailable); }, []);

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
        <p className="m-0 mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>Sync, connection &amp; workspace</p>

        <div className="card p-1 mb-3">
          <MoreRow icon={RefreshCw} label="Sync tenders" value={sync.isPending ? 'Syncing…' : relativeTime(lastSyncAt)} onClick={() => sync.mutate()} disabled={sync.isPending} />
          <MoreRow
            icon={health.data?.status === 'ok' ? Wifi : WifiOff}
            label="Connection"
            value={health.isFetching ? 'Checking…' : health.data?.status === 'ok' ? 'reachable' : health.isFetched ? 'unreachable' : 'tap to check'}
            onClick={() => health.refetch()}
          />
          <MoreRow icon={Download} label="Downloads" value="›" onClick={() => setDownloadsInfoOpen(true)} />
        </div>

        <div className="card p-1 mb-3">
          <MoreRow icon={FileSpreadsheet} label="Export tenders (CSV)" value={exportCsv.isPending ? 'Exporting…' : '›'} onClick={() => exportCsv.mutate()} disabled={exportCsv.isPending} />
          <MoreRow icon={ClipboardList} label="Checklist templates" value="Coming soon" onClick={() => toast?.push({ title: 'Coming soon', body: 'Checklist templates are managed on the desktop app for now.' })} disabled />
          {lockAvailable && (
            <div className="mrow" style={{ cursor: 'default' }}>
              <span className="mic"><Fingerprint size={15} /></span>
              <span className="mlabel">App lock</span>
              <Toggle checked={lockEnabled} onChange={toggleAppLock} />
            </div>
          )}
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

        <p className="text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
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

      <Sheet open={downloadsInfoOpen} onClose={() => setDownloadsInfoOpen(false)} title="Downloads">
        <p className="m-0 text-sm" style={{ lineHeight: 1.6 }}>
          Documents you download save to your browser's own Downloads location — there's no in-app folder picker on
          mobile web (unlike the desktop app, which lets you choose a project folder).
        </p>
      </Sheet>
    </div>
  );
}
