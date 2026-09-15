import React, { useState, useEffect } from 'react';
import { Search, Plus, Star, X } from 'lucide-react';
import { CustomFilterMenu, customFilterLabel } from './CustomFilterMenu.jsx';

const MAX_CUSTOM = 2;

export function TenderFilterBar({ q, onSearch, bookmarkedOnly, onToggleBookmarked, closingSoon, onToggleClosingSoon, customFilters, onAddCustom, onRemoveCustom, rows, onOpenAdvanced }) {
  const [text, setText] = useState(q || '');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { if (text !== (q || '')) onSearch(text); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className="px-4 pt-3 pb-2" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-0)' }}>
      <div className="search">
        <Search size={15} style={{ color: 'var(--text-muted)' }} />
        <input
          placeholder="Search title, org, tender ID"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="filters">
        <button className={!bookmarkedOnly && !closingSoon ? 'fbtn on' : 'fbtn'} onClick={() => { onToggleBookmarked(false); onToggleClosingSoon(false); }}>
          All
        </button>
        <button className={bookmarkedOnly ? 'fbtn on' : 'fbtn'} onClick={() => onToggleBookmarked(!bookmarkedOnly)}>
          <Star size={12} /> Bookmarked
        </button>
        <button className={closingSoon ? 'fbtn on' : 'fbtn'} onClick={() => onToggleClosingSoon(!closingSoon)}>
          Closing &lt; 5 days
        </button>
        {customFilters.map((key) => (
          <button key={key} className="fbtn cust" onClick={() => onRemoveCustom(key)}>
            {customFilterLabel(key)} <span className="x"><X size={11} /></span>
          </button>
        ))}
        {customFilters.length < MAX_CUSTOM && (
          <button className="fbtn addf" onClick={() => setMenuOpen((v) => !v)}>
            <Plus size={12} /> Filter
          </button>
        )}
        <button className="fbtn" onClick={onOpenAdvanced}>More</button>
      </div>
      <CustomFilterMenu
        open={menuOpen}
        rows={rows}
        active={customFilters}
        onAdd={(key) => { onAddCustom(key); setMenuOpen(false); }}
      />
    </div>
  );
}
