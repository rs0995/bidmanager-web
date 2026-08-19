const DB_NAME = 'bidmanager-client';
const DB_VERSION = 1;
const STORE = 'state';
const STATE_KEY = 'primary';

const initialState = () => ({
  schemaVersion: 1,
  websites: [],
  tenders: [],
  projects: [],
  checklist: [],
  templates: [],
  templateItems: [],
  settings: {
    parent_dir: '',
    project_details_show_tender_info: 'true',
    projects_entry_mode: 'inline',
    server_url: 'https://bidmanager-backend-426342323597.asia-south1.run.app',
    client_api_key: '',
    last_sync_at: '',
  },
});

let dbPromise;
let writeQueue = Promise.resolve();

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function readRaw() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(STATE_KEY);
    req.onsuccess = () => resolve(req.result || initialState());
    req.onerror = () => reject(req.error);
  });
}

async function writeRaw(value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, STATE_KEY);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getState() {
  const state = await readRaw();
  return { ...initialState(), ...state, settings: { ...initialState().settings, ...(state.settings || {}) } };
}

export function updateState(mutator) {
  const run = async () => {
    const current = await getState();
    const next = (await mutator(structuredClone(current))) || current;
    return writeRaw(next);
  };
  writeQueue = writeQueue.then(run, run);
  return writeQueue;
}

export async function replaceState(value) {
  const clean = { ...initialState(), ...(value || {}), schemaVersion: 1 };
  return updateState(() => clean);
}

export function nextId(rows) {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
}
