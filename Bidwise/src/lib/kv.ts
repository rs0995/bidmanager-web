import AsyncStorage from '@react-native-async-storage/async-storage';

// In-memory mirror of AsyncStorage so the stores (bookmarks, projects, sync) can read
// synchronously, as BM Pro's do. hydrateKV() must be awaited once at boot (see
// bootstrap.ts) before any store cache is trustworthy; each store then re-reads.
// Keys use the "bw." prefix so Bidwise never collides with BM Pro data.
const mirror = new Map<string, string>();
let hydratePromise: Promise<void> | null = null;

export function hydrateKV(keys: string[]): Promise<void> {
  if (!hydratePromise) {
    hydratePromise = AsyncStorage.getMany(keys)
      .then(values => {
        for (const [key, value] of Object.entries(values)) {
          if (value != null) mirror.set(key, value);
        }
      })
      .catch(() => {});
  }
  return hydratePromise;
}

export function getRaw(key: string): string | null {
  return mirror.has(key) ? (mirror.get(key) as string) : null;
}

export function setRaw(key: string, value: string) {
  mirror.set(key, value);
  AsyncStorage.setItem(key, value).catch(() => {});
}

export function removeRaw(key: string) {
  mirror.delete(key);
  AsyncStorage.removeItem(key).catch(() => {});
}

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = getRaw(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown) {
  setRaw(key, JSON.stringify(value));
}

/** Clears every Bidwise key (Clear local cache). */
export function clearAllRaw(keys: string[]) {
  keys.forEach(removeRaw);
}

/** Tests only: forget the mirror and the hydrate promise. */
export function __resetKV() {
  mirror.clear();
  hydratePromise = null;
}
