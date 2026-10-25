import type { Tender } from './tenders';

// Phase 1 fixture data: closed tenders the server's nightly sweep has archived.
// Replaced by /client/tenders?archived=true in Phase 2.

export type ArchivedTender = Tender & {
  /** Closing date shown on the badge ("Closed 12 Aug"). */
  closedOn: string;
  /** For "most recently closed first". Larger = closed more recently. */
  closedOrder: number;
};

export const archivedTenders: ArchivedTender[] = [
  {
    id: '2024_PWD_1031188_1',
    short: 'Alibag–Revdanda road resurfacing',
    portal: 'MahaTenders',
    org: 'Public Works Department, Konkan Region',
    title:
      'Resurfacing of Alibag–Revdanda road (km 0/000 to 9/400) with BC overlay',
    value: '₹11.40 Cr',
    emd: '₹11,40,000',
    category: 'Civil works',
    location: 'Raigad',
    published: '22-Jul-2024',
    closing: '19-Aug-2024 15:00',
    closeIn: '',
    state: 'ok',
    prebid: '29-Jul-2024 11:30',
    docs: [
      { name: 'Tender notice.pdf', meta: '0.8 MB · notice' },
      { name: 'BOQ.xls', meta: '64 KB · boq' },
    ],
    closedOn: 'Closed 19 Aug',
    closedOrder: 5,
  },
  {
    id: 'MJP/2024/WS/287',
    short: 'Dapoli water supply augmentation',
    portal: 'MahaTenders',
    org: 'Maharashtra Jeevan Pradhikaran',
    title: 'Augmentation of Dapoli regional water supply scheme, phase II',
    value: '₹31.70 Cr',
    emd: '₹31,70,000',
    category: 'Water supply',
    location: 'Ratnagiri',
    published: '15-Jul-2024',
    closing: '14-Aug-2024 17:00',
    closeIn: '',
    state: 'ok',
    prebid: '25-Jul-2024 15:00',
    docs: [{ name: 'e-Tender notice.pdf', meta: '0.6 MB · notice' }],
    closedOn: 'Closed 14 Aug',
    closedOrder: 4,
  },
  {
    id: 'eProc/CPWD/2024/2097',
    short: 'CGO complex lift replacement',
    portal: 'eProcure',
    org: 'Central Public Works Department',
    title: 'Replacement of 6 passenger lifts at CGO complex, Navi Mumbai',
    value: '₹4.85 Cr',
    emd: '₹9,70,000',
    category: 'Electrical',
    location: 'Navi Mumbai',
    published: '08-Jul-2024',
    closing: '06-Aug-2024 15:00',
    closeIn: '',
    state: 'ok',
    prebid: '18-Jul-2024 11:00',
    docs: [{ name: 'NIT.pdf', meta: '0.4 MB · notice' }],
    closedOn: 'Closed 6 Aug',
    closedOrder: 3,
  },
  {
    id: 'MCGM/RD/2024/1488',
    short: 'H-East footpath upgrade',
    portal: 'eTenders MH',
    org: 'Municipal Corp. of Greater Mumbai',
    title: 'Upgradation of footpaths and pedestrian crossings in H-East ward',
    value: '₹7.20 Cr',
    emd: '₹7,20,000',
    category: 'Civil works',
    location: 'Mumbai',
    published: '01-Jul-2024',
    closing: '29-Jul-2024 15:30',
    closeIn: '',
    state: 'ok',
    prebid: '10-Jul-2024 15:30',
    docs: [{ name: 'Tender document.pdf', meta: '2.1 MB · tender doc' }],
    closedOn: 'Closed 29 Jul',
    closedOrder: 2,
  },
];

export const getArchivedTender = (id: string) =>
  archivedTenders.find(t => t.id === id);
