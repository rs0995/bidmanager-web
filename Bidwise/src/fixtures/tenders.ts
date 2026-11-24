// Sample data for demo mode (browser preview and tests). Live mode builds the same
// Tender shape from the server with lib/serverTender.ts toTender().

/** Portal (website) name; the sample data uses three Maharashtra portals. */
export type Portal = string;
export type Urgency = 'ok' | 'soon' | 'crit';

export type TenderDoc = { name: string; meta: string };

export type Tender = {
  /** Live: the server's numeric tender id as text. Demo: the portal reference. */
  id: string;
  short: string;
  portal: Portal;
  org: string;
  title: string;
  value: string;
  emd: string;
  category: string;
  location: string;
  published: string;
  closing: string;
  closeIn: string;
  state: Urgency;
  prebid: string;
  /** The pre-bid meeting's time (ms) when it has one; null for no time of day. */
  prebidAt?: number | null;
  docs: TenderDoc[];
  // Live-only extras (absent in the sample data).
  /** The portal's own tender reference, shown on cards. Defaults to `id`. */
  refId?: string;
  /** Tender page on the portal ("Open on <portal>"). */
  url?: string;
  /** Closing time in ms, for sorting and countdowns. */
  closesAt?: number | null;
  docCount?: number;
  corrigenda?: number;
  archived?: boolean;
  description?: string;
  opening?: string;
};

export const PORTALS: Portal[] = ['MahaTenders', 'eProcure', 'eTenders MH'];

