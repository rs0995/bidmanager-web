import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

// Mints a fresh signed URL on every tap — never cache it, it expires in
// ~15 minutes. window.location.assign (not an <a download>) because a
// cross-origin download attribute is unreliable in mobile Safari.
export function useDocumentDownload() {
  const [pendingId, setPendingId] = useState(null);
  const download = useCallback(async (tenderId, doc) => {
    setPendingId(doc.id);
    try {
      const { url } = await api.downloadRequest(tenderId, doc.id);
      window.location.assign(url);
    } finally {
      setPendingId(null);
    }
  }, []);
  return { download, pendingId };
}

const MAX_ATTEMPTS = 40; // ~40 * 15s ≈ 10 minutes

// Drives the "Request Download" flow for a tender with no documents yet:
// start the server-side scrape job, then poll its status until it resolves.
export function useRequestDownload(tenderId) {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const start = useCallback(async () => {
    const { job_id } = await api.requestDownloadJob(tenderId);
    setJobId(job_id);
    setAttempt(0);
  }, [tenderId]);

  const statusQuery = useQuery({
    queryKey: ['downloadStatus', tenderId, jobId],
    queryFn: () => api.downloadStatus(tenderId, jobId),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'completed' || status === 'failed' || attempt >= MAX_ATTEMPTS) return false;
      return 12_000;
    },
  });

  const status = statusQuery.data?.status;
  if (status === 'completed' && jobId) {
    queryClient.invalidateQueries({ queryKey: ['tenderDocuments', Number(tenderId)] });
  }

  return {
    start,
    jobId,
    status,
    error: statusQuery.data?.error,
    timedOut: attempt >= MAX_ATTEMPTS && status !== 'completed' && status !== 'failed',
  };
}
