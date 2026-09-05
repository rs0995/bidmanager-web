import React, { useState, useEffect } from 'react';
import { Search, Plus, Star, X } from 'lucide-react';
import { Chip } from '../common/Chip.jsx';
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
      <div className="relative mb-2">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
        <input
          className="input-field"
          style={{ paddingLeft: 34 }}
          placeholder="Search title, org, tender ID"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        <Chip active={!bookmarkedOnly && !closingSoon} onClick={() => { onToggleBookmarked(false); onToggleClosingSoon(false); }}>
          All
        </Chip>
        <Chip active={bookmarkedOnly} onClick={() => onToggleBookmarked(!bookmarkedOnly)}>
          <Star size={12} /> Bookmarked
        </Chip>
        <Chip active={closingSoon} onClick={() => onToggleClosingSoon(!closingSoon)}>
          Closing &lt; 5 days
        </Chip>
        {customFilters.map((key) => (
          <Chip key={key} active onClick={() => onRemoveCustom(key)}>
            {customFilterLabel(key)} <X size={11} />
          </Chip>
        ))}
        {customFilters.length < MAX_CUSTOM && (
          <Chip onClick={() => setMenuOpen((v) => !v)}>
            <Plus size={12} /> Filter
          </Chip>
        )}
        <Chip onClick={onOpenAdvanced}>More</Chip>
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
