import AsyncStorage from "@react-native-async-storage/async-storage";

// In-memory mirror of AsyncStorage so the many localStorage-shaped modules
// ported from the web Mobile App (store.js, alerts.js, projects.js, sync.js)
// can keep their synchronous read/write/cache pattern almost unchanged.
// hydrateKV() must be awaited once at app boot (see lib/bootstrap.js) before
// any module cache is trustworthy; each such module exports rehydrate()
// to re-read the now-populated mirror and notify its subscribers.
const mirror = new Map();
let hydratePromise = null;

export function hydrateKV(keys) {
  if (hydratePromise) return hydratePromise;
  hydratePromise = AsyncStorage.multiGet(keys).then((pairs) => {
    for (const [key, value] of pairs) {
      if (value != null) mirror.set(key, value);
    }
  });
  return hydratePromise;
}

export function getRaw(key) {
  return mirror.has(key) ? mirror.get(key) : null;
}

export function setRaw(key, value) {
  mirror.set(key, value);
  AsyncStorage.setItem(key, value).catch(() => {});
}

export function removeRaw(key) {
  mirror.delete(key);
  AsyncStorage.removeItem(key).catch(() => {});
}

export function getAllKeysRaw() {
  return [...mirror.keys()];
}
