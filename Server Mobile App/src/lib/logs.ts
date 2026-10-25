import { useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { useSession } from '../state/session';
import type { LogLevel, LogLine } from './types';

export const LOG_BUFFER = 500;
const POLL_MS = 2_000;

export const LOG_SOURCES = ['api', 'scraper', 'storage', 'worker', 'db'] as const;

// Server log lines are plain text, so level and source are guessed from the
// message with the same rules as the desktop (BidManagerControl.jsx
// _classifyLogLine). Best-effort labelling, not data from the server.
export function classify(entry: { seq: number; ts: number; text: string }): LogLine {
  const text = String(entry.text ?? '');
  const lower = text.toLowerCase();
  const level: LogLevel = /error|exception|traceback/.test(lower)
    ? 'error'
    : /warn/.test(lower)
    ? 'warn'
    : 'info';
  let source = 'api';
  if (/captcha|session|portal|scraper|selenium|chrome/.test(lower)) source = 'scraper';
  else if (/upload|download|gcs|drive|storage|bucket/.test(lower)) source = 'storage';
  else if (/\bjob\b|queued|claimed|worker/.test(lower)) source = 'worker';
  else if (/\bsql\b|postgres|sqlite|upsert|database|\btable\b/.test(lower)) source = 'db';
  return {
    seq: entry.seq,
    ts: Number.isFinite(entry.ts) ? entry.ts * 1000 : Date.now(),
    level,
    source,
    message: text,
  };
}

/**
 * Live server log: the last lines on open, then every new line (by `seq`) every
 * 2 s while `follow` is on and the screen is focused. Keeps the last 500.
 */
export function useLiveLogs(follow: boolean) {
  const { api, adminKey } = useSession();
  const focused = useIsFocused();
  const [lines, setLines] = useState<LogLine[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const lastSeq = useRef(0);

  // A new server or key starts a fresh log.
  useEffect(() => {
    lastSeq.current = 0;
    setLines([]);
    setLoaded(false);
  }, [api]);

  useEffect(() => {
    if (!adminKey || !focused || (!follow && loaded)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const page = await api.logs(lastSeq.current);
        if (cancelled) return;
        const fresh = page.entries.filter(e => {
          // A far lower seq means the server restarted and its counter reset.
          if (e.seq < lastSeq.current - 100) lastSeq.current = 0;
          return e.seq > lastSeq.current;
        });
        if (fresh.length) {
          lastSeq.current = fresh[fresh.length - 1].seq;
          setLines(ls => [...ls, ...fresh.map(classify)].slice(-LOG_BUFFER));
        }
        setError('');
        setLoaded(true);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || 'Could not load logs');
      }
      if (!cancelled && follow) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [api, adminKey, focused, follow, loaded]);

  return { lines, error, loaded };
}
