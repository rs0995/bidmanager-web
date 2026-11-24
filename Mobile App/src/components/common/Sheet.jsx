import React from 'react';
import { X } from 'lucide-react';

export function Sheet({ open, onClose, title, children, footer }) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-[90] bg-black/40" onClick={onClose} />
      <div
        className="sheet-in fixed left-0 right-0 bottom-0 z-[100] flex flex-col max-h-[85dvh] rounded-t-2xl pb-safe"
        style={{ background: 'var(--bg)', borderTop: '1px solid var(--border)' }}
      >
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="text-sm font-semibold">{title}</span>
          <button className="btn-ghost" style={{ minHeight: 0, padding: 4 }} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="overflow-auto flex-1 p-4">{children}</div>
        {footer && (
          <div className="p-4 flex gap-2" style={{ borderTop: '1px solid var(--border)' }}>
            {footer}
          </div>
        )}
      </div>
    </>
  );
}
