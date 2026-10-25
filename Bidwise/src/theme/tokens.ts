// bidwise design tokens. Colours come from reference/bidwise-preview.html (the "Focus" design):
// the reference's Green, Indigo, Orange and Rose plus Mono, each as [accent, tint, deep, wash,
// edge, on?] for light and dark, over solid or glass surfaces. `on` is the text/icon colour on an
// accent fill (white in light, `deep` in dark when omitted).

export type ThemeMode = 'system' | 'light' | 'dark';
export type AccentKey = 'green' | 'indigo' | 'orange' | 'rose' | 'mono';
/**
 * "Display" in the UI: solid surfaces, liquid glass, or Paper (BM Pro's own theme: white
 * cards on a warm paper background with its fixed indigo accent; no accent choice).
 */
export type StyleKey = 'solid' | 'glass' | 'paper';
export type Scheme = 'light' | 'dark';

export type ThemePrefs = {
  mode: ThemeMode;
  accent: AccentKey;
  style: StyleKey;
};

export const DEFAULT_PREFS: ThemePrefs = {
  mode: 'system',
  accent: 'green',
  style: 'solid',
};

type Palette = [
  accent: string,
  tint: string,
  deep: string,
  wash: string,
  edge: string,
  on?: string,
];

export const ACCENTS: Record<
  AccentKey,
  { label: string; light: Palette; dark: Palette }
> = {
  green: {
    label: 'Green',
    light: ['#426932', '#c6e7a5', '#2c4523', '#edf4e6', '#d9e7ce'],
    dark: ['#c6e7a5', '#c6e7a5', '#263d1d', '#303c2c', '#45543d'],
  },
  indigo: {
    label: 'Indigo',
    light: ['#4f46c8', '#d4d4ff', '#363078', '#efefff', '#dcdcf6'],
    dark: ['#b1afff', '#c9c7ff', '#302966', '#30304b', '#464465'],
  },
  orange: {
    label: 'Orange',
    light: ['#b25615', '#ffdab4', '#9c4708', '#fff2e5', '#f3dfc9'],
    dark: ['#f3b781', '#ffd3ab', '#64340e', '#483629', '#65503c'],
  },
  rose: {
    label: 'Rose',
    light: ['#ad426c', '#f6cadb', '#792b49', '#fdf0f5', '#f0d6e1'],
    dark: ['#efa5c0', '#f4c7d8', '#64253f', '#462e39', '#62424f'],
  },
  // No colour: black in light mode, white in dark mode.
  mono: {
    label: 'Mono',
    light: ['#22262d', '#e3e6ea', '#111316', '#ebebec', '#c6c7c8'],
    dark: ['#f3f4f6', '#ffffff', '#1b1d22', '#484b51', '#707379', '#1b1d22'],
  },
};

export const ACCENT_KEYS = Object.keys(ACCENTS) as AccentKey[];

/**
 * Light-mode gradient partner for each accent: a brighter shade of the same hue, so
 * gradients (buttons, rings, progress) glow instead of sinking into the dark `deep` shade.
 * Each sits a similar step from its accent (≈1.5–1.7:1) so every gradient reads as shaded;
 * white text stays ≥ 3.5:1 across the middle of the gradient, where labels sit.
 */
const ACCENT_BRIGHT: Record<AccentKey, string> = {
  green: '#5c8c42',
  indigo: '#6a62e2',
  orange: '#e47a22',
  rose: '#d4628f',
  mono: '#4a505a',
};

/**
 * Swatch for the accent circles in More's Theme row. Mono is drawn split: white and black either side of a
 * diagonal line.
 */
export function accentSwatch(k: AccentKey) {
  if (k === 'mono') return { fill: '#ffffff', split: '#22262d' };
  return { fill: ACCENTS[k].light[0], split: null };
}

type Surfaces = {
  bg: string;
  surface: string;
  surfaceSoft: string;
  surfaceSunk: string;
  ink: string;
  inkSoft: string;
  muted: string;
  hair: string;
};

const LIGHT: Surfaces = {
  bg: '#f6f7f8',
  surface: '#ffffff',
  surfaceSoft: '#fbfbfc',
  surfaceSunk: '#eceef1',
  ink: '#252a32',
  inkSoft: '#4a525e',
  muted: '#747d89',
  hair: '#e3e6eb',
};

