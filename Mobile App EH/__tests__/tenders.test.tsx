import React from 'react';
import ReactTestRenderer, {
  ReactTestInstance,
  ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import App from '../App';

const flat = (j: any): string =>
  j == null
    ? ''
    : typeof j === 'string'
    ? j
    : Array.isArray(j)
    ? j.map(flat).join(' ')
    : flat(j.children);
const screenText = (r: Renderer) => flat(r.toJSON());
const content = (n: ReactTestInstance): string =>
  n.children.map(c => (typeof c === 'string' ? c : content(c))).join('');

async function mount() {
  let r!: Renderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<App />);
  });
  return r;
}

const pressables = (r: Renderer) =>
  r.root.findAll(n => {
    try {
      return typeof n.props.onPress === 'function';
    } catch {
      return false; // unmounted navigation scenes throw when inspected
    }
  });

async function pressText(r: Renderer, text: string, role = 'button') {
  // The Dashboard tab stays mounted, so take the last (Tenders-side) match.
  const node = pressables(r)
    .filter(
      n => n.props.accessibilityRole === role && content(n).includes(text),
    )
    .pop();
  if (!node) throw new Error(`No pressable with text "${text}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
}

async function pressLabel(r: Renderer, label: string) {
  const node = pressables(r).find(n => n.props.accessibilityLabel === label);
  if (!node) throw new Error(`No pressable labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
}

const collectLabels = (j: any, out: string[] = []): string[] => {
  if (!j || typeof j === 'string') return out;
  if (Array.isArray(j)) {
    j.forEach(x => collectLabels(x, out));
    return out;
  }
  if (j.props?.accessibilityLabel) out.push(String(j.props.accessibilityLabel));
  collectLabels(j.children, out);
  return out;
};
const labelled = (r: Renderer, pred: (label: string) => boolean) =>
  collectLabels(r.toJSON()).filter(pred);

async function openTenders(r: Renderer) {
  await pressLabel(r, 'Tenders');
}

describe('Tenders tab', () => {
  it('shows the portal row above the view switch, without an All option', async () => {
    const r = await mount();
    await openTenders(r);
    const all = screenText(r);
    const s = all.slice(all.indexOf('PORTAL'));
    [
      'PORTAL',
      'MahaTenders',
      'eProcure',
      'eTenders MH',
      'Organisations',
    ].forEach(x => expect(s).toContain(x));
    expect(s).not.toContain('All portals');
    expect(s.indexOf('PORTAL')).toBeLessThan(s.indexOf('Organisations'));
  });

  it('switches portals and lists organisations', async () => {
    const r = await mount();
    await openTenders(r);
    await pressText(r, 'eProcure');
    expect(screenText(r)).toContain('eProc/CPWD/2024/2211');
    expect(screenText(r)).not.toContain('MJP/2024/WS/318');
    await pressText(r, 'Organisations', 'tab');
    expect(screenText(r)).toContain('Central Public Works Department');
  });

  it('adds at most two custom filters', async () => {
    const r = await mount();
    await openTenders(r);
    await pressLabel(r, 'Add a custom filter');
    await pressText(r, 'Civil works');
    expect(labelled(r, l => l === 'Remove filter: Civil works')).toHaveLength(
      1,
    );
    await pressLabel(r, 'Add a custom filter');
    await pressText(r, 'Ratnagiri');
    expect(labelled(r, l => l.startsWith('Remove filter'))).toHaveLength(2);
    expect(labelled(r, l => l === 'Add a custom filter')).toHaveLength(0);
  });

  it('opens tender detail with documents and actions', async () => {
    const r = await mount();
    await openTenders(r);
    await pressText(r, '2024_PWD_1043567_1');
    const s = screenText(r);
    [
      'PUBLISHED DOCUMENTS',
      'Tender notice.pdf',
      'Add to Projects',
      'Open on portal',
      'EMD',
    ].forEach(x => expect(s).toContain(x));
  });
});

describe('Dashboard links', () => {
  it('opens Closing this week from See all', async () => {
    const r = await mount();
    await pressText(r, 'See all');
    expect(screenText(r)).toContain('Closing this week');
  });
});

describe('Bookmark controls', () => {
  const tendersSlice = (r: Renderer) => {
    const all = screenText(r);
    return all.slice(all.indexOf('PORTAL'));
  };

  it('lists Organisations before Tenders in the switch', async () => {
    const r = await mount();
    await openTenders(r);
    const order = pressables(r)
      .filter(n => n.props.accessibilityRole === 'tab')
      .map(content)
      .filter(c => c === 'Organisations' || c === 'Tenders');
    expect(order).toEqual(['Organisations', 'Tenders']);
  });

  it('star button shows only bookmarked tenders', async () => {
    const r = await mount();
    await openTenders(r);
    expect(tendersSlice(r)).toContain('2024_PWD_1041902_1');
    await pressLabel(r, 'Show bookmarked tenders only');
    const s = tendersSlice(r);
    expect(s).toContain('MJP/2024/WS/318');
    expect(s).not.toContain('2024_PWD_1041902_1');
  });

  it('ribbon button shows only bookmarked organisations', async () => {
    const r = await mount();
    await openTenders(r);
    await pressText(r, 'Organisations', 'tab');
    expect(tendersSlice(r)).toContain('Public Works Department, Konkan Region');
    await pressLabel(r, 'Show bookmarked organisations only');
    const s = tendersSlice(r);
    expect(s).toContain('Maharashtra Jeevan Pradhikaran');
    expect(s).not.toContain('Public Works Department, Konkan Region');
  });

  it('bookmarks an organisation from its card', async () => {
    const r = await mount();
    await openTenders(r);
    await pressText(r, 'Organisations', 'tab');
    await pressLabel(r, 'Bookmark organisation');
    expect(labelled(r, l => l === 'Remove organisation bookmark')).toHaveLength(
      2,
    );
  });
});
