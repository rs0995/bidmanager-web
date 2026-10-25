import { api } from "./api.js";

// A tender's portal id (tender.tender_id, e.g. "2026_MCGM_1345164_1") is its
// one identity everywhere -- titles, URLs, orgs and dates can repeat across
// different tenders. The server row id (tender.id) is only a short-lived
// handle for API calls and the /tenders/[id] route: it changes if the server
// DB is cleared and restored, so everything saved on the device is keyed by
// this canonical form instead and looked up again with resolveTenderIds().
export function canonTenderId(v) {
  return String(v ?? "").split(/\s+/).filter(Boolean).join(" ").toUpperCase();
}

// Accepts a tender object or a raw tender_id string.
export function tenderKeyOf(t) {
  return canonTenderId(t && typeof t === "object" ? t.tender_id : t);
}

// { CANON_ID: tenderObject } for the ids that are in the server DB (missing
// ones are simply absent). One request for any number of ids.
export async function resolveTenderIds(keys) {
  const ids = [...new Set((keys || []).map(canonTenderId).filter(Boolean))];
  if (ids.length === 0) return {};
  const res = await api.resolveTenders(ids);
  return (res && res.tenders) || {};
}
