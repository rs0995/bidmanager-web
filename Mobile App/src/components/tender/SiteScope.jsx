import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useWebsites } from '../../hooks/useWebsites.js';

const LAST_NAME_KEY = 'bm.tendersLastWebsiteName';

// A single mandatory portal/website selection — no "All" option, since every
// tender/organisation query needs exactly one website_id. A themed dropdown
// rather than a native <select>, since the browser/OS renders a native
// select's popup outside our CSS variables (unstyled, off-theme).
export function SiteScope({ websiteId, onChange }) {
  const { data: websites = [] } = useWebsites();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!websiteId && websites.length > 0) onChange(String(websites[0].id));
  }, [websiteId, websites, onChange]);

  const selected = websites.find((site) => String(site.id) === String(websiteId));

  useEffect(() => {
    if (selected?.name) localStorage.setItem(LAST_NAME_KEY, selected.name);
  }, [selected?.name]);

  // The website list is fetched over the network (paginated /client/organizations
  // scan) and can take a moment; rather than rendering nothing until it resolves
  // (which made the whole Portal row pop in and feel laggy), show the last known
  // portal name from localStorage as a placeholder so the control never disappears.
  const displayName = selected?.name || (websites.length === 0 ? localStorage.getItem(LAST_NAME_KEY) : null);

  if (websites.length === 0 && !displayName) return null;

  return (
    <div className="px-4 pb-2">
      <div className="scope-label">Portal</div>
      <button type="button" className="input-field flex items-center justify-between" onClick={() => websites.length > 0 && setOpen((v) => !v)}>
        {displayName || 'Select portal'}
        <ChevronDown size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      </button>
      {open && (
        <div className="fmenu" style={{ marginTop: 6 }}>
          {websites.map((site) => (
            <button
              key={site.id}
              className="fmo"
              onClick={() => { onChange(String(site.id)); setOpen(false); }}
            >
              {site.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
