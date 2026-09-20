import { ACCENT_KEYS, buildTheme, DEFAULT_PREFS } from '../src/theme/tokens';

describe('buildTheme', () => {
  it('uses white base by default and paper base on request (light, solid)', () => {
    expect(buildTheme('light', DEFAULT_PREFS).colors.bg).toBe('#ffffff');
    expect(
      buildTheme('light', { ...DEFAULT_PREFS, base: 'paper' }).colors.bg,
    ).toBe('#f2f1ec');
  });

  it('ignores the paper base in dark and in glass', () => {
    const dark = buildTheme('dark', { ...DEFAULT_PREFS, base: 'paper' });
    expect(dark.colors.bg).toBe('#131017');
    const glass = buildTheme('light', {
      ...DEFAULT_PREFS,
      base: 'paper',
      style: 'glass',
    });
    expect(glass.isGlass).toBe(true);
    expect(glass.colors.bg).toBe('#eceaf5');
  });

  it('turns the Ink accent white in dark theme', () => {
    const t = buildTheme('dark', { ...DEFAULT_PREFS, accent: 'ink' });
    expect(t.colors.accent).toBe('#f4f2f8');
    expect(t.colors.onAccent).toBe('#18151f');
  });

  it('resolves every accent in both schemes', () => {
    for (const accent of ACCENT_KEYS) {
      for (const scheme of ['light', 'dark'] as const) {
        const t = buildTheme(scheme, { ...DEFAULT_PREFS, accent });
        expect(t.colors.accent).toMatch(/^#/);
        expect(t.colors.accent2).toMatch(/^#/);
      }
    }
  });
});
