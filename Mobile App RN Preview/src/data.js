// Deliberately isolated fixtures. No production services or credentials are used.
export const tenders = [
  { id: 'GEM/2026/B/6842193', title: 'Supply and installation of network infrastructure', org: 'Indian Institute of Technology, Madras', short: 'IIT', category: 'IT & networking', location: 'Tamil Nadu', value: 1.84, days: 2, date: '21 Sep 2026', source: 'GeM', docs: 4 },
  { id: '2026_NHAI_248601', title: 'Four-laning of NH-48, maintenance and road safety works', org: 'National Highways Authority of India', short: 'NH', category: 'Civil works', location: 'Karnataka', value: 8.65, days: 3, date: '22 Sep 2026', source: 'CPPP', docs: 7 },
  { id: '2026_BHEL_193842', title: 'Procurement of industrial electrical control panels', org: 'Bharat Heavy Electricals Limited', short: 'BH', category: 'Electrical', location: 'Telangana', value: 2.76, days: 5, date: '24 Sep 2026', source: 'CPPP', docs: 3 },
  { id: 'GEM/2026/B/6890512', title: 'Annual facility management services for regional office', org: 'State Bank of India', short: 'SB', category: 'Services', location: 'Maharashtra', value: 0.94, days: 6, date: '25 Sep 2026', source: 'GeM', docs: 5 },
  { id: '2026_CMRL_084216', title: 'Station ventilation and air-conditioning systems', org: 'Chennai Metro Rail Limited', short: 'CM', category: 'Electrical', location: 'Tamil Nadu', value: 4.32, days: 9, date: '28 Sep 2026', source: 'CPPP', docs: 6 },
  { id: 'GEM/2026/B/6921480', title: 'Supply of laboratory equipment and testing instruments', org: 'Council of Scientific & Industrial Research', short: 'CS', category: 'Equipment', location: 'Delhi', value: 0.68, days: 12, date: '01 Oct 2026', source: 'GeM', docs: 3 }
];
export const initialProjects = [
  { id: 'p1', tenderId: tenders[0].id, name: 'IIT Madras network infrastructure', org: tenders[0].org, value: 1.84, stage: 'In preparation', checks: [true, true, true, false, false], owner: 'RK' },
  { id: 'p2', tenderId: tenders[1].id, name: 'NH-48 road safety works', org: tenders[1].org, value: 8.65, stage: 'In review', checks: [true, true, true, true, false], owner: 'AS' },
  { id: 'p3', tenderId: tenders[2].id, name: 'BHEL electrical control panels', org: tenders[2].org, value: 2.76, stage: 'In preparation', checks: [true, true, false, false, false], owner: 'RK' }
];
export const checklist = ['Eligibility verified', 'Technical proposal', 'Financial proposal', 'EMD / bank guarantee', 'Final submission review'];
export const money = value => `₹${value.toFixed(2)} Cr`;
