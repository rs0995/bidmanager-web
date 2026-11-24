import type { AgentFile, ChatMessage, Learning, ReferenceDoc } from '../lib/bidAgent';

// Sample Bid Agent conversation material for the browser preview and tests
// (a metro-station works tender).

export const demoSuggestions = [
  'Show the prequalification',
  'Save the prequal as Excel',
  'Extract all tender forms',
  'Prepare the documents checklist',
  'Can we qualify?',
];

const prequalTable = {
  type: 'table' as const,
  title: 'Prequalification criteria',
  columns: ['Ref', 'Criterion', 'Requirement', 'Single entity', 'JV', 'Forms'],
  rows: [
    ['3.1', 'Liquidity', 'Access to INR 30 Cr of liquid assets / credit', 'Must meet', 'Must meet', 'FIN-3.1, FIN-3.3 (b)'],
    ['3.4', 'Average annual turnover', 'INR 190 Cr over the last 5 years (5% escalation)', 'Must meet', '25% each / 40% one', 'FIN-3.2 (a)'],
    ['4.2', 'Similar work', '1 work of INR 150 Cr, 2 of 95 Cr or 3 of 75 Cr in 7 years', 'Must meet', 'Must meet', 'EXP-4.2 (a)'],
    ['5(a)', 'ISO certificates', 'ISO 9001, 14001, 45001', 'Must meet', 'Each member', 'CER-5.1'],
  ],
};

let nextFile = 501;

/** Scripted answers for the preview: what the real agent does, on sample data. */
export function demoReply(text: string): Omit<ChatMessage, 'id' | 'at'> {
  const t = text.toLowerCase();
  const pdf = t.includes('pdf');
  const excel = /excel|xlsx/.test(t);
  if (/checklist|documents? required/.test(t)) {
    return {
      role: 'assistant',
      text: 'Ready for Bid: 7 rows added, 3 forms attached; the rest are Pending for files to be attached.',
      cards: [
        {
          type: 'checklist',
          title: 'Ready Docs checklist',
          folder: 'Ready Docs',
          rows: [
            { id: 1, name: 'ELI-1.1 - Bidder Information Form', added: true, file: 'ELI-1.1 - Bidder Information Form.docx' },
            { id: 2, name: 'FIN-3.1 - Financial Situation and Performance', added: true, file: 'FIN-3.1 - Financial Situation and Performance.docx' },
            { id: 3, name: 'EXP-4.2 (a) - Specific Construction Experience', added: true, file: 'EXP-4.2 (a) - Specific Construction Experience.docx' },
            { id: 4, name: 'CER-5.1', added: true, file: '' },
            { id: 5, name: 'Audited balance sheets and P&L (last 5 years)', added: true, file: '' },
            { id: 6, name: 'Work orders and completion certificates of similar works', added: true, file: '' },
            { id: 7, name: 'Bid security / EMD', added: true, file: '' },
          ],
        },
      ],
    };
  }
  if (/(save|download|export).*(pre-?qual|criteria|pq)/.test(t)) {
    const name = `Prequalification - GMRC_MMI-2_SURAT_PH-1_2026.${pdf ? 'pdf' : excel || !/word|docx/.test(t) ? 'xlsx' : 'docx'}`;
    return {
      role: 'assistant',
      text: `Saved ${name} to Docs for Preparation.`,
      cards: [{ type: 'files', title: 'Saved to Docs for Preparation', folder: 'Docs for Preparation', files: [{ file_id: nextFile++, name, kind: 'prequalification' }], attached: [] }],
    };
  }
  if (/(extract|save|get|download).*(form|letter|annex)|\b[a-z]{2,6}-\d/.test(t)) {
    const ext = pdf ? 'pdf' : 'docx';
    const files = /fin-3\.1/.test(t)
      ? [{ file_id: nextFile++, name: `FIN-3.1 - Financial Situation and Performance.${ext}`, kind: 'form' }]
      : [
          { file_id: nextFile++, name: `ELI-1.1 - Bidder Information Form.${ext}`, kind: 'form' },
          { file_id: nextFile++, name: `FIN-3.1 - Financial Situation and Performance.${ext}`, kind: 'form' },
          { file_id: nextFile++, name: `EXP-4.2 (a) - Specific Construction Experience.${ext}`, kind: 'form' },
        ];
    return {
      role: 'assistant',
      text: `Saved ${files.length} file(s) to Docs for Preparation, pre-filled from your company profile.`,
      cards: [{ type: 'files', title: 'Saved to Docs for Preparation', folder: 'Docs for Preparation', files, attached: [] }],
    };
  }
  if (/qualify|eligible/.test(t)) {
    return {
      role: 'assistant',
      text: 'You meet turnover, liquidity and similar work. ISO 45001 is missing, and bid capacity needs your works in hand.',
      cards: [
        {
          type: 'table',
          title: 'Eligibility check',
          columns: ['Ref', 'Criterion', 'Required', 'Ours', 'Result'],
          rows: [
            ['3.4', 'Average annual turnover', '190 Cr', '218.21 Cr', 'Meets'],
            ['3.1', 'Liquidity', '30 Cr', 'NCA 35.00 Cr', 'Meets'],
            ['4.2', 'Similar work', '1 work ≥ 150 Cr', '1 qualifying', 'Meets'],
            ['5(a)', 'ISO certificates', 'ISO 9001, 14001, 45001', 'Missing: ISO 45001', 'Shortfall'],
          ],
        },
      ],
    };
  }
  if (/pre-?qual|criteria|pq|eligibility|qualification/.test(t)) {
    return { role: 'assistant', text: 'Here is the prequalification from Section III. Ask me to save it as Excel, Word or PDF.', cards: [prequalTable] };
  }
  return {
    role: 'assistant',
    text: 'I can show the prequalification, save it (Excel, Word or PDF), extract all or specific tender forms, check whether you qualify, and prepare the Ready for Bid checklist with the forms attached.',
  };
}

export const demoPrepFiles: AgentFile[] = [];

/** Sample training for the preview: instructions, two learned notes, two reference documents. */
export const demoTraining: { instructions: string; learnings: Learning[]; references: ReferenceDoc[] } = {
  instructions: 'Save the prequalification as Excel.\nKeep answers short.',
  learnings: [
    { id: 2, employer_key: 'GMRC', text: 'GMRC tenders: the qualification criteria are in Section III.', source: 'chat', tender_id: null, created_at: 1793800000, active: 1 },
    { id: 1, employer_key: '', text: "Name the EMD row 'EMD - Bank Guarantee'.", source: 'chat', tender_id: null, created_at: 1793700000, active: 1 },
  ],
  references: [
    { file_id: 901, name: 'GST registration certificate.pdf', label: '', created_at: 1793700000, size: 240000, type: 'application/pdf' },
    { file_id: 902, name: 'PAN card.pdf', label: '', created_at: 1793700000, size: 96000, type: 'application/pdf' },
  ],
};
