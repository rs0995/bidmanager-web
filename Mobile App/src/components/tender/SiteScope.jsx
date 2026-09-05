import React from 'react';
import { useWebsites } from '../../hooks/useWebsites.js';
import { cn } from '../../lib/cn.js';

// Horizontally-scrollable portal/website pills — exactly one scope is
// selected at a time (or "All"), matching the reference artifact's site
// scope row. Drives website_id on the Tenders/Organisations queries.
export function SiteScope({ websiteId, onChange }) {
  const { data: websites = [] } = useWebsites();

  return (
    <div className="flex gap-2 overflow-x-auto px-4 pb-2" style={{ scrollbarWidth: 'none' }}>
      <ScopeButton active={!websiteId} label="All" onClick={() => onChange('')} />
      {websites.map((site) => (
        <ScopeButton
          key={site.id}
          active={String(websiteId) === String(site.id)}
          label={site.name}
          onClick={() => onChange(String(site.id))}
        />
      ))}
    </div>
  );
}

function ScopeButton({ active, label, onClick }) {
  return (
    <button
      className={cn(
        'flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border',
        active ? 'font-semibold' : '',
      )}
      style={{
        background: active ? 'var(--accent-bg)' : 'var(--surface-1)',
        borderColor: active ? 'var(--accent)' : 'var(--border)',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
      }}
      onClick={onClick}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: active ? 'var(--accent)' : 'var(--text-muted)' }} />
      {label}
    </button>
  );
}
