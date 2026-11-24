import type { PushPayload } from '../platform/push';

// Where a tapped notification opens. `thread` is the server's aps thread-id
// (api_server.py): tender / closing / download carry `tenderId`, org carries
// `orgName`, captcha carries `captchaId`. An org notification opens the page of that
// organisation's new tenders, which syncs and then shows its newest "new tenders" alert.

export type PushRoute =
  | { name: 'TenderDetail'; params: { id: string } }
  | { name: 'NewTenders'; params: { org: string } }
  | { name: 'OrgTenders'; params: { org: string } }
  | { name: 'Alerts' }
  | { name: 'Captcha' };

export function routeForPush(
  p: PushPayload | null | undefined,
): PushRoute | null {
  if (!p) return null;
  const tenderId =
    p.tenderId !== undefined && p.tenderId !== null && String(p.tenderId) !== ''
      ? String(p.tenderId)
      : null;
  switch (p.thread) {
    case 'tender':
    case 'closing':
    case 'download':
      return tenderId
        ? { name: 'TenderDetail', params: { id: tenderId } }
        : null;
    case 'org': {
      return p.orgName
        ? { name: 'NewTenders', params: { org: p.orgName } }
        : { name: 'Alerts' };
    }
    case 'captcha':
      return { name: 'Captcha' };
    default:
      // Anything else that names a tender opens it; otherwise Alerts.
      return tenderId
        ? { name: 'TenderDetail', params: { id: tenderId } }
        : { name: 'Alerts' };
  }
}
