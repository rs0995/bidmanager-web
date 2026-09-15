import React, { useRef, useState } from 'react';
import { Paperclip, Check, X } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { attachFile, removeAttachment, getAttachedFile, deleteChecklistItem } from '../../lib/projects.js';
import { Sheet } from '../common/Sheet.jsx';
import { Button } from '../common/Button.jsx';

export function ChecklistItem({ item, onPreview }) {
  const fileInputRef = useRef(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hasFile = Boolean(item.attachment);
  const done = item.status === 'Completed';
  const attachedThisSession = hasFile && Boolean(getAttachedFile(item.id));

  const onPick = (e) => {
    const file = e.target.files?.[0];
    if (file) attachFile(item.id, file);
    e.target.value = '';
  };

  return (
    <div
      className={cn('citem', done && 'done', hasFile && 'has-file', attachedThisSession && 'tap')}
      onClick={() => { if (attachedThisSession) onPreview(item); }}
    >
      <span className="box" aria-label={done ? 'Completed' : 'Pending'}>
        {done && <Check size={12} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="cname m-0">{item.req_file_name}</p>
        {item.description && <p className="cdesc m-0">{item.description}</p>}
        {hasFile && (
          <div className="cfile">
            <Paperclip size={11} />
            <b>{item.attachment.name}</b>
            {attachedThisSession
              ? <span style={{ color: 'var(--text-muted)' }}>tap to preview</span>
              : <span style={{ color: 'var(--text-muted)' }}>attached on another session/device</span>}
            <button onClick={(e) => { e.stopPropagation(); removeAttachment(item.id); }}>
              Remove
            </button>
          </div>
        )}
      </div>
      <input ref={fileInputRef} type="file" hidden onChange={onPick} />
      <button
        className={cn('cattach', hasFile && 'on')}
        onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
      >
        {hasFile ? 'Attached' : 'Attach'}
      </button>
      <button
        className="flex-shrink-0"
        style={{ color: 'var(--danger)', padding: 4, background: 'none', border: 'none', cursor: 'pointer' }}
        onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
        aria-label="Delete item"
      >
        <X size={16} />
      </button>

      <Sheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete checklist item?"
        footer={(
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" className="flex-1" onClick={() => { deleteChecklistItem(item.id); setConfirmDelete(false); }}>Delete</Button>
          </>
        )}
      >
        <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
          "{item.req_file_name}" and its attachment (if any) will be removed from this device and the next sync. This can't be undone.
        </p>
      </Sheet>
    </div>
  );
}
