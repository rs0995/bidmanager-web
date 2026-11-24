import { tenders } from '../src/fixtures/tenders';
import { relativeTime } from '../src/app/screens/MoreScreen';
import { timeLeftPill } from '../src/app/screens/ProjectsScreen';
import { groupAlerts, isToday } from '../src/lib/alertGroups';
import { listTenders, nextPortal } from '../src/lib/tenderList';
import { readyCount } from '../src/components/project/ReadyChecklist';
import { prepMeta } from '../src/fixtures/projects';
import {
  ACCENT_KEYS,
  accentSwatch,
  buildTheme,
  DEFAULT_PREFS,
} from '../src/theme/tokens';
import type { AlertItem } from '../src/fixtures/alerts';

const base = {
  portal: null,
  org: null,
  search: '',
  savedOnly: false,
  closingSoon: false,
  sort: 'closing' as const,
  isSaved: () => false,
};

describe('tender list', () => {
  it('lists every portal, soonest first', () => {
    const list = listTenders(tenders, base);
    expect(list).toHaveLength(tenders.length);
    expect(list[0].closeIn).toBe('6h');
  });

  it('filters by org, saved and closing within 5 days', () => {
    const org = 'Maharashtra Jeevan Pradhikaran';
    expect(
      listTenders(tenders, { ...base, org }).every(t => t.org === org),
    ).toBe(true);
    const saved = listTenders(tenders, {
      ...base,
      savedOnly: true,
      isSaved: id => id === 'MJP/2024/WS/318',
    });
    expect(saved.map(t => t.id)).toEqual(['MJP/2024/WS/318']);
    const soon = listTenders(tenders, { ...base, closingSoon: true });
    expect(soon.length).toBeGreaterThan(0);
    expect(
      soon.every(
        t => !/^(\d+)d/.test(t.closeIn) || parseInt(t.closeIn, 10) <= 5,
      ),
    ).toBe(true);
  });

  it('sorts by value', () => {
    const list = listTenders(tenders, { ...base, sort: 'value' });
    const v = (s: string) => parseFloat(s.replace(/[^0-9.]/g, ''));
    expect(v(list[0].value)).toBeGreaterThanOrEqual(v(list[1].value));
  });

  it('cycles portals back to All', () => {
    const ps = ['A', 'B'];
    expect(nextPortal(null, ps)).toBe('A');
    expect(nextPortal('A', ps)).toBe('B');
    expect(nextPortal('B', ps)).toBeNull();
  });
});

describe('alerts', () => {
  const a = (id: string, time: string, unread: boolean): AlertItem => ({
    id,
    kind: 'change',
    message: '',
    time,
    unread,
  });

  it('splits Today and Earlier', () => {
    expect(isToday('22 min ago')).toBe(true);
    expect(isToday('Updated 4 min ago')).toBe(true);
    expect(isToday('2 hours ago')).toBe(true);
    expect(isToday('Yesterday')).toBe(false);
    expect(isToday('22-Aug')).toBe(false);
    const groups = groupAlerts(
      [a('1', '5 min ago', true), a('2', 'Yesterday', false)],
      false,
    );
    expect(groups.map(g => g.name)).toEqual(['Today', 'Earlier']);
  });

  it('drops read alerts and empty groups when Unread is on', () => {
    const groups = groupAlerts(
      [a('1', '5 min ago', true), a('2', 'Yesterday', false)],
      true,
    );
    expect(groups.map(g => g.name)).toEqual(['Today']);
  });
});

describe('Ready for Bid', () => {
  it('counts ready items', () => {
    expect(
      readyCount([
        { key: 'a', name: 'a', done: true, file: 'x.pdf' },
        { key: 'b', name: 'b', done: false },
        { key: 'c', name: 'c', done: false },
      ]),
    ).toBe('1 of 3 ready');
    expect(readyCount([])).toBe('No items yet');
  });

  it('labels prep files', () => {
    expect(prepMeta('Cost estimate.xlsx')).toBe('Spreadsheet · Added by you');
    expect(prepMeta('Draft.docx')).toBe('Document · Added by you');
  });
});

