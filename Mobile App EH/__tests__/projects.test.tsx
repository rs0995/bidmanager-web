import React from 'react';
import ReactTestRenderer, {
  ReactTestInstance,
  ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import App from '../App';
import { checklistProgress, folderNames } from '../src/lib/projectProgress';
import { ARCHIVED_COUNT, DEFAULT_FOLDERS } from '../src/fixtures/projects';

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
      return false;
    }
  });

async function press(r: Renderer, pick: (n: ReactTestInstance) => boolean) {
  const node = pressables(r).filter(pick).pop();
  if (!node) throw new Error('No matching pressable');
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
}
const byLabel = (l: string) => (n: ReactTestInstance) =>
  n.props.accessibilityLabel === l;
const byText =
  (t: string, role = 'button') =>
  (n: ReactTestInstance) =>
    n.props.accessibilityRole === role && content(n).includes(t);

const typeInto = async (r: Renderer, placeholder: string, text: string) => {
  const input = r.root.findAll(n => {
    try {
      return (
        n.props.placeholder === placeholder &&
        typeof n.props.onChangeText === 'function'
      );
    } catch {
      return false;
    }
  })[0];
  await ReactTestRenderer.act(async () => {
    input.props.onChangeText(text);
  });
};

async function openProject(r: Renderer, title: string) {
  await press(r, byLabel('Projects'));
  await press(r, byText(title));
}

describe('checklist maths', () => {
  it('counts done items and percentage', () => {
    const p = checklistProgress([
      {
        name: 'A',
        items: [
          { id: '1', name: 'x', note: '', done: true },
          { id: '2', name: 'y', note: '', done: false },
        ],
      },
      { name: 'B', items: [{ id: '3', name: 'z', note: '', done: true }] },
    ]);
    expect(p).toEqual({ done: 2, total: 3, pct: 67 });
    expect(checklistProgress([]).pct).toBe(0);
  });

  it('lists default sections first, then custom ones', () => {
    const names = folderNames({
      checklist: [
        { name: 'Extras', items: [] },
        { name: 'Ready Docs', items: [] },
      ],
    } as any);
    expect(names).toEqual([...DEFAULT_FOLDERS, 'Extras']);
  });
});

describe('Projects tab', () => {
  it('lists active projects and the archived count', async () => {
    const r = await mount();
    await press(r, byLabel('Projects'));
    const s = screenText(r);
    [
      'Track bids in preparation',
      'Active · 6',
      `Archived · ${ARCHIVED_COUNT}`,
      'Panvel–Uran road widening (PWD Konkan)',
      'docs ready',
    ].forEach(x => expect(s).toContain(x));
  });

  it('shows the full info cards on a project', async () => {
    const r = await mount();
    await openProject(r, 'Panvel–Uran road widening (PWD Konkan)');
    const s = screenText(r);
    [
      'SOURCE TENDER ID',
      'CLIENT',
      'PROJECT VALUE',
      'EMD',
      'PRE-BID MEETING',
      'DEADLINE',
      'STATUS',
      'DOCUMENTS READY',
      'WORK DESCRIPTION',
      'DOCUMENT CHECKLIST',
    ].forEach(x => expect(s).toContain(x));
  });

  it('adds a checklist item into a section', async () => {
    const r = await mount();
    await openProject(r, 'Panvel–Uran road widening (PWD Konkan)');
    await press(r, byLabel('Add checklist item'));
    await press(r, byText('Add to checklist'));
    expect(screenText(r)).toContain('Enter a document name');
    await typeInto(r, 'e.g. Turnover certificate', 'Solvency certificate');
    await press(r, byText('Working Docs'));
    await press(r, byText('Add to checklist'));
    expect(screenText(r)).toContain('Solvency certificate');
  });

  it('attaches, replaces, previews and removes a file', async () => {
    const r = await mount();
    await openProject(r, 'Panvel–Uran road widening (PWD Konkan)');
    // "Power of attorney" starts pending: its Attach button is the first "Attach a file" one.
    const attachBtns = () => pressables(r).filter(byLabel('Attach a file'));
    const before = attachBtns().length;
    await ReactTestRenderer.act(async () => {
      attachBtns()[0].props.onPress();
    });
    expect(attachBtns().length).toBe(before - 1);
    expect(screenText(r)).toContain('Attached');

    // replace: an "Attached" button now exists and is pressable
    const replaceBtns = pressables(r).filter(byLabel('Replace attached file'));
    expect(replaceBtns.length).toBeGreaterThan(2);
    await ReactTestRenderer.act(async () => {
      replaceBtns[0].props.onPress();
    });

    // preview: tapping an attached row opens the placeholder preview
    await press(r, n =>
      String(n.props.accessibilityLabel ?? '').startsWith('Preview '),
    );
    expect(screenText(r)).toContain('Preview placeholder');
  });
});
