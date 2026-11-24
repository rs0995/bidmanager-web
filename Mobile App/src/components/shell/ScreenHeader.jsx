import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export function ScreenHeader({ title, back = false, actions }) {
  const navigate = useNavigate();
  return (
    <header
      className="sticky top-0 z-30 flex items-center gap-2 px-3 pt-safe"
      style={{ minHeight: 52, background: 'var(--surface-0)', borderBottom: '1px solid var(--border)' }}
    >
      {back && (
        <button className="btn-ghost" style={{ minHeight: 0, padding: 6 }} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={20} />
        </button>
      )}
      <h1 className="flex-1 min-w-0 truncate text-[15px] font-semibold m-0">{title}</h1>
      {actions}
    </header>
  );
}
