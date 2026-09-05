import React from 'react';
import { Button } from '../common/Button.jsx';
import { ProgressRing } from '../common/ProgressRing.jsx';
import { useRequestDownload } from '../../hooks/useDownload.js';
import { useToast } from '../feedback/ToastProvider.jsx';

export function RequestDownloadPanel({ tenderId }) {
  const { start, jobId, status, error, timedOut } = useRequestDownload(tenderId);
  const toast = useToast();

  const handleStart = async () => {
    try {
      await start();
    } catch (e) {
      toast?.push({ title: 'Could not start download', body: e?.message, type: 'error' });
    }
  };

  if (!jobId) {
    return (
      <div className="card p-4 flex flex-col items-center gap-2 text-center">
        <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
          No documents downloaded yet for this tender.
        </p>
        <Button onClick={handleStart}>Request download</Button>
      </div>
    );
  }

  if (status === 'failed' || timedOut) {
    return (
      <div className="card p-4 flex flex-col items-center gap-2 text-center">
        <p className="m-0 text-sm" style={{ color: 'var(--danger)' }}>
          {error || 'Download request timed out.'}
        </p>
        <Button variant="secondary" onClick={handleStart}>Try again</Button>
      </div>
    );
  }

  if (status === 'completed') return null; // documents list will now show results

  return (
    <div className="card p-4 flex items-center gap-3">
      <ProgressRing indeterminate size={32} />
      <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
        Fetching documents from the source portal… this can take a few minutes.
      </p>
    </div>
  );
}
