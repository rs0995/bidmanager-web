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
  const node = pressables(r)
    .filter(n => n.props.accessibilityLabel === label)
    .pop();
  if (!node) throw new Error(`No pressable labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
}

describe('New tenders screen', () => {
  it('opens from a "new tenders" alert, newest first, with a link to the org', async () => {
    const r = await mount();
    await pressLabel(r, 'Alerts');
    await pressText(r, 'added 2 new tenders');
    const all = screenText(r);
    // The Dashboard tab stays mounted underneath: read from this screen's subtitle on.
    const s = all.slice(all.indexOf('2 new tenders, newest first'));
    expect(s).toContain('2 new tenders, newest first');
    // 21-Aug is newer than 19-Aug.
    expect(s.indexOf('MCGM/RD/2024/1601')).toBeGreaterThan(-1);
    expect(s.indexOf('MCGM/RD/2024/1601')).toBeLessThan(
      s.indexOf('MCGM/SWD/2024/1567'),
    );
    expect(s).toMatch(
      /View all tenders from\s+Municipal Corp\. of Greater Mumbai/,
    );
  });
});
