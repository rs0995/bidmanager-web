import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

// Full-screen overlay for an attached checklist file. Renders images/PDFs
// for real via an object URL; anything else gets an honest "no inline
// preview" placeholder rather than a fake render.
export function FilePreview({ file, onClose }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!file) { setUrl(null); return; }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!file) return null;

  const isImage = /^image\//.test(file.type) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

  return (
    <div className="fixed inset-0 z-[150] flex flex-col" style={{ background: 'var(--bg)' }}>
      <div className="flex items-center justify-between px-4 py-3 pt-safe" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-0)' }}>
        <span className="text-sm font-medium truncate">{file.name}</span>
        <button className="btn-ghost" style={{ minHeight: 0, padding: 6 }} onClick={onClose}><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        {isImage && url && <img src={url} alt={file.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
        {isPdf && url && <iframe title={file.name} src={url} style={{ width: '100%', height: '100%', border: 0, background: '#fff' }} />}
        {!isImage && !isPdf && (
          <div className="card p-6 text-center max-w-xs">
            <p className="m-0 text-sm font-medium mb-1">{file.name}</p>
            <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
              No inline preview for this file type. Use "Attach" again to replace it, or open it from your device's Downloads/Files app.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
