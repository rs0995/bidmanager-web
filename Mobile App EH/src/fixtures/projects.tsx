import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { Urgency } from './tenders';

// Phase 1 fixture data and in-memory state. Replaced by lib/projects.ts (persisted,
// synced, real file storage) in Phase 2D.

export type ChecklistItem = {
  id: string;
  name: string;
  note: string;
  done: boolean;
  /** Attached file name. Phase 1 only stores the name. */
  file?: string;
};

export type ChecklistFolder = { name: string; items: ChecklistItem[] };

export type Project = {
  id: string;
  title: string;
  client: string;
  value: string;
  emd: string;
  deadline: string;
  dueIn: string;
  state: Urgency;
  prebid: string;
  sourceTenderId: string;
  status: string;
  description: string;
  checklist: ChecklistFolder[];
};

export const DEFAULT_FOLDERS = ['Ready Docs', 'Tender Docs', 'Working Docs'];
export const ARCHIVED_COUNT = 41;

let seq = 0;
const item = (
  name: string,
  note: string,
  done: boolean,
  file?: string,
): ChecklistItem => ({
  id: `seed${++seq}`,
  name,
  note,
  done,
  file,
});

const seed: Project[] = [
  {
    id: 'RII-2024-031',
    title: 'Panvel–Uran road widening (PWD Konkan)',
    client: 'PWD, Konkan Region',
    value: '₹42.80 Cr',
    emd: '₹42,80,000',
    deadline: '26-Aug-2024 15:00',
    dueIn: '2d 4h',
    state: 'soon',
    prebid: '20-Aug 11:30',
    sourceTenderId: '2024_PWD_1043567_1',
    status: 'Bid in preparation',
    description:
      'Widening & strengthening of Panvel–Uran road (km 4/200 to 11/600) including cross-drainage works.',
    checklist: [
      {
        name: 'Ready Docs',
        items: [
          item(
            'Covering letter on letterhead',
            'Signed & sealed',
            true,
            'Covering letter.pdf',
          ),
          item(
            'EMD — DD / BG ₹42,80,000',
            'BG from Bank of Maharashtra',
            true,
            'Bank guarantee.pdf',
          ),
          item('Bid security declaration', 'Annexure format', true),
          item('Power of attorney', 'Notarised', false),
        ],
      },
      {
        name: 'Tender Docs',
        items: [
          item('Signed tender document — all pages', 'Downloaded 18-Aug', true),
          item('Corrigendum I acknowledgement', 'Issued 21-Aug', false),
        ],
      },
      {
        name: 'Working Docs',
        items: [
          item(
            'Similar work completion certificates',
            '3 of value ≥ ₹17 Cr',
            true,
          ),
          item('CA-certified turnover statement', 'FY21–FY24', false),
          item('Plant & machinery declaration', 'Owned + leased', false),
        ],
      },
    ],
  },
  {
    id: 'RII-2024-029',
    title: 'Chiplun 24 MLD WTP (MJP / JJM)',
    client: 'Maharashtra Jeevan Pradhikaran',
    value: '₹78.20 Cr',
    emd: '₹78,20,000',
    deadline: '31-Aug-2024 17:00',
    dueIn: '7d',
    state: 'ok',
    prebid: '22-Aug 15:00',
    sourceTenderId: 'MJP/2024/WS/318',
    status: 'Bid in preparation',
    description:
      'Design, build & O&M of a 24 MLD water treatment plant at Chiplun under Jal Jeevan Mission.',
    checklist: [
      {
        name: 'Ready Docs',
        items: [
          item('Covering letter', '', true),
          item('EMD ₹78,20,000', 'Under process — bank', false),
          item('Joint venture agreement', 'With M/s Aqua Systems', false),
        ],
      },
      {
        name: 'Tender Docs',
        items: [item('Signed tender document', '', true)],
      },
      {
        name: 'Working Docs',
        items: [
          item(
            'Design basis report — WTP process',
            'Draft with consultant',
            false,
          ),
          item('Key personnel CVs', 'PM, design head, QA/QC', true),
          item('O&M methodology (5 yr)', '', false),
        ],
      },
    ],
  },
  {
    id: 'RII-2024-027',
    title: 'CPWD Nagpur staff quarters ph-II',
    client: 'Central PWD',
    value: '₹31.05 Cr',
    emd: '₹31,05,000',
    deadline: '25-Aug-2024 15:00',
    dueIn: '6h',
    state: 'crit',
    prebid: '16-Aug 11:00',
    sourceTenderId: 'eProc/CPWD/2024/2211',
    status: 'Ready to submit',
    description:
      'Construction of Type-III & IV staff quarters (48 units) at Nagpur GPRA colony — phase II.',
    checklist: [
      {
        name: 'Ready Docs',
        items: [
          item('Covering letter', '', true),
          item('EMD ₹31,05,000', 'DD ready', true),
          item('Affidavit — not blacklisted', '₹500 stamp, notarised', true),
        ],
      },
      {
        name: 'Tender Docs',
        items: [
          item('Signed NIT & GCC', '', true),
          item('Priced BOQ (.xls) upload', 'Rates frozen 24-Aug', true),
        ],
      },
      {
        name: 'Working Docs',
        items: [
          item('GST & PAN, PF registration', '', true),
          item('Similar works ≥ ₹12.4 Cr', '2 certificates', true),
        ],
      },
    ],
  },
  {
    id: 'RII-2024-024',
    title: 'MCGM K-West storm-water drains',
    client: 'MCGM, SWD Dept.',
    value: '₹9.35 Cr',
    emd: '₹9,35,000',
    deadline: '28-Aug-2024 14:00',
    dueIn: '4d',
    state: 'soon',
    prebid: '23-Aug 15:30',
    sourceTenderId: 'MCGM/SWD/2024/1567',
    status: 'Bid in preparation',
    description:
      'Desilting & reconstruction of storm-water drains in K-West ward before monsoon 2025.',
    checklist: [
      {
        name: 'Ready Docs',
        items: [
          item('Covering letter', '', false),
          item('EMD ₹9,35,000', '', false),
        ],
      },
      {
        name: 'Working Docs',
        items: [
          item(
            'MCGM contractor registration — Class I-A',
            'Valid to Mar-2026',
            true,
          ),
          item('Similar desilting work certificate', '', false),
        ],
      },
    ],
  },
  {
    id: 'RII-2024-021',
    title: 'ZP Pune anganwadi buildings (DPDC)',
    client: 'Zilla Parishad, Pune',
    value: '₹6.72 Cr',
    emd: '₹6,72,000',
    deadline: '02-Sep-2024 17:30',
    dueIn: '9d',
    state: 'ok',
    prebid: '—',
    sourceTenderId: '2024_ZP_PUNE_77841',
    status: 'Bid in preparation',
    description:
      'Construction of 12 anganwadi buildings across Bhor & Velhe talukas (DPDC 2024-25).',
    checklist: [
      {
        name: 'Ready Docs',
        items: [
          item('Covering letter', '', true),
          item('EMD ₹6,72,000', 'DD from ZP-approved bank', true),
        ],
      },
      {
        name: 'Working Docs',
        items: [
          item('Registration — PWD Class II & above', '', true),
          item('Similar building works certificate', '≥ ₹2.7 Cr', false),
        ],
      },
    ],
  },
  {
    id: 'RII-2024-018',
    title: 'MSRDC Expressway renewal (Khalapur)',
    client: 'MSRDC',
    value: '₹14.60 Cr',
    emd: '₹14,60,000',
    deadline: '05-Sep-2024 16:00',
    dueIn: '12d',
    state: 'ok',
    prebid: '27-Aug 12:00',
    sourceTenderId: 'MSRDC/EE/2024/0899',
    status: 'Bid in preparation',
    description:
      'Periodic renewal & pothole repair of Mumbai–Pune Expressway carriageway (Khalapur section).',
    checklist: [
      {
        name: 'Ready Docs',
        items: [
          item('Covering letter', '', false),
          item('EMD ₹14,60,000', '', false),
        ],
      },
      {
        name: 'Working Docs',
        items: [
          item('Bitumen supply tie-up letter', '', false),
          item('Similar road renewal works', '≥ ₹5.8 Cr', true),
        ],
      },
    ],
  },
];