describe('theme', () => {
  it('splits the Mono swatch white and black; Mono is black in light, white in dark', () => {
    expect(accentSwatch('mono')).toEqual({ fill: '#ffffff', split: '#22262d' });
    expect(accentSwatch('green')).toEqual({ fill: '#426932', split: null });
    const mono = (scheme: 'light' | 'dark') =>
      buildTheme(scheme, { mode: scheme, accent: 'mono', style: 'solid' })
        .colors.accent;
    expect(mono('light')).toBe('#22262d');
    expect(mono('dark')).toBe('#f3f4f6');
  });

  it('falls back to green for a removed accent saved on the device', () => {
    const t = buildTheme('light', {
      mode: 'light',
      accent: 'teal' as never,
      style: 'solid',
    });
    expect(t.colors.accent).toBe('#426932');
  });

  it('defaults to green, solid, system', () => {
    expect(DEFAULT_PREFS).toEqual({
      mode: 'system',
      accent: 'green',
      style: 'solid',
    });
  });

  it('builds every accent in both schemes and styles', () => {
    expect(ACCENT_KEYS).toEqual(['green', 'indigo', 'orange', 'rose', 'mono']);
    for (const accent of ACCENT_KEYS)
      for (const scheme of ['light', 'dark'] as const)
        for (const style of ['solid', 'glass', 'paper'] as const) {
          const t = buildTheme(scheme, { mode: scheme, accent, style });
          expect(t.colors.accent).toMatch(/^#/);
          expect(t.isGlass).toBe(style === 'glass');
        }
  });

  it('uses the reference surfaces', () => {
    const light = buildTheme('light', DEFAULT_PREFS);
    expect(light.colors.bg).toBe('#f6f7f8');
    expect(light.colors.accent).toBe('#426932');
    const glass = buildTheme('light', { ...DEFAULT_PREFS, style: 'glass' });
    expect(glass.colors.bg).toBe('#eeebf5');
    expect(glass.glass.orbs).toHaveLength(5);
  });

  it('Paper is BM Pro\'s theme: paper page, white cards, fixed indigo', () => {
    for (const accent of ACCENT_KEYS) {
      const light = buildTheme('light', { mode: 'light', accent, style: 'paper' });
      expect(light.colors.bg).toBe('#f2f1ec');
      expect(light.colors.surface).toBe('#ffffff');
      expect(light.colors.accent).toBe('#3a3fd4');
      expect(light.isGlass).toBe(false);
      const dark = buildTheme('dark', { mode: 'dark', accent, style: 'paper' });
      expect(dark.colors.bg).toBe('#0e0f13');
      expect(dark.colors.accent).toBe('#8a8dfb');
    }
  });
});

// WCAG relative luminance / contrast ratio.
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('Paper contrast (AA)', () => {
  const pages = { light: ['#ffffff', '#f2f1ec'], dark: ['#191b22', '#0e0f13'] };
  for (const scheme of ['light', 'dark'] as const)
    it(scheme, () => {
      const c = buildTheme(scheme, { mode: scheme, accent: 'green', style: 'paper' }).colors;
      pages[scheme].forEach(bg => {
        expect(contrast(c.accent, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.ink, bg)).toBeGreaterThanOrEqual(4.5);
      });
      expect(contrast(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.accentInk, c.accentWash)).toBeGreaterThanOrEqual(4.5);
    });
});

describe('accent contrast (AA)', () => {
  // Cards and pages. In glass mode text sits on frosted cards, lighter than the glass page.
  const backgrounds = {
    light: ['#ffffff', '#f6f7f8'],
    dark: ['#272b32', '#1b1d22', '#22212c'],
  };
  for (const accent of ACCENT_KEYS)
    for (const scheme of ['light', 'dark'] as const)
      it(`${accent} ${scheme}`, () => {
        const c = buildTheme(scheme, {
          mode: scheme,
          accent,
          style: 'solid',
        }).colors;
        backgrounds[scheme].forEach(bg =>
          expect(contrast(c.accent, bg)).toBeGreaterThanOrEqual(4.5),
        );
        expect(contrast(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.deep, c.tint)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.accentInk, c.accentWash)).toBeGreaterThanOrEqual(4.5);
      });
});

describe('More', () => {
  it('shows the last sync like BM Pro', () => {
    const now = 1_000_000_000;
    expect(relativeTime(null, now)).toBe('never');
    expect(relativeTime(now - 20_000, now)).toBe('just now');
    expect(relativeTime(now - 4 * 60_000, now)).toBe('4 min ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
  });
});

// Midpoint of two hex colours (where gradient labels sit).
const midpoint = (a: string, b: string) =>
  '#' +
  [1, 3, 5]
    .map(i =>
      Math.round(
        (parseInt(a.slice(i, i + 2), 16) + parseInt(b.slice(i, i + 2), 16)) / 2,
      )
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

describe('accent gradients', () => {
  it('blend toward a visibly brighter shade and keep white labels readable', () => {
    for (const accent of ACCENT_KEYS) {
      if (accent === 'mono') continue;
      const c = buildTheme('light', {
        mode: 'light',
        accent,
        style: 'solid',
      }).colors;
      expect(c.accent2).not.toBe(c.deep);
      // Every accent shades about as much as green does.
      expect(contrast(c.accent, c.accent2)).toBeGreaterThanOrEqual(1.45);
      expect(
        contrast('#ffffff', midpoint(c.accent, c.accent2)),
      ).toBeGreaterThanOrEqual(3.5);
    }
  });
});

describe('project time-left pill (BM Pro colours)', () => {
  it('is red within 3 days, amber within a week, green beyond, muted when closed', () => {
    expect(timeLeftPill('6h')).toEqual({ label: '6h left', tone: 'crit' });
    expect(timeLeftPill('2d 4h')).toEqual({ label: '2d left', tone: 'crit' });
    expect(timeLeftPill('6d')).toEqual({ label: '6d left', tone: 'warn' });
    expect(timeLeftPill('11d')).toEqual({ label: '11d left', tone: 'good' });
    expect(timeLeftPill('Closed')).toEqual({ label: 'Closed', tone: 'muted' });
  });
});
