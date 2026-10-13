import { needsAttention } from '../src/lib/attention';
import {
  groupUpcoming,
  hoursUntilClose,
  leftLabel,
} from '../src/lib/deadlines';
import { formatCrores, parseCrores } from '../src/lib/format';
import { tenders } from '../src/fixtures/tenders';
import type { Project } from '../src/fixtures/projects';

const project = (sourceTenderId: string, files: number): Project =>
  ({
    id: `P-${sourceTenderId}`,
    sourceTenderId,
    checklist: [
      {
        name: 'Ready Docs',
        items: Array.from({ length: 3 }).map((_, i) => ({
          id: `i${i}`,
          name: 'x',
          note: '',
          done: false,
          file: i < files ? 'a.pdf' : undefined,
        })),
      },
    ],
  } as unknown as Project);

describe('deadline helpers', () => {
  it('reads hours from the countdown text', () => {
    expect(hoursUntilClose('6h')).toBe(6);
    expect(hoursUntilClose('2d 4h')).toBe(52);
    expect(hoursUntilClose('13d')).toBe(312);
    expect(leftLabel('2d 4h')).toBe('2d left');
    expect(leftLabel('6h')).toBe('6h left');
  });

  it('groups soonest tenders Critical, Soon, Later', () => {
    const groups = groupUpcoming(tenders, 8);
    expect(groups.map(g => g.label)).toEqual(['CRITICAL', 'SOON', 'LATER']);
    expect(groups[0].items[0].id).toBe('eProc/CPWD/2024/2211');
    const flat = groups.flatMap(g => g.items);
    expect(flat).toHaveLength(8);
  });
});

describe('needsAttention', () => {
  const bookmarked = (ids: string[]) => (id: string) => ids.includes(id);

  it('flags bookmarked tenders closing within 3 days with no documents', () => {
    const res = needsAttention(
      tenders,
      [project('eProc/CPWD/2024/2211', 0)],
      bookmarked(['2024_PWD_1043567_1']),
    );
    // Nagpur (6h, project with no files) and Panvel–Uran (2d 4h, bookmarked, no project)
    expect(res.map(r => r.tender.id)).toEqual([
      'eProc/CPWD/2024/2211',
      '2024_PWD_1043567_1',
    ]);
    expect(res[0].level).toBe('crit');
    expect(res[1].level).toBe('soon');
  });

  it('skips tenders whose project already has an attached file', () => {
    const res = needsAttention(
      tenders,
      [project('eProc/CPWD/2024/2211', 1)],
      bookmarked([]),
    );
    expect(res).toHaveLength(0);
  });
});

describe('value formatting', () => {
  it('parses and formats crores', () => {
    expect(parseCrores('₹42.80 Cr')).toBe(42.8);
    expect(formatCrores(182.7239)).toBe('₹182.72');
  });
});
