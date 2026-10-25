// Design tokens copied from the desktop Server UI (`c` in BidManagerControl.jsx) so the
// phone app reads as the same product: paper ground, white ruled cards, square corners,
// one indigo accent, and seal / amber / stamp used only to mean ok / warn / error.

const c = {
  paper: '#E9EDF1',
  card: '#FFFFFF',
  rule: '#C6D0DA',
  ruleSoft: '#DFE6EC',
  ink: '#15202A',
  ink60: '#5A6874',
  ink40: '#8794A0',
  indigo: '#23408E',
  indigoSoft: '#E4E9F6',
  stamp: '#B23227',
  stampSoft: '#F7E4E1',
  seal: '#1C7355',
  sealSoft: '#E0F0EA',
  amber: '#8A5A0E',
  amberSoft: '#F6EAD5',
  console: '#111A22',
  consoleRule: '#233240',
  consoleInk: '#C4D2DE',
};

export function buildTheme() {
  return {
    scheme: 'light' as const,
    colors: {
      bg: c.paper,
      surface: c.card,
      raised: c.paper,
      hair: c.rule,
      hairSoft: c.ruleSoft,
      ink: c.ink,
      ink2: c.ink60,
      ink3: c.ink40,
      accent: c.indigo,
      accentSoft: c.indigoSoft,
      onAccent: '#FFFFFF',
      ok: c.seal,
      okSoft: c.sealSoft,
      warn: c.amber,
      warnSoft: c.amberSoft,
      bad: c.stamp,
      badSoft: c.stampSoft,
      neutralSoft: c.paper,
      toggleOff: '#CDD6DE',
      overlay: 'rgba(21,32,42,0.35)',
      // Pill / banner borders, as on the desktop.
      okLine: '#B7DCCC',
      warnLine: '#E4CFA4',
      badLine: '#E3B7B1',
      infoLine: '#B9C6E6',
      // The one inverted surface: the log console.
      console: c.console,
      consoleRule: c.consoleRule,
      consoleInk: c.consoleInk,
      consoleTime: '#556777',
      consoleSource: '#7C8FA0',
      consoleErrorInk: '#F0A79B',
      logLevel: {
        debug: '#6E8496',
        info: '#7FB6E0',
        warn: '#E0B057',
        error: '#E27A6C',
      },
    },
    // Square corners everywhere, like the desktop.
    radius: { sm: 0, md: 0, lg: 0, pill: 0 },
    space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  };
}

export type Theme = ReturnType<typeof buildTheme>;
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

export function toneColors(t: Theme, tone: Tone) {
  switch (tone) {
    case 'ok':
      return { fg: t.colors.ok, bg: t.colors.okSoft, bd: t.colors.okLine };
    case 'warn':
      return { fg: t.colors.warn, bg: t.colors.warnSoft, bd: t.colors.warnLine };
    case 'bad':
      return { fg: t.colors.bad, bg: t.colors.badSoft, bd: t.colors.badLine };
    case 'info':
      return { fg: t.colors.accent, bg: t.colors.accentSoft, bd: t.colors.infoLine };
    default:
      return { fg: t.colors.ink2, bg: t.colors.neutralSoft, bd: t.colors.hair };
  }
}
