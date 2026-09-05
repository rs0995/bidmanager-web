import React, { useState } from 'react';
import { Field, Input, Select } from '../common/Field.jsx';
import { Button } from '../common/Button.jsx';

export function AddChecklistItemForm({ folders, onAdd, onCancel }) {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState(folders[0]);
  const [note, setNote] = useState('');

  const submit = () => {
    if (!name.trim()) return;
    onAdd({ name: name.trim(), folder, note: note.trim() });
    setName('');
    setNote('');
  };

  return (
    <div className="card p-3 mb-3 flex flex-col gap-2">
      <Field label="Document name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. EMD — DD / BG" autoFocus />
      </Field>
      <div className="flex gap-2">
        <div className="flex-1">
          <Select value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Section">
            {folders.map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
        </div>
        <div className="flex-1">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button className="flex-1" onClick={submit}>Add to checklist</Button>
      </div>
    </div>
  );
}
