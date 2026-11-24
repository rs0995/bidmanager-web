import React from 'react';
import { Inbox } from 'lucide-react';

export function EmptyState({ icon: Icon = Inbox, title, body, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-8 py-16 text-center">
      <Icon size={32} style={{ color: 'var(--text-muted)' }} />
      <p className="m-0 text-sm font-semibold">{title}</p>
      {body && <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>{body}</p>}
      {action}
    </div>
  );
}
