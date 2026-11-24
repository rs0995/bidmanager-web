import React from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '../common/Button.jsx';

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center">
      <TriangleAlert size={32} style={{ color: 'var(--danger)' }} />
      <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
        {message || 'Something went wrong.'}
      </p>
      {onRetry && <Button variant="secondary" onClick={onRetry}>Retry</Button>}
    </div>
  );
}
