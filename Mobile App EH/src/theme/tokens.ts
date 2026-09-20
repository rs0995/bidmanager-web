export type ThemeMode = 'system' | 'light' | 'dark';
export type AccentKey = 'orange' | 'bidmanager' | 'emerald' | 'rose' | 'ink';
export type BaseKey = 'white' | 'paper';
export type StyleKey = 'solid' | 'glass';
export type Scheme = 'light' | 'dark';

export type ThemePrefs = {
  mode: ThemeMode;
  accent: AccentKey;
  base: BaseKey;
  style: StyleKey;
};

export const DEFAULT_PREFS: ThemePrefs = {
  mode: 'system',
  accent: 'orange',
  base: 'white',
  style: 'solid',
};

type AccentShade = {
  a: string;
  b: string;
  wash: string;
  ink: string;
  on: string;
};

export const ACCENTS: Record<
  AccentKey,
  { label: string; light: AccentShade; dark: AccentShade }
> = {
  orange: {
    label: 'Orange',
    light: {
      a: '#ff7a1a',
      b: '#ffb020',
      wash: '#fff1e1',
      ink: '#c85e0f',
      on: '#ffffff',
    },
    dark: {
      a: '#ff8f3d',
      b: '#ffbb55',
      wash: '#33230f',
      ink: '#ffab63',
      on: '#ffffff',
    },
  },
  bidmanager: {
    label: 'BidManager',
    light: {
      a: '#3a3fd4',
      b: '#6e73ea',
      wash: '#ececfb',
      ink: '#2b2fae',
      on: '#ffffff',
    },
    dark: {
      a: '#8a8dfb',
      b: '#b0b2ff',
      wash: '#23253a',
      ink: '#a7a9ff',
      on: '#101124',
    },
  },
  emerald: {
    label: 'Emerald',
    light: {
      a: '#0f9d67',
      b: '#34d399',
      wash: '#e0f6ec',
      ink: '#0b7a50',
      on: '#ffffff',
    },
    dark: {
      a: '#34c98d',
      b: '#6ee7b7',
      wash: '#12332a',
      ink: '#6fe0b0',
      on: '#0d1f18',
    },
  },
  rose: {
    label: 'Rose',
    light: {
      a: '#e11d5a',
      b: '#fb7185',
      wash: '#fde6ed',
      ink: '#b3124a',
      on: '#ffffff',
    },
    dark: {
      a: '#f2557f',
      b: '#fda4af',
      wash: '#3a1522',
      ink: '#ff9db5',
      on: '#2a0c16',
    },
  },
  ink: {
    label: 'Ink',
    light: {
      a: '#18151f',
      b: '#4a4658',
      wash: '#ecebf1',
      ink: '#18151f',
      on: '#ffffff',
    },
    dark: {
      a: '#f4f2f8',
      b: '#c6c2d0',
      wash: '#2c2834',
      ink: '#f4f2f8',
      on: '#18151f',
    },
  },
};

export const ACCENT_KEYS = Object.keys(ACCENTS) as AccentKey[];

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

const WHITE: Surfaces = {
  bg: '#ffffff',
  surface: '#f4f3f8',
  surfaceSoft: '#ffffff',
  surfaceSunk: '#e4e1ed',
  ink: '#18151f',
  inkSoft: '#5c5867',
  muted: '#8a869a',
  hair: '#e5e2ed',
};

const PAPER: Surfaces = {
  bg: '#f2f1ec',
  surface: '#faf9f6',
  surfaceSoft: '#f2f1ec',
  surfaceSunk: '#e4e2d9',
  ink: '#1c1b17',
  inkSoft: '#57544b',
  muted: '#85817a',
  hair: '#e2dfd4',
};

const DARK: Surfaces = {
  bg: '#131017',
  surface: '#1d1a24',
  surfaceSoft: '#23202b',
  surfaceSunk: '#19161f',
  ink: '#f4f2f8',
  inkSoft: '#c6c2d0',
  muted: '#8d899a',
  hair: '#2c2834',
};

const SEMANTIC = {
  light: {
    good: '#1c9d6b',
    goodWash: '#e2f6ec',
    warn: '#d98a00',
    warnWash: '#fdf1d9',
    crit: '#e14a63',
    critWash: '#fce6ea',
  },
  dark: {
    good: '#35c98c',
    goodWash: '#123526',
    warn: '#eea93d',
    warnWash: '#362708',
    crit: '#ef5b76',
    critWash: '#3a1622',
  },
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
  orbs: [string, string, string, string];
  shadowColor: string;
  blurType: 'light' | 'dark';
};

const GLASS_LIGHT: GlassSet = {
  bg: '#eceaf5',
  fill: 'rgba(255,255,255,0.46)',
  fillStrong: 'rgba(255,255,255,0.62)',
  border: 'rgba(255,255,255,0.8)',
  edge: 'rgba(255,255,255,0.9)',
  surfaceSunk: 'rgba(110,100,160,0.16)',
  hair: 'rgba(110,100,160,0.16)',
  screenA: '#efedf8',
  screenB: '#e6e3f3',
  orbs: ['#ffb37a', '#a9b4ff', '#d3a6ff', '#ffd9a3'],
  shadowColor: '#463c82',
  blurType: 'light',
};

const GLASS_DARK: GlassSet = {
  bg: '#120e1e',
  fill: 'rgba(255,255,255,0.07)',
  fillStrong: 'rgba(255,255,255,0.11)',
  border: 'rgba(255,255,255,0.16)',
  edge: 'rgba(255,255,255,0.28)',
  surfaceSunk: 'rgba(255,255,255,0.10)',
  hair: 'rgba(255,255,255,0.10)',
  screenA: '#17122a',
  screenB: '#1d1436',
  orbs: ['#ff7a3d', '#5b6bff', '#a04bff', '#ff5c8a'],
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
    orbs: [string, string, string, string];
    blurType: 'light' | 'dark';
  };
  shadow: { sm: ShadowStyle; md: ShadowStyle };
  radius: { sm: number; md: number; lg: number; xl: number; pill: number };
  space: (n: number) => number;
};

export function buildTheme(scheme: Scheme, prefs: ThemePrefs): Theme {
  const isDark = scheme === 'dark';
  const isGlass = prefs.style === 'glass';
  const accent = ACCENTS[prefs.accent][scheme];

  let surfaces: Surfaces = isDark
    ? DARK
    : prefs.base === 'paper'
    ? PAPER
    : WHITE;
  let shadowColor = isDark
    ? '#000000'
    : prefs.base === 'paper'
    ? '#463719'
    : '#281c46';
  let smOpacity = isDark ? 0.5 : 0.14;
  let mdOpacity = isDark ? 0.6 : 0.18;

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
    smOpacity = isDark ? 0.55 : 0.25;
    mdOpacity = isDark ? 0.6 : 0.28;
  }

  const sem = SEMANTIC[scheme];
  return {
    scheme,
    style: prefs.style,
    isGlass,
    colors: {
      ...surfaces,
      accent: accent.a,
      accent2: accent.b,
      accentWash: accent.wash,
      accentInk: accent.ink,
      onAccent: accent.on,
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
    shadow: {
      sm: {
        shadowColor,
        shadowOpacity: smOpacity,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
      },
      md: {
        shadowColor,
        shadowOpacity: mdOpacity,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 10 },
        elevation: 4,
      },
    },
    radius: { sm: 10, md: 16, lg: 22, xl: 26, pill: 999 },
    space: n => n * 4,
  };
}