const DARK: Surfaces = {
  bg: '#1b1d22',
  surface: '#272b32',
  surfaceSoft: '#2e333b',
  surfaceSunk: '#22252b',
  ink: '#eff1f5',
  inkSoft: '#cbd1da',
  muted: '#a5aebb',
  hair: '#3b414b',
};

/** Deadline urgency: Critical (<1 day), Soon (1–5 days), Comfortable (>5 days). */
const SEMANTIC = {
  light: {
    good: '#4b7f55',
    goodWash: '#e6f1e7',
    warn: '#aa7a44',
    warnWash: '#f7eddf',
    crit: '#b94f53',
    critWash: '#f8e5e5',
  },
  dark: {
    good: '#8bceaa',
    goodWash: '#1f3329',
    warn: '#ddb17d',
    warnWash: '#3a2e1f',
    crit: '#f2989d',
    critWash: '#3d2426',
  },
};

/** BM Pro's theme (Mobile App RN src/theme-new), used by the Paper display. */
const PAPER_LIGHT: Surfaces = {
  bg: '#f2f1ec',
  surface: '#ffffff',
  surfaceSoft: '#f6f5f1',
  surfaceSunk: '#ecebe4',
  ink: '#1b1d24',
  inkSoft: '#474a56',
  muted: '#797d8c',
  hair: '#e2e0d7',
};

const PAPER_DARK: Surfaces = {
  bg: '#0e0f13',
  surface: '#191b22',
  surfaceSoft: '#1f222b',
  surfaceSunk: '#14161c',
  ink: '#f0eff4',
  inkSoft: '#c8c8d2',
  muted: '#878a98',
  hair: '#2b2e38',
};

const PAPER_SEMANTIC = {
  light: {
    good: '#12805c',
    goodWash: '#dcefe4',
    warn: '#b46a06',
    warnWash: '#f2e3ce',
    crit: '#c8324b',
    critWash: '#f8e3e6',
  },
  dark: {
    good: '#4bbf95',
    goodWash: '#16281f',
    warn: '#d99a4a',
    warnWash: '#2a2116',
    crit: '#e8697f',
    critWash: '#2c1720',
  },
};

/** BM Pro's indigo, in the same [accent, tint, deep, wash, edge, on] shape. */
export const PAPER_ACCENT: Record<Scheme, Palette> = {
  light: ['#3a3fd4', '#c9cbf7', '#2b2fae', '#ececfb', '#d6d7f5', '#ffffff'],
  dark: ['#8a8dfb', '#a7a9ff', '#1b1d3a', '#23253a', '#34375a', '#0e0f13'],
};
const PAPER_ACCENT2: Record<Scheme, string> = {
  light: '#5a5ff0',
  dark: '#a7a9ff',
};

/**
 * bidwise brand mark: two slanted slabs (white to ice blue) on a near-black tile with a
 * warm orange glow from below, then the word. Matches the app icon.
 */
export const BRAND = {
  tile: '#0b0c10',
  glow: '#ff7a1a',
  glowDeep: '#c2410c',
  glowRim: '#ffa05a',
  slabTop: '#ffffff',
  slabBottom: '#bfe3ff',
  wordLight: '#192f43',
  wordDark: '#f1f4f7',
};

type GlassSet = {
  bg: string;
  fill: string;
  fillStrong: string;
  border: string;
  edge: string;
  surfaceSunk: string;
  hair: string;
  screenA: string;
  screenB: string;
  /** Background blobs: peach, lavender, orchid, apricot, periwinkle. */
  orbs: [string, string, string, string, string];
  shadowColor: string;
  blurType: 'light' | 'dark';
};

const GLASS_LIGHT: GlassSet = {
  bg: '#eeebf5',
  fill: 'rgba(255,255,255,0.44)',
  fillStrong: 'rgba(255,255,255,0.62)',
  border: 'rgba(255,255,255,0.88)',
  edge: 'rgba(255,255,255,0.94)',
  surfaceSunk: 'rgba(80,68,106,0.10)',
  hair: 'rgba(80,68,106,0.13)',
  screenA: '#efedf6',
  screenB: '#eae6f3',
  orbs: ['#ffc8a2', '#a6a7f0', '#e7b6f8', '#ffcf9f', '#a2a5f1'],
  shadowColor: '#4a4165',
  blurType: 'light',
};

