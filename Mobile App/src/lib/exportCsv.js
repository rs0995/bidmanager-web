import { api } from './api.js';

const FIELDS = [
  'tender_id', 'title', 'organization', 'website_name', 'location', 'category',
  'tender_value', 'emd', 'published_date', 'closing_date', 'status',
];

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Real, client-side CSV export of the currently-visible tender scope. Pages
// through /client/tenders (capped, same pagination-loop pattern as Client
// UI/src/lib/api.js's downloadServerSnapshot) rather than a single huge page.
export async function exportTendersCsv(filters = {}, { maxPages = 200 } = {}) {
  const rows = [];
  let page = 1;
  let pages = 1;
  do {
    const payload = await api.tenders({ ...filters, page, page_size: 100 });
    rows.push(...(payload.items || []));
    pages = Math.max(1, Number(payload.pages) || 1);
    page += 1;
  } while (page <= pages && page <= maxPages);

  const header = FIELDS.join(',');
  const lines = rows.map((row) => FIELDS.map((f) => csvEscape(row[f])).join(','));
  const csv = [header, ...lines].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tenders-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return rows.length;
}
