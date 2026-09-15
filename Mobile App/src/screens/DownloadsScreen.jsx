import React from 'react';
import { Loader2, CheckCircle2, TriangleAlert } from 'lucide-react';
import { ScreenHeader } from '../components/shell/ScreenHeader.jsx';
import { EmptyState } from '../components/feedback/EmptyState.jsx';
import { useAllDownloads } from '../lib/documents.js';
import { DownloadCloud } from 'lucide-react';

const META = {
  requested: { icon: Loader2, spin: true, label: 'Requested…', color: 'var(--accent)' },
  downloading: { icon: Loader2, spin: true, label: 'Downloading…', color: 'var(--accent)' },
  downloaded: { icon: CheckCircle2, label: 'Ready', color: 'var(--ok)' },
  failed: { icon: TriangleAlert, label: 'Failed', color: 'var(--danger)' },
};

function relativeTime(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function DownloadsScreen() {
  const rows = useAllDownloads();

  return (
    <div>
      <ScreenHeader title="Downloads" back />
      <div className="p-4">
        {rows.length === 0 ? (
          <EmptyState icon={DownloadCloud} title="No downloads yet" body="Request or download tender documents and they'll show up here." />
        ) : (
          <div className="card p-1">
            {rows.map((d) => {
              const meta = META[d.client_status] || META.requested;
              const Icon = meta.icon;
              return (
                <div key={d.id} className="flex items-start gap-3 p-3" style={{ borderBottom: '1px solid var(--border)' }}>
                  <Icon size={16} className={meta.spin ? 'animate-spin' : ''} style={{ color: meta.color, flexShrink: 0, marginTop: 2 }} />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-sm truncate">{d.tender_title || d.tender_id || 'Untitled tender'}</p>
                    <p className="m-0 text-xs truncate" style={{ color: 'var(--text-muted)' }}>{d.file_name || 'All documents'}</p>
                    {d.client_status === 'failed' && d.error && (
                      <p className="m-0 text-xs truncate" style={{ color: 'var(--danger)' }}>{d.error}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end flex-shrink-0">
                    <span className="text-xs font-medium" style={{ color: meta.color }}>{meta.label}</span>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {relativeTime(d.downloaded_at || d.requested_at || d.updated_at)}
                    </span>
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
