import React from 'react';
import { Button } from '../common/Button.jsx';
import { ProgressRing } from '../common/ProgressRing.jsx';
import { useRequestDownload } from '../../hooks/useDownload.js';
import { useToast } from '../feedback/ToastProvider.jsx';

export function RequestDownloadPanel({ tender }) {
  const { start, starting, status, error } = useRequestDownload(tender);
  const toast = useToast();

  const handleStart = async () => {
    try {
      await start();
    } catch (e) {
      toast?.push({ title: 'Could not start download', body: e?.message, type: 'error' });
    }
  };

  if (status === 'failed') {
    return (
      <div className="card p-4 flex flex-col items-center gap-2 text-center">
        <p className="m-0 text-sm" style={{ color: 'var(--danger)' }}>{error || 'Download request failed.'}</p>
        <Button variant="secondary" onClick={handleStart} disabled={starting}>Try again</Button>
      </div>
    );
  }

  if (status === 'requested') {
    return (
      <div className="card p-4 flex items-center gap-3">
        <ProgressRing indeterminate size={32} />
        <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
          Fetching documents from the source portal… this can take a few minutes. You can leave this screen.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-4 flex flex-col items-center gap-2 text-center">
      <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
        No documents downloaded yet for this tender.
      </p>
      <Button onClick={handleStart} disabled={starting}>{starting ? 'Starting…' : 'Request download'}</Button>
    </div>
  );
}
