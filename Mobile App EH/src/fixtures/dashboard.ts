import type { Tone } from '../components/ui/Chip';
import { getTender } from './tenders';

// Phase 1 fixture data. Replaced by real queries in Phase 2C.

export type WeekDay = {
  name: string;
  num: number;
  today?: boolean;
  closing: number;
  meeting: number;
};

export const dashboardHeader = {
  initials: 'RI',
  title: 'Dashboard',
  company: 'Rakshit Infra',
  syncedAgo: '4m ago',
  unreadAlerts: 3,
};

export const week: WeekDay[] = [
  { name: 'Su', num: 24, closing: 0, meeting: 0 },
  { name: 'Mo', num: 25, closing: 1, meeting: 0 },
  { name: 'Tu', num: 26, closing: 1, meeting: 1 },
  { name: 'We', num: 27, closing: 1, meeting: 0, today: true },
  { name: 'Th', num: 28, closing: 1, meeting: 1 },
  { name: 'Fr', num: 29, closing: 0, meeting: 0 },
  { name: 'Sa', num: 30, closing: 1, meeting: 0 },
];

export const portals = [
  'All portals',
  'MahaTenders',
  'eProcure',
  'eTenders MH',
];

export const pipeline = {
  title: 'Pipeline Snapshot',
  subtitle: '23 active tenders you’re tracking',
  value: '₹152.4',
  unit: 'Cr',
  targetPct: 0.62,
  stats: [
    { label: 'Active', count: 23, ratio: 0.76 },
    { label: 'Bookmarked', count: 4, ratio: 0.38 },
    { label: 'Closing soon', count: 3, ratio: 0.22 },
  ],
};

export const nextDeadline = {
  remaining: '2d 4h',
  progress: 0.15,
  title: 'Panvel–Uran road widening',
  portal: 'MahaTenders',
};

export const syncStatus = {
  newTenders: 3,
  label: 'new tenders to pull',
  lastSynced: 'last synced 4 min ago',
};

export type ClosingItem = {
  id: string;
  org: string;
  title: string;
  remaining: string;
  tone: Tone;
  urgent?: boolean;
};

const CLOSING_IDS = [
  'eProc/CPWD/2024/2211',
  '2024_PWD_1043567_1',
  'MCGM/SWD/2024/1567',
  'MJP/2024/WS/318',
];

export const closingSoon: ClosingItem[] = CLOSING_IDS.map(id => {
  const t = getTender(id)!;
  return {
    id: t.id,
    org: t.org.split(',')[0],
    title: t.short,
    remaining: t.closeIn,
    tone: t.state,
    urgent: t.state === 'crit',
  };
});
