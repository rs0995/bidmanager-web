import React from 'react';
import { FileText, Download, Loader2, CheckCircle2, TriangleAlert } from 'lucide-react';
import { formatBytes, formatDate } from '../../lib/format.js';
import { useDocumentDownload } from '../../hooks/useDownload.js';
import { useDocumentsForTender } from '../../lib/documents.js';
import { useToast } from '../feedback/ToastProvider.jsx';

export function DocumentRow({ tenderId, doc }) {
  const toast = useToast();
  const { download, pendingId } = useDocumentDownload(
    (e) => toast?.push({ title: 'Download failed', body: e?.message, type: 'error' }),
  );
  const cacheRows = useDocumentsForTender(tenderId);
  const cached = cacheRows.find((r) => r.id === doc.id);
  const status = pendingId === doc.id ? 'downloading' : (cached?.client_status || 'synced');

  const disabled = doc.downloadable === false || status === 'downloading';

  let icon = <Download size={16} />;
  let iconColor;
  if (status === 'downloading') icon = <Loader2 size={16} className="animate-spin" />;
  else if (status === 'downloaded') { icon = <CheckCircle2 size={16} />; iconColor = 'var(--ok)'; }
  else if (status === 'failed') { icon = <TriangleAlert size={16} />; iconColor = 'var(--danger)'; }

  return (
    <div className="doc">
      <span className="di"><FileText size={13} style={{ color: 'var(--accent)' }} /></span>
      <div className="min-w-0">
        <p className="dn m-0">{doc.name}</p>
        <p className="dm m-0" style={{ color: status === 'failed' ? 'var(--danger)' : undefined }}>
          {status === 'failed' && cached?.error
            ? cached.error
            : `${doc.type} · ${formatBytes(doc.size_bytes)} · ${formatDate(doc.downloaded_at)}`}
        </p>
      </div>
      <button
        style={{ color: iconColor, background: 'none', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', padding: 4 }}
        disabled={disabled}
        onClick={() => download(tenderId, doc)}
        aria-label={status === 'failed' ? 'Retry download' : status === 'downloaded' ? 'Download again' : 'Download'}
      >
        {icon}
      </button>
    </div>
  );
}
