import { Platform } from 'react-native';

// Same families as the desktop Server UI: IBM Plex Sans for UI, IBM Plex Sans
// Condensed for titles, IBM Plex Mono for labels, numbers, IDs and log lines.
//
// iOS finds fonts by their internal PostScript name, which IBM abbreviates for
// some weights ("IBMPlexSans-Medm", "IBMPlexSansCond-SmBld"); Android and the web
// preview (web/fonts.css) use the .ttf file name.
const pick = (ios: string, file: string) =>
  Platform.select({ ios, default: file }) as string;

export const fonts = {
  regular: pick('IBMPlexSans', 'IBMPlexSans-Regular'),
  medium: pick('IBMPlexSans-Medm', 'IBMPlexSans-Medium'),
  semibold: pick('IBMPlexSans-SmBld', 'IBMPlexSans-SemiBold'),
  bold: pick('IBMPlexSans-Bold', 'IBMPlexSans-Bold'),
  condSemibold: pick('IBMPlexSansCond-SmBld', 'IBMPlexSansCondensed-SemiBold'),
  cond: pick('IBMPlexSansCond-Bold', 'IBMPlexSansCondensed-Bold'),
  mono: pick('IBMPlexMono-Regular', 'IBMPlexMono-Regular'),
  monoMedium: pick('IBMPlexMono-Medium', 'IBMPlexMono-Medium'),
  monoSemibold: pick('IBMPlexMono-SemiBold', 'IBMPlexMono-SemiBold'),
} as const;
