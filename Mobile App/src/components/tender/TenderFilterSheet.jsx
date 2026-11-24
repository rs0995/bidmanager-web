import React, { useState } from 'react';
import { Sheet } from '../common/Sheet.jsx';
import { Field, Input, Select } from '../common/Field.jsx';
import { Button } from '../common/Button.jsx';

const SORT_OPTIONS = [
  ['closing_date', 'Closing date'],
  ['published_date', 'Published date'],
  ['tender_value', 'Tender value'],
  ['title', 'Title'],
];

export function TenderFilterSheet({ open, onClose, filters, onApply }) {
  const [local, setLocal] = useState(filters);

  if (!open) return null;
  const set = (patch) => setLocal((prev) => ({ ...prev, ...patch }));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filters"
      footer={(
        <>
          <Button variant="secondary" className="flex-1" onClick={() => { const cleared = { q: filters.q }; setLocal(cleared); onApply(cleared); onClose(); }}>
            Clear
          </Button>
          <Button className="flex-1" onClick={() => { onApply(local); onClose(); }}>Apply</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        <Field label="Category">
          <Input value={local.category || ''} onChange={(e) => set({ category: e.target.value })} placeholder="e.g. Works" />
        </Field>
        <Field label="Location">
          <Input value={local.location || ''} onChange={(e) => set({ location: e.target.value })} placeholder="e.g. Pune" />
        </Field>
        <Field label="Organization">
          <Input value={local.organization || ''} onChange={(e) => set({ organization: e.target.value })} placeholder="e.g. PWD" />
        </Field>
        <Field label="Status">
          <Select value={local.archived ?? ''} onChange={(e) => set({ archived: e.target.value })}>
            <option value="">Active</option>
            <option value="true">Archived</option>
          </Select>
        </Field>
        <Field label="Only tenders with documents">
          <Select value={local.has_documents ?? ''} onChange={(e) => set({ has_documents: e.target.value })}>
            <option value="">Any</option>
            <option value="true">Has documents</option>
            <option value="false">No documents yet</option>
          </Select>
        </Field>
        <Field label="Sort by">
          <Select value={local.sort_by || 'closing_date'} onChange={(e) => set({ sort_by: e.target.value })}>
            {SORT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Sort order">
          <Select value={local.sort_order || 'asc'} onChange={(e) => set({ sort_order: e.target.value })}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </Select>
        </Field>
      </div>
    </Sheet>
  );
}
