import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getTender } from './tenders';
import { setProjectTenderIds } from './bookmarks';
import type { Urgency } from './tenders';

// Phase 1 fixture data and in-memory state. Replaced by lib/projects.ts (persisted,
// synced, real file storage) in Phase 2.
//
// bidwise keeps one checklist folder, "Ready for Bid": an item counts as ready once a
// file is attached (or it is ticked by hand). Files the user adds for working on the bid
// live in `prepDocs` ("Docs for Preparation"); the tender's own files stay on the tender.

export type ChecklistItem = {
  id: string;
  name: string;
  note: string;
  done: boolean;
  /** Attached file name. */
  file?: string;
  /** Attached on another device and not on the server: can't be opened here. */
  elsewhere?: boolean;
  /** On the server but not saved on this phone yet: opening downloads it. */
  remote?: boolean;
};

/** Result of opening an attached file. */
export type OpenResult = 'opened' | 'elsewhere' | 'missing';

export type ChecklistFolder = { name: string; items: ChecklistItem[] };

/** A file the user added under "Docs for Preparation". */
export type PrepDoc = {
  id: string;
  name: string;
  meta: string;
  /** Live: the copy in the tender's folder on Drive. */
  serverFileId?: number;
};

export type ProjectStatus =
  | 'Bid in preparation'
  | 'Ready to submit'
  | 'Submitted';

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
  /** The portal's tender reference (e.g. 2026_MMRDA_1336754_1); defaults to sourceTenderId. */
  tenderRef?: string;
  status: ProjectStatus;
  description: string;
  checklist: ChecklistFolder[];
  prepDocs: PrepDoc[];
  /** Moved to Archived: only on the Archived projects page, where it can be restored. */
  archived?: boolean;
};

export const READY_FOLDER = 'Ready for Bid';
export const DEFAULT_FOLDERS = [READY_FOLDER];
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

type SeedProject = Omit<Project, 'prepDocs'>;

