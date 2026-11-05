import type { BidAgentStatus, BidPack } from '../lib/bidPack';

// Sample bid pack for the browser preview and tests (from a metro-station works tender).

export const demoBidAgentStatus: BidAgentStatus = {
  ai_enabled: true,
  owner: 'organisation',
  can_edit_profile: true,
};

export const demoBidPackLogs = [
  'Collecting the tender’s documents…',
  'Reading 4 file(s)…',
  'Reading qualification criteria from 1 section(s)…',
  'Volume IV - Bidding Forms.pdf: found 23 form(s).',
  'Done: 23 form(s), 24 criteria.',
];

export const demoBidPack: BidPack = {
  status: 'completed',
  updated_at: Date.now() / 1000 - 3600,
  logs: demoBidPackLogs,
  next: demoBidPackLogs.length,
  result: {
    tender: {
      employer: 'Gujarat Metro Rail Corporation (GMRC) Limited',
      reference: 'GMRC/MMI-2/SURAT/PH-1/2026',
      title: 'Multi-modal integration works for 21 metro stations, Surat',
    },
    org_name: 'Gujarat Metro Rail Corporation (GMRC) Limited',
    key_sections: [
      { role: 'qualification_criteria', label: 'Qualification & Evaluation Criteria', found: true, locations: [{ file: 'Section III - Qualification Criteria.pdf', start_page: 1, end_page: 13 }] },
      { role: 'bidding_forms', label: 'Bidding Forms / Formats', found: true, locations: [{ file: 'Section IV - Bidding Forms.pdf', start_page: 1, end_page: 58 }] },
      { role: 'bds', label: 'Bid / Tender Data Sheet', found: true, locations: [{ file: 'Section II - Bid Data Sheet.pdf', start_page: 1, end_page: 23 }] },
      { role: 'itb', label: 'Instructions to Bidders', found: true, locations: [{ file: 'Section I - ITB.pdf', start_page: 1, end_page: 36 }] },
      { role: 'boq', label: 'Bill of Quantities / Price Bid', found: false, locations: [] },
    ],
    compliance: [
      { ref: '3.4', subject: 'Average Annual Turnover', requirement: 'Average annual civil turnover of the last five years ≥ INR 190 Cr', required: '190 Cr', actual: '218.21 Cr', status: 'Meets', forms: ['FIN-3.2 (a)', 'FIN-3.2 (b)'], remarks: 'Average of 5 years, updated at 5% per year.' },
      { ref: '3.1', subject: 'Liquidity', requirement: 'Access to INR 30 Cr of liquid assets or credit', required: '30 Cr', actual: 'NCA 35.00 Cr (2024-25)', status: 'Meets', forms: ['FIN-3.1', 'FIN-3.3 (b)'], remarks: '' },
      { ref: '4.2', subject: 'Similar work experience', requirement: '1 work of INR 150 Cr, 2 of 95 Cr or 3 of 75 Cr in 7 years', required: '1 work(s) ≥ 150 Cr in 7 yrs', actual: '1 qualifying', status: 'Meets', forms: ['EXP-4.2 (a)'], remarks: 'Confirm it matches the similar-work definition.' },
      { ref: '5(a)', subject: 'ISO certificates', requirement: 'ISO 9001, ISO 14001 and ISO 45001 / OHSAS 18001', required: 'ISO 9001, ISO 14001, ISO 45001', actual: 'Missing: ISO 45001', status: 'Shortfall', forms: ['CER-5.1'], remarks: '' },
      { ref: '3.5', subject: 'Available bid capacity', requirement: '2AN − B > INR 190 Cr', required: '190 Cr', actual: '', status: 'Data missing', forms: ['FIN-3.4 (a)'], remarks: 'Add works in hand to the company profile.' },
      { ref: '1.1', subject: 'Nationality', requirement: 'As per ITB 4.3', required: '', actual: '', status: 'Manual check', forms: ['ELI-1.1'], remarks: '' },
    ],
    forms: [
      { code: 'ELI-1.1', title: 'Bidder Information Form', file: 'Section IV - Bidding Forms.pdf', start_page: 4, end_page: 5, source: 'ai' },
      { code: 'FIN-3.1', title: 'Financial Situation and Performance', file: 'Section IV - Bidding Forms.pdf', start_page: 12, end_page: 13, source: 'library' },
      { code: 'FIN-3.2 (a)', title: 'Average Annual Construction Turnover', file: 'Section IV - Bidding Forms.pdf', start_page: 14, end_page: 14, source: 'library' },
      { code: 'EXP-4.2 (a)', title: 'Specific Construction Experience', file: 'Section IV - Bidding Forms.pdf', start_page: 20, end_page: 22, source: 'ai' },
    ],
    missing_forms: [],
    criteria: {
      criteria: [],
      personnel: [
        { position: 'Project Manager', count: '1', qualification: 'Graduate in Civil Engineering', experience: '15 years, 10 in charge of similar works' },
        { position: 'Safety / ESHS Manager', count: '1', qualification: 'Graduate or diploma in construction safety', experience: '10 years' },
      ],
      equipment: [{ type: 'Mini concrete batching plant', min_units: '1 (20 cum/hr)', max_age_years: '5' }],
    },
    llm: { used: true },
  },
  files: [
    { name: 'Bid Forms Workbook.xlsx', kind: 'workbook' },
    { name: '01 ELI-1.1 - Bidder Information Form.docx', kind: 'form', code: 'ELI-1.1' },
    { name: '02 FIN-3.1 - Financial Situation and Performance.docx', kind: 'form', code: 'FIN-3.1' },
    { name: '03 FIN-3.2 (a) - Average Annual Construction Turnover.docx', kind: 'form', code: 'FIN-3.2 (a)' },
    { name: '04 EXP-4.2 (a) - Specific Construction Experience.docx', kind: 'form', code: 'EXP-4.2 (a)' },
    { name: 'Bid Forms.zip', kind: 'zip' },
  ],
};
