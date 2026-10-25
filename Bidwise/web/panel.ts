/// <reference lib="dom" />
import {
  ACCENT_KEYS,
  ACCENTS,
  accentSwatch,
  ThemePrefs,
} from '../src/theme/tokens';

// Browser-preview-only control panel for theme options. Not part of the app.

type Bridge = { get: () => ThemePrefs; set: (p: Partial<ThemePrefs>) => void };
const bridge = () => (globalThis as { __bwTheme?: Bridge }).__bwTheme;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};

function group<K extends keyof ThemePrefs>(
  title: string,
  key: K,
  options: { value: ThemePrefs[K]; label: string; color?: string }[],
) {
  const wrap = el('div', 'grp');
  wrap.appendChild(el('div', 'ttl', title));
  const row = el('div', 'row');
  const buttons: { value: ThemePrefs[K]; node: HTMLButtonElement }[] = [];
  options.forEach(o => {
    const b = el('button', o.color ? 'sw' : 'opt', o.color ? '' : o.label);
    b.title = o.label;
    if (o.color) b.style.background = o.color;
    b.onclick = () => {
      bridge()?.set({ [key]: o.value } as Partial<ThemePrefs>);
      setTimeout(sync, 30);
    };
    row.appendChild(b);
    buttons.push({ value: o.value, node: b });
  });
  wrap.appendChild(row);
  return {
    node: wrap,
    sync: (prefs: ThemePrefs) =>
      buttons.forEach(b =>
        b.node.setAttribute('aria-pressed', String(prefs[key] === b.value)),
      ),
  };
}

const groups = [
  group('Display', 'style', [
    { value: 'solid', label: 'Solid' },
    { value: 'glass', label: 'Liquid glass' },
  ]),
  group('Mode', 'mode', [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ]),
  group(
    'Accent',
    'accent',
    ACCENT_KEYS.map(k => ({
      value: k,
      label: ACCENTS[k].label,
      color: accentSwatch(k).fill,
    })),
  ),
];

function sync() {
  const prefs = bridge()?.get();
  if (prefs) groups.forEach(g => g.sync(prefs));
}

export function mountPanel() {
  const panel = el('div', 'bm-panel');
  panel.appendChild(el('div', 'hd', 'Preview controls'));
  groups.forEach(g => panel.appendChild(g.node));
  document.body.appendChild(panel);
  setInterval(sync, 600);
}