const seedData: SeedProject[] = [
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
    status: 'Submitted',
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

const SAMPLE_PREP: PrepDoc[][] = [
  [
    {
      id: 'p1',
      name: 'Cost estimate.xlsx',
      meta: 'Spreadsheet · Added by you',
    },
    {
      id: 'p2',
      name: 'Technical proposal draft.docx',
      meta: 'Document · Added by you',
    },
  ],
  [
    {
      id: 'p3',
      name: 'Rate analysis.xlsx',
      meta: 'Spreadsheet · Added by you',
    },
  ],
];

// The seed's three EH folders collapse into the single "Ready for Bid" checklist.
const seed: Project[] = seedData.map((p, i) => ({
  ...p,
  checklist: [{ name: READY_FOLDER, items: p.checklist.flatMap(f => f.items) }],
  prepDocs: SAMPLE_PREP[i] ?? [],
}));

const SAMPLE_PREP_FILES = [
  'Site visit notes.docx',
  'Quantity take-off.xlsx',
  'Subcontractor quotes.pdf',
];

// Stand-ins for the file picker, which is wired in Phase 2.
const SAMPLE_FILES = [
  'Signed copy.pdf',
  'Certificate.pdf',
  'Bank letter.pdf',
  'Scanned document.pdf',
];

/** Same tender: same id, or same portal tender ID (any case or spacing). */
function sameTender(p: Project, tenderId: string, ref?: string) {
  if (p.sourceTenderId === tenderId) return true;
  const r = (ref ?? '').trim().toUpperCase();
  return (
    r !== '' &&
    [p.tenderRef, p.sourceTenderId].some(
      x => (x ?? '').trim().toUpperCase() === r,
    )
  );
}

export type ProjectsCtx = {
  projects: Project[];
  /** Archived (closed) projects, for the Dashboard's Active ratio. */
  archivedCount: number;
  getProject: (id: string) => Project | undefined;
  addItem: (
    projectId: string,
    folder: string,
    name: string,
    note: string,
  ) => void;
  attachFile: (projectId: string, itemId: string, fileName?: string) => void;
  removeFile: (projectId: string, itemId: string) => void;
  /** Deletes a Ready for Bid item (and its file, everywhere). */
  removeItem: (projectId: string, itemId: string) => void;
  /** Ticks or unticks a Ready for Bid item by hand. */
  toggleDone: (projectId: string, itemId: string) => void;
  addPrepDoc: (projectId: string, name?: string) => void;
  removePrepDoc: (projectId: string, docId: string) => void;
  setStatus: (projectId: string, status: ProjectStatus) => void;
  /** Moves a project to Archived (as BM Pro); it leaves the Projects tab. */
  archiveProject: (projectId: string) => void;
  /** Archived projects (the Archived projects page), newest last. */
  archivedProjects: Project[];
  /** Brings an archived project back to Active (as BM Pro). */
  restoreProject: (projectId: string) => void;
  /** Deletes an archived project for good, everywhere it syncs. */
  deleteProject: (projectId: string) => void;
  /** Project for a tender, if one has been started. */
  /** The active project for a tender (by id, or by portal tender ID `ref`). */
  projectForTender: (tenderId: string, ref?: string) => Project | undefined;
  /**
   * Any project already made from this tender, archived ones included, so "Add to
   * Projects" can warn instead of adding it twice.
   */
  findExistingProject: (
    tenderId: string,
    ref?: string,
  ) => { project?: Project; archived: boolean } | undefined;
  /** Starts a project from a tender, or returns the one already started. */
  /** Never makes a second project for the same tender: returns the existing one. */
  startProject: (tenderId: string, ref?: string) => Project;
  /** Opens a Ready for Bid item's attached file (QuickLook). */
  openAttachment: (projectId: string, itemId: string) => Promise<OpenResult>;
  openPrepDoc: (projectId: string, docId: string) => Promise<OpenResult>;
};

export const ProjectsContext = createContext<ProjectsCtx>({
  projects: [],
  archivedCount: 0,
  getProject: () => undefined,
  addItem: () => {},
  attachFile: () => {},
  removeFile: () => {},
  removeItem: () => {},
  toggleDone: () => {},
  addPrepDoc: () => {},
  removePrepDoc: () => {},
  setStatus: () => {},
  archiveProject: () => {},
  archivedProjects: [],
  restoreProject: () => {},
  deleteProject: () => {},
  projectForTender: () => undefined,
  findExistingProject: () => undefined,
  startProject: () => {
    throw new Error('ProjectsProvider missing');
  },
  openAttachment: async () => 'missing',
  openPrepDoc: async () => 'missing',
});

const newId = (prefix: string) =>
  `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

/** "Cost estimate.xlsx" -> "Spreadsheet · Added by you". */
export function prepMeta(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  const kind =
    ext === 'xlsx' || ext === 'xls' || ext === 'csv'
      ? 'Spreadsheet'
      : ext === 'docx' || ext === 'doc'
      ? 'Document'
      : ext === 'pdf'
      ? 'PDF'
      : 'File';
  return `${kind} · Added by you`;
}

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
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

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

  const attachFile = useCallback(
    (projectId: string, itemId: string, fileName?: string) => {
      setProjects(prev =>
        mapItem(prev, projectId, itemId, it => {
          const options = SAMPLE_FILES.filter(f => f !== it.file);
          const next =
            fileName ?? options[Math.floor(Math.random() * options.length)];
          return { ...it, file: next, done: true };
        }),
      );
    },
    [],
  );

  const toggleDone = useCallback((projectId: string, itemId: string) => {
    setProjects(prev =>
      mapItem(prev, projectId, itemId, it => ({ ...it, done: !it.done })),
    );
  }, []);

  const mapProject = useCallback(
    (projectId: string, fn: (p: Project) => Project) =>
      setProjects(prev => prev.map(p => (p.id === projectId ? fn(p) : p))),
    [],
  );

  const addPrepDoc = useCallback(
    (projectId: string, name?: string) => {
      const file =
        name ??
        SAMPLE_PREP_FILES[Math.floor(Math.random() * SAMPLE_PREP_FILES.length)];
      mapProject(projectId, p => ({
        ...p,
        prepDocs: [
          ...p.prepDocs,
          { id: newId('prep'), name: file, meta: prepMeta(file) },
        ],
      }));
    },
    [mapProject],
  );

  const removePrepDoc = useCallback(
    (projectId: string, docId: string) =>
      mapProject(projectId, p => ({
        ...p,
        prepDocs: p.prepDocs.filter(d => d.id !== docId),
      })),
    [mapProject],
  );

  const setStatus = useCallback(
    (projectId: string, status: ProjectStatus) =>
      mapProject(projectId, p => ({ ...p, status })),
    [mapProject],
  );

  // Archived here in the demo; the seed's older archive is only a count.
  const [archived, setArchived] = useState<Project[]>([]);
  const archiveProject = useCallback((projectId: string) => {
    const p = projectsRef.current.find(x => x.id === projectId);
    if (!p) return;
    projectsRef.current = projectsRef.current.filter(x => x.id !== projectId);
    setProjects(prev => prev.filter(x => x.id !== projectId));
    setArchived(prev => [...prev, { ...p, archived: true }]);
  }, []);
  // Their tenders stay bookmarked (the bookmarks provider checks this list).
  useEffect(() => {
    setProjectTenderIds(
      [...projects, ...archived].flatMap(p =>
        [p.sourceTenderId, p.tenderRef].filter((x): x is string => !!x),
      ),
    );
  }, [projects, archived]);
  const archivedRef = useRef(archived);
  archivedRef.current = archived;
  const restoreProject = useCallback((projectId: string) => {
    const p = archivedRef.current.find(x => x.id === projectId);
    if (!p) return;
    const back: Project = {
      ...p,
      archived: false,
      status: 'Bid in preparation',
    };
    projectsRef.current = [...projectsRef.current, back];
    setProjects(list => [...list, back]);
    setArchived(prev => prev.filter(x => x.id !== projectId));
  }, []);
  const deleteProject = useCallback((projectId: string) => {
    setArchived(prev => prev.filter(x => x.id !== projectId));
  }, []);

  const startProject = useCallback((tenderId: string, ref?: string) => {
    const existing = projectsRef.current.find(p =>
      sameTender(p, tenderId, ref),
    );
    if (existing) return existing;
    const t = getTender(tenderId);
    const id = `RII-${new Date().getFullYear()}-${String(
      40 + projectsRef.current.length,
    ).padStart(3, '0')}`;
    const project: Project = {
      id,
      title: t ? t.short : tenderId,
      client: t?.org ?? '',
      value: t?.value ?? '',
      emd: t?.emd ?? '',
      deadline: t?.closing ?? '',
      dueIn: t?.closeIn ?? '',
      state: t?.state ?? 'ok',
      prebid: t?.prebid ?? '—',
      sourceTenderId: tenderId,
      status: 'Bid in preparation',
      description: t?.title ?? '',
      // As in BM Pro: a new project starts with an empty checklist.
      checklist: [{ name: READY_FOLDER, items: [] }],
      prepDocs: [],
    };
    projectsRef.current = [...projectsRef.current, project];
    setProjects(prev => [...prev, project]);
    return project;
  }, []);

  const removeItem = useCallback((projectId: string, itemId: string) => {
    setProjects(prev =>
      prev.map(p =>
        p.id !== projectId
          ? p
          : {
              ...p,
              checklist: p.checklist.map(f => ({
                ...f,
                items: f.items.filter(it => it.id !== itemId),
              })),
            },
      ),
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

  const value = useMemo<ProjectsCtx>(
    () => ({
      projects,
      archivedCount: ARCHIVED_COUNT + archived.length,
      getProject: id =>
        projects.find(p => p.id === id) ?? archived.find(p => p.id === id),
      addItem,
      attachFile,
      removeFile,
      removeItem,
      toggleDone,
      addPrepDoc,
      removePrepDoc,
      setStatus,
      archiveProject,
      archivedProjects: archived,
      restoreProject,
      deleteProject,
      projectForTender: (tenderId, ref) =>
        projects.find(p => sameTender(p, tenderId, ref)),
      findExistingProject: (tenderId, ref) => {
        const project = projects.find(p => sameTender(p, tenderId, ref));
        return project ? { project, archived: false } : undefined;
      },
      startProject,
      openAttachment: async () => 'opened',
      openPrepDoc: async () => 'opened',
    }),
    [
      projects,
      addItem,
      attachFile,
      removeFile,
      removeItem,
      toggleDone,
      addPrepDoc,
      removePrepDoc,
      setStatus,
      archiveProject,
      archived,
      restoreProject,
      deleteProject,
      startProject,
    ],
  );

  return (
    <ProjectsContext.Provider value={value}>
      {children}
    </ProjectsContext.Provider>
  );
}

export const useProjects = () => useContext(ProjectsContext);