// Stand-ins for the file picker, which is wired in Phase 2D.
const SAMPLE_FILES = [
  'Signed copy.pdf',
  'Certificate.pdf',
  'Bank letter.pdf',
  'Scanned document.pdf',
];

type Ctx = {
  projects: Project[];
  getProject: (id: string) => Project | undefined;
  addItem: (
    projectId: string,
    folder: string,
    name: string,
    note: string,
  ) => void;
  attachFile: (projectId: string, itemId: string) => void;
  removeFile: (projectId: string, itemId: string) => void;
};

const ProjectsContext = createContext<Ctx>({
  projects: [],
  getProject: () => undefined,
  addItem: () => {},
  attachFile: () => {},
  removeFile: () => {},
});

const mapItem = (
  projects: Project[],
  projectId: string,
  itemId: string,
  fn: (it: ChecklistItem) => ChecklistItem,
): Project[] =>
  projects.map(p =>
    p.id !== projectId
      ? p
      : {
          ...p,
          checklist: p.checklist.map(f => ({
            ...f,
            items: f.items.map(it => (it.id === itemId ? fn(it) : it)),
          })),
        },
  );

export function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>(seed);

  const addItem = useCallback(
    (projectId: string, folder: string, name: string, note: string) => {
      setProjects(prev =>
        prev.map(p => {
          if (p.id !== projectId) return p;
          const newItem: ChecklistItem = {
            id: `new${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
            name,
            note,
            done: false,
          };
          const exists = p.checklist.some(f => f.name === folder);
          const checklist = exists
            ? p.checklist.map(f =>
                f.name === folder ? { ...f, items: [...f.items, newItem] } : f,
              )
            : [...p.checklist, { name: folder, items: [newItem] }];
          return { ...p, checklist };
        }),
      );
    },
    [],
  );

  const attachFile = useCallback((projectId: string, itemId: string) => {
    setProjects(prev =>
      mapItem(prev, projectId, itemId, it => {
        const options = SAMPLE_FILES.filter(f => f !== it.file);
        const next = options[Math.floor(Math.random() * options.length)];
        return { ...it, file: next, done: true };
      }),
    );
  }, []);

  const removeFile = useCallback((projectId: string, itemId: string) => {
    setProjects(prev =>
      mapItem(prev, projectId, itemId, it => ({
        ...it,
        file: undefined,
        done: false,
      })),
    );
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      projects,
      getProject: id => projects.find(p => p.id === id),
      addItem,
      attachFile,
      removeFile,
    }),
    [projects, addItem, attachFile, removeFile],
  );

  return (
    <ProjectsContext.Provider value={value}>
      {children}
    </ProjectsContext.Provider>
  );
}

export const useProjects = () => useContext(ProjectsContext);