const GLASS_DARK: GlassSet = {
  bg: '#22212c',
  fill: 'rgba(39,37,54,0.44)',
  fillStrong: 'rgba(39,37,54,0.62)',
  border: 'rgba(255,255,255,0.25)',
  edge: 'rgba(255,255,255,0.32)',
  surfaceSunk: 'rgba(255,255,255,0.08)',
  hair: 'rgba(255,255,255,0.12)',
  screenA: '#23222e',
  screenB: '#1f1e29',
  orbs: ['#9d674a', '#5a5b9a', '#895398', '#9e7650', '#565d9d'],
  shadowColor: '#000000',
  blurType: 'dark',
};

export type ShadowStyle = {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
};

export type Theme = {
  scheme: Scheme;
  style: StyleKey;
  isGlass: boolean;
  colors: Surfaces & {
    accent: string;
    accent2: string;
    accentWash: string;
    accentInk: string;
    onAccent: string;
    tint: string;
    deep: string;
    edge: string;
    good: string;
    goodWash: string;
    warn: string;
    warnWash: string;
    crit: string;
    critWash: string;
  };
  glass: {
    fill: string;
    fillStrong: string;
    border: string;
    edge: string;
    screenA: string;
    screenB: string;
    orbs: [string, string, string, string, string];
    blurType: 'light' | 'dark';
  };
  shadow: { sm: ShadowStyle; md: ShadowStyle };
  radius: { sm: number; md: number; lg: number; xl: number; pill: number };
  space: (n: number) => number;
};

const NO_SHADOW: ShadowStyle = {
  shadowColor: 'transparent',
  shadowOpacity: 0,
  shadowRadius: 0,
  shadowOffset: { width: 0, height: 0 },
  elevation: 0,
};

export function buildTheme(scheme: Scheme, prefs: ThemePrefs): Theme {
  const isDark = scheme === 'dark';
  const isGlass = prefs.style === 'glass';
  const isPaper = prefs.style === 'paper';
  const [accent, tint, deep, wash, edge, on] = isPaper
    ? PAPER_ACCENT[scheme]
    : (ACCENTS[prefs.accent] ?? ACCENTS.green)[scheme];

  let surfaces: Surfaces = isPaper
    ? isDark
      ? PAPER_DARK
      : PAPER_LIGHT
    : isDark
    ? DARK
    : LIGHT;
  let shadowColor = isDark ? '#000000' : '#252a32';
  let smOpacity = isDark ? 0.5 : 0.08;
  let mdOpacity = isDark ? 0.6 : 0.12;

  const g = isDark ? GLASS_DARK : GLASS_LIGHT;
  if (isGlass) {
    surfaces = {
      ...surfaces,
      bg: g.bg,
      surface: g.fill,
      surfaceSoft: g.fillStrong,
      surfaceSunk: g.surfaceSunk,
      hair: g.hair,
    };
    shadowColor = g.shadowColor;
    smOpacity = isDark ? 0.4 : 0.1;
    mdOpacity = isDark ? 0.45 : 0.14;
  }

  const sem = (isPaper ? PAPER_SEMANTIC : SEMANTIC)[scheme];
  return {
    scheme,
    style: prefs.style,
    isGlass,
    colors: {
      ...surfaces,
      accent,
      // Gradients run accent → a brighter shade in light; dark palettes lead with the light tone.
      accent2: isPaper
        ? PAPER_ACCENT2[scheme]
        : isDark
        ? tint
        : ACCENT_BRIGHT[prefs.accent] ?? accent,
      accentWash: wash,
      accentInk: isDark ? accent : deep,
      onAccent: on ?? (isDark ? deep : '#ffffff'),
      tint,
      deep,
      edge,
      ...sem,
    },
    glass: {
      fill: g.fill,
      fillStrong: g.fillStrong,
      border: g.border,
      edge: g.edge,
      screenA: g.screenA,
      screenB: g.screenB,
      orbs: g.orbs,
      blurType: g.blurType,
    },
    // Solid is flat; only Glass carries drop shadows.
    shadow: isGlass
      ? {
          sm: {
            shadowColor,
            shadowOpacity: smOpacity,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 5 },
            elevation: 2,
          },
          md: {
            shadowColor,
            shadowOpacity: mdOpacity,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 11 },
            elevation: 4,
          },
        }
      : { sm: NO_SHADOW, md: NO_SHADOW },
    radius: { sm: 10, md: 14, lg: 21, xl: 24, pill: 999 },
    space: n => n * 4,
  };
}