export const tenders: Tender[] = [
  {
    id: '2024_PWD_1043567_1',
    short: 'Panvel–Uran road widening',
    portal: 'MahaTenders',
    org: 'Public Works Department, Konkan Region',
    title:
      'Widening & strengthening of Panvel–Uran road (km 4/200 to 11/600) including CD works',
    value: '₹42.80 Cr',
    emd: '₹42,80,000',
    category: 'Civil works',
    location: 'Raigad',
    published: '18-Aug-2024',
    closing: '26-Aug-2024 15:00',
    closeIn: '2d 4h',
    state: 'soon',
    prebid: '20-Aug-2024 11:30',
    docs: [
      { name: 'Tender notice.pdf', meta: '1.2 MB · notice' },
      {
        name: 'NIT & instructions to bidders.pdf',
        meta: '3.4 MB · tender doc',
      },
      { name: 'BOQ.xls', meta: '88 KB · boq' },
      { name: 'Corrigendum I.pdf', meta: '460 KB · corrigendum · 21-Aug' },
    ],
  },
  {
    id: '2024_PWD_1041902_1',
    short: 'Kal river bridge, Mahad',
    portal: 'MahaTenders',
    org: 'Public Works Department, Konkan Region',
    title:
      'Construction of RCC bridge across Kal river on Mahad–Poladpur road, Ta. Mahad',
    value: '₹18.90 Cr',
    emd: '₹18,90,000',
    category: 'Bridges',
    location: 'Raigad',
    published: '16-Aug-2024',
    closing: '30-Aug-2024 15:00',
    closeIn: '6d',
    state: 'ok',
    prebid: '23-Aug-2024 12:00',
    docs: [
      { name: 'Tender notice.pdf', meta: '0.9 MB · notice' },
      { name: 'Design drawings.pdf', meta: '8.8 MB · tender doc' },
    ],
  },
  {
    id: 'MJP/2024/WS/318',
    short: 'Chiplun 24 MLD water treatment plant',
    portal: 'MahaTenders',
    org: 'Maharashtra Jeevan Pradhikaran',
    title:
      'Design, build & O&M of 24 MLD water treatment plant at Chiplun under Jal Jeevan Mission',
    value: '₹78.20 Cr',
    emd: '₹78,20,000',
    category: 'Water supply',
    location: 'Ratnagiri',
    published: '12-Aug-2024',
    closing: '31-Aug-2024 17:00',
    closeIn: '7d',
    state: 'ok',
    prebid: '22-Aug-2024 15:00',
    docs: [
      { name: 'Tender notice.pdf', meta: '0.9 MB · notice' },
      { name: 'Technical specifications.pdf', meta: '12.1 MB · tender doc' },
      { name: 'Draft agreement.pdf', meta: '2.2 MB · tender doc' },
    ],
  },
  {
    id: 'MJP/2024/WS/351',
    short: 'Khed regional water supply',
    portal: 'MahaTenders',
    org: 'Maharashtra Jeevan Pradhikaran',
    title:
      'Laying of gravity main & distribution network for Khed regional water supply scheme',
    value: '₹22.40 Cr',
    emd: '₹22,40,000',
    category: 'Water supply',
    location: 'Ratnagiri',
    published: '19-Aug-2024',
    closing: '05-Sep-2024 17:00',
    closeIn: '12d',
    state: 'ok',
    prebid: '28-Aug-2024 15:00',
    docs: [
      { name: 'e-Tender notice.pdf', meta: '0.7 MB · notice' },
      { name: 'Pipe schedule & BOQ.xls', meta: '140 KB · boq' },
    ],
  },
  {
    id: 'eProc/CPWD/2024/2211',
    short: 'CPWD Nagpur staff quarters ph-II',
    portal: 'eProcure',
    org: 'Central Public Works Department',
    title:
      'Construction of Type-III & IV staff quarters (48 units) at Nagpur GPRA colony — phase II',
    value: '₹31.05 Cr',
    emd: '₹31,05,000',
    category: 'Buildings',
    location: 'Nagpur',
    published: '09-Aug-2024',
    closing: '25-Aug-2024 15:00',
    closeIn: '6h',
    state: 'crit',
    prebid: '16-Aug-2024 11:00',
    docs: [
      { name: 'NIT.pdf', meta: '0.7 MB · notice' },
      { name: 'Schedule A – BOQ.xls', meta: '120 KB · boq' },
      { name: 'Drawings.zip', meta: '44 MB · drawings' },
    ],
  },
  {
    id: 'eProc/CPWD/2024/2280',
    short: 'HVAC & DG AMC, CGO complex',
    portal: 'eProcure',
    org: 'Central Public Works Department',
    title:
      'Comprehensive AMC of HVAC & DG sets at CGO complex, Mumbai for 2024–27',
    value: '₹7.10 Cr',
    emd: '₹7,10,000',
    category: 'Maintenance',
    location: 'Mumbai',
    published: '18-Aug-2024',
    closing: '03-Sep-2024 15:00',
    closeIn: '10d',
    state: 'ok',
    prebid: '26-Aug-2024 11:00',
    docs: [
      { name: 'NIT.pdf', meta: '0.5 MB · notice' },
      { name: 'Scope of work.pdf', meta: '1.4 MB · tender doc' },
    ],
  },
  {
    id: 'eProc/NHAI/2024/0714',
    short: 'NH-48 Panvel–Indapur O&M',
    portal: 'eProcure',
    org: 'National Highways Authority of India',
    title:
      'Operation & maintenance of NH-48 Panvel–Indapur section (toll plaza & highway)',
    value: '₹54.00 Cr',
    emd: '₹54,00,000',
    category: 'Maintenance',
    location: 'Raigad',
    published: '11-Aug-2024',
    closing: '01-Sep-2024 16:00',
    closeIn: '8d',
    state: 'ok',
    prebid: '21-Aug-2024 15:00',
    docs: [
      { name: 'RFP.pdf', meta: '3.1 MB · notice' },
      { name: 'Concession agreement draft.pdf', meta: '6.6 MB · tender doc' },
    ],
  },
  {
    id: 'MSRDC/EE/2024/0899',
    short: 'Expressway renewal, Khalapur',
    portal: 'eTenders MH',
    org: 'Maharashtra State Road Dev. Corp.',
    title:
      'Periodic renewal & pothole repair of Mumbai–Pune Expressway carriageway (Khalapur section)',
    value: '₹14.60 Cr',
    emd: '₹14,60,000',
    category: 'Maintenance',
    location: 'Pune',
    published: '20-Aug-2024',
    closing: '05-Sep-2024 16:00',
    closeIn: '12d',
    state: 'ok',
    prebid: '27-Aug-2024 12:00',
    docs: [
      { name: 'Tender notice.pdf', meta: '0.6 MB · notice' },
      { name: 'Special conditions.pdf', meta: '1.1 MB · tender doc' },
    ],
  },
  {
    id: 'MCGM/SWD/2024/1567',
    short: 'K-West storm-water drains',
    portal: 'eTenders MH',
    org: 'Municipal Corp. of Greater Mumbai',
    title:
      'Desilting & reconstruction of storm-water drains in K-West ward before monsoon 2025',
    value: '₹9.35 Cr',
    emd: '₹9,35,000',
    category: 'Civil works',
    location: 'Mumbai',
    published: '19-Aug-2024',
    closing: '28-Aug-2024 14:00',
    closeIn: '4d',
    state: 'soon',
    prebid: '23-Aug-2024 15:30',
    docs: [
      { name: 'e-NIT.pdf', meta: '0.8 MB · notice' },
      { name: 'Ward drain schedule.pdf', meta: '2.7 MB · tender doc' },
    ],
  },
  {
    id: 'MCGM/RD/2024/1601',
    short: 'P-North road resurfacing',
    portal: 'eTenders MH',
    org: 'Municipal Corp. of Greater Mumbai',
    title:
      'Mastic asphalt resurfacing of arterial roads in P-North ward (package 3)',
    value: '₹16.20 Cr',
    emd: '₹16,20,000',
    category: 'Roads',
    location: 'Mumbai',
    published: '21-Aug-2024',
    closing: '09-Sep-2024 14:00',
    closeIn: '16d',
    state: 'ok',
    prebid: '30-Aug-2024 15:30',
    docs: [
      { name: 'e-NIT.pdf', meta: '0.8 MB · notice' },
      { name: 'Road list & BOQ.xls', meta: '96 KB · boq' },
    ],
  },
  {
    id: '2024_ZP_PUNE_77841',
    short: 'Anganwadi buildings, Pune ZP',
    portal: 'eTenders MH',
    org: 'Zilla Parishad, Pune',
    title:
      'Construction of 12 anganwadi buildings across Bhor & Velhe talukas (DPDC 2024-25)',
    value: '₹6.72 Cr',
    emd: '₹6,72,000',
    category: 'Buildings',
    location: 'Pune',
    published: '14-Aug-2024',
    closing: '02-Sep-2024 17:30',
    closeIn: '9d',
    state: 'ok',
    prebid: '—',
    docs: [
      { name: 'Tender notice.pdf', meta: '0.5 MB · notice' },
      { name: 'Type design & BOQ.pdf', meta: '5.9 MB · tender doc' },
    ],
  },
];

/** Tender ids bookmarked at the start of the session. */
export const initialBookmarks = [
  '2024_PWD_1043567_1',
  'MJP/2024/WS/318',
  'eProc/NHAI/2024/0714',
  '2024_ZP_PUNE_77841',
];

export const getTender = (id: string) => tenders.find(t => t.id === id);
