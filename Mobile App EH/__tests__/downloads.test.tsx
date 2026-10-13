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

async function pressLabel(r: Renderer, label: string) {
  const node = pressables(r)
    .filter(n => n.props.accessibilityLabel === label)
    .pop();
  if (!node) throw new Error(`No pressable labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
}

async function pressText(r: Renderer, text: string) {
  const node = pressables(r)
    .filter(n => n.props.accessibilityRole === 'button')
    .filter(n => content(n).includes(text))
    .pop();
  if (!node) throw new Error(`No pressable with text "${text}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
}

const openDownloads = async (r: Renderer) => {
  await pressLabel(r, 'More');
  await pressLabel(r, 'Downloads');
};

// The tab screens stay mounted underneath: read from the pushed screen's title on.
const fromLast = (r: Renderer, marker: string) => {
  const all = screenText(r);
  return all.slice(all.lastIndexOf(marker));
};

describe('Downloads', () => {
  it('lists requests and downloads with their status', async () => {
    const r = await mount();
    await openDownloads(r);
    const s = fromLast(r, 'Downloads');
    expect(s).toContain('2 in progress');
    ['Ready', 'Downloading…', 'Requested…', 'Failed'].forEach(x =>
      expect(s).toContain(x),
    );
    expect(s).toContain('The portal did not respond');
  });

  it('opens a ready PDF in the viewer', async () => {
    const r = await mount();
    await openDownloads(r);
    await pressLabel(
      r,
      'Panvel–Uran road widening — NIT & instructions to bidders.pdf',
    );
    // Header: title, then the tender as subtitle; then the page.
    const s = fromLast(r, 'NIT & instructions to bidders.pdf');
    expect(s).toContain('Preview placeholder');
  });

  it('opens a ZIP, lists its files, and views a PDF inside it', async () => {
    const r = await mount();
    await openDownloads(r);
    await pressLabel(r, 'CPWD Nagpur staff quarters ph-II — All documents');
    let s = fromLast(r, 'All documents');
    ['Tender notice.pdf', 'BOQ.xls', 'Site drawings.dwg', '5.1 MB'].forEach(x =>
      expect(s).toContain(x),
    );
    await pressLabel(r, 'Special conditions.pdf');
    s = fromLast(r, 'Special conditions.pdf');
    expect(s).toContain('Preview placeholder');
  });

  it('does not open a failed or pending download', async () => {
    const r = await mount();
    await openDownloads(r);
    const failed = pressables(r)
      .filter(
        n =>
          n.props.accessibilityLabel ===
          'Chiplun 24 MLD water treatment plant — Corrigendum I.pdf',
      )
      .pop();
    expect(failed?.props.accessibilityState).toEqual({ disabled: true });
  });

  it('adds a "Requested" row when a tender document is requested', async () => {
    const r = await mount();
    await pressLabel(r, 'Tenders');
    await pressText(r, '2024_PWD_1043567_1');
    await pressText(r, 'BOQ.xls');
    await openDownloads(r);
    expect(fromLast(r, 'Downloads')).toContain('3 in progress');
  });
});
