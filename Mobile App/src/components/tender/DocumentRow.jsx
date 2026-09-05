import React from 'react';
import { FileText, Download, Loader2 } from 'lucide-react';
import { formatBytes, formatDate } from '../../lib/format.js';
import { useDocumentDownload } from '../../hooks/useDownload.js';

export function DocumentRow({ tenderId, doc }) {
  const { download, pendingId } = useDocumentDownload();
  const pending = pendingId === doc.id;

  return (
    <div className="flex items-center gap-3 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
      <FileText size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-sm truncate">{doc.name}</p>
        <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
          {doc.type} · {formatBytes(doc.size_bytes)} · {formatDate(doc.downloaded_at)}
        </p>
      </div>
      <button
        className="btn-ghost"
        style={{ minHeight: 0, padding: 8 }}
        disabled={!doc.downloadable || pending}
        onClick={() => download(tenderId, doc)}
        aria-label="Download"
      >
        {pending ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
      </button>
    </div>
  );
}
