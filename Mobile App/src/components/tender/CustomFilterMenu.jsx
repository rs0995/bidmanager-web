import React, { useMemo } from 'react';

const VALUE_OPTIONS = [
  ['val:gt25', 'Above ₹25 Cr'],
  ['val:lt10', 'Below ₹10 Cr'],
];
const OTHER_OPTIONS = [['prebid', 'Has pre-bid meeting']];

// Inline ad-hoc filter builder — up to 2 active custom filters at once,
// options derived from the currently-loaded tender rows (category/location),
// matching the reference artifact's "+ Filter" menu exactly.
export function CustomFilterMenu({ open, rows, active, onAdd }) {
  const groups = useMemo(() => {
    const cats = [...new Set(rows.map((t) => t.category).filter(Boolean))].sort();
    const locs = [...new Set(rows.map((t) => t.location).filter(Boolean))].sort();
    return [
      { heading: 'Category', options: cats.map((c) => [`cat:${c}`, c]) },
      { heading: 'Location', options: locs.map((l) => [`loc:${l}`, l]) },
      { heading: 'Tender value', options: VALUE_OPTIONS },
      { heading: 'Other', options: OTHER_OPTIONS },
    ];
  }, [rows]);

  if (!open) return null;

  return (
    <div className="card p-1.5 mb-3 grid gap-0.5">
      {groups.map((group) => {
        const available = group.options.filter(([key]) => !active.includes(key));
        if (available.length === 0) return null;
        return (
          <React.Fragment key={group.heading}>
            <p className="m-0 px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              {group.heading}
            </p>
            {available.map(([key, label]) => (
              <button
                key={key}
                className="text-left text-sm px-2.5 py-2 rounded-lg"
                onClick={() => onAdd(key)}
              >
                {label}
              </button>
            ))}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function customFilterLabel(key) {
  if (key.startsWith('cat:') || key.startsWith('loc:')) return key.slice(4);
  if (key === 'val:gt25') return 'Above ₹25 Cr';
  if (key === 'val:lt10') return 'Below ₹10 Cr';
  if (key === 'prebid') return 'Has pre-bid';
  return key;
}

export function customFilterPass(tender, key) {
  if (key.startsWith('cat:')) return tender.category === key.slice(4);
  if (key.startsWith('loc:')) return tender.location === key.slice(4);
  const value = Number(tender.tender_value) || 0; // stored in rupees; 1 Cr = 1e7
  if (key === 'val:gt25') return value > 25 * 1e7;
  if (key === 'val:lt10') return value < 10 * 1e7;
  if (key === 'prebid') return Boolean(tender.pre_bid_meeting_date);
  return true;
}
