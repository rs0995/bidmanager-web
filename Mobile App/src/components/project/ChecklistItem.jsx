import React, { useRef } from 'react';
import { Paperclip, X, Check } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { attachFile, removeAttachment, getAttachedFile, toggleChecklistItem } from '../../lib/projects.js';

export function ChecklistItem({ item, onPreview }) {
  const fileInputRef = useRef(null);
  const hasFile = Boolean(item.attachment);
  const attachedThisSession = hasFile && Boolean(getAttachedFile(item.id));

  const onPick = (e) => {
    const file = e.target.files?.[0];
    if (file) attachFile(item.id, file);
    e.target.value = '';
  };

  return (
    <div
      className={cn('card p-3 mb-2 flex gap-3 items-start', hasFile && 'cursor-pointer')}
      style={hasFile ? { background: 'var(--surface-1)' } : undefined}
      onClick={() => { if (attachedThisSession) onPreview(item); }}
    >
      <span
        className="w-[18px] h-[18px] rounded-md border flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: item.done ? 'var(--ok)' : 'transparent', borderColor: item.done ? 'var(--ok)' : 'var(--border)' }}
      >
        {item.done && <Check size={12} color="#fff" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-sm font-medium">{item.name}</p>
        {item.note && <p className="m-0 mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>{item.note}</p>}
        {hasFile && (
          <div className="flex items-center gap-2 mt-1 text-xs flex-wrap" style={{ color: 'var(--accent)' }}>
            <Paperclip size={11} />
            <b className="truncate max-w-[150px]" style={{ fontWeight: 500 }}>{item.attachment.name}</b>
            {attachedThisSession
              ? <span style={{ color: 'var(--text-muted)' }}>tap to preview</span>
              : <span style={{ color: 'var(--text-muted)' }}>attached on another session/device</span>}
            <button
              className="font-semibold"
              style={{ color: 'var(--danger)' }}
              onClick={(e) => { e.stopPropagation(); removeAttachment(item.id); }}
            >
              Remove
            </button>
          </div>
        )}
      </div>
      <input ref={fileInputRef} type="file" hidden onChange={onPick} />
      <button
        className={cn('text-xs font-semibold px-2.5 py-1.5 rounded-lg flex-shrink-0')}
        style={{
          background: hasFile ? 'var(--good-bg, var(--accent-bg))' : 'var(--accent-bg)',
          color: hasFile ? 'var(--ok)' : 'var(--accent)',
        }}
        onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
      >
        {hasFile ? 'Attached' : 'Attach'}
      </button>
      {!hasFile && (
        <button
          className="text-xs px-1 flex-shrink-0"
          style={{ color: 'var(--text-muted)' }}
          onClick={(e) => { e.stopPropagation(); toggleChecklistItem(item.id, !item.done); }}
          aria-label="Toggle done"
        >
          {item.done ? <X size={14} /> : <Check size={14} />}
        </button>
      )}
    </div>
  );
}
