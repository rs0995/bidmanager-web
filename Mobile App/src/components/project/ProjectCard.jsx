import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { ProgressRing } from '../common/ProgressRing.jsx';
import { fmtINR, timeRemaining, urgency } from '../../lib/format.js';
import { getChecklist } from '../../lib/projects.js';

export function ProjectCard({ project }) {
  const navigate = useNavigate();
  const items = getChecklist(project.id);
  const done = items.filter((i) => i.status === 'Completed').length;
  const total = items.length;
  const pct = total ? done / total : 0;
  const { totalDays, label, expired } = timeRemaining(project.deadline);
  const u = urgency(totalDays);

  return (
    <button className="pcard" onClick={() => navigate(`/projects/${project.id}`)}>
      <ProgressRing pct={pct} size={44} showLabel />
      <div className="min-w-0">
        <h4 className="m-0 line-clamp-2">{project.title}</h4>
        <p className="pmeta m-0 truncate">{project.client_name} · {fmtINR(project.project_value)}</p>
        <p className="pmeta m-0" style={{ fontFamily: '"IBM Plex Mono", monospace' }}>{done}/{total} docs ready</p>
      </div>
      <span className={`chip ${expired ? 'plain' : u.key}`} style={{ padding: '4px 9px' }}>
        <Clock size={11} /> {expired ? 'Closed' : label}
      </span>
    </button>
  );
}
