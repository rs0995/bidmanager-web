import { Platform } from 'react-native';

// iOS resolves fonts by PostScript name, Android by file name (without extension).
const pick = (ios: string, android: string) =>
  Platform.select({ ios, default: android }) as string;

// Inter for text, Space Grotesk for headings and figures (as in the bidwise reference).
export const fonts = {
  regular: pick('Inter-Regular', 'Inter_400Regular'),
  medium: pick('Inter-Medium', 'Inter_500Medium'),
  semibold: pick('Inter-SemiBold', 'Inter_600SemiBold'),
  bold: pick('Inter-Bold', 'Inter_700Bold'),
  extrabold: pick('Inter-ExtraBold', 'Inter_800ExtraBold'),
  display: pick('SpaceGrotesk-Medium', 'SpaceGrotesk_500Medium'),
  displaySemibold: pick('SpaceGrotesk-SemiBold', 'SpaceGrotesk_600SemiBold'),
  displayBold: pick('SpaceGrotesk-Bold', 'SpaceGrotesk_700Bold'),
  monoMedium: pick('IBMPlexMono-Medium', 'IBMPlexMono_500Medium'),
  monoSemibold: pick('IBMPlexMono-SemiBold', 'IBMPlexMono_600SemiBold'),
} as const;
