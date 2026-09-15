import React, { useState } from 'react';
import { Field, Input, Select } from '../common/Field.jsx';
import { Button } from '../common/Button.jsx';

export function AddChecklistItemForm({ folders, onAdd, onCancel }) {
  const [reqFileName, setReqFileName] = useState('');
  const [subfolder, setSubfolder] = useState(folders[0]);
  const [description, setDescription] = useState('');

  const submit = () => {
    if (!reqFileName.trim()) return;
    onAdd({ req_file_name: reqFileName.trim(), subfolder, description: description.trim() });
    setReqFileName('');
    setDescription('');
  };

  return (
    <div className="addbox">
      <Field label="Document name">
        <Input className="fin" value={reqFileName} onChange={(e) => setReqFileName(e.target.value)} placeholder="e.g. EMD — DD / BG" autoFocus />
      </Field>
      <div className="frow">
        <Select className="fin" value={subfolder} onChange={(e) => setSubfolder(e.target.value)} aria-label="Section">
          {folders.map((f) => <option key={f} value={f}>{f}</option>)}
        </Select>
        <Input className="fin" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Note (optional)" />
      </div>
      <div className="frow">
        <Button variant="fbtnGhost" onClick={onCancel}>Cancel</Button>
        <Button variant="fbtnAdd" onClick={submit}>Add to checklist</Button>
      </div>
    </div>
  );
}
