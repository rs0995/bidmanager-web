import { Platform } from 'react-native';

// iOS resolves fonts by PostScript name, Android by file name (without extension).
const pick = (ios: string, android: string) =>
  Platform.select({ ios, default: android }) as string;

export const fonts = {
  regular: pick('PlusJakartaSans-Regular', 'PlusJakartaSans_400Regular'),
  medium: pick('PlusJakartaSans-Medium', 'PlusJakartaSans_500Medium'),
  semibold: pick('PlusJakartaSans-SemiBold', 'PlusJakartaSans_600SemiBold'),
  bold: pick('PlusJakartaSans-Bold', 'PlusJakartaSans_700Bold'),
  extrabold: pick('PlusJakartaSans-ExtraBold', 'PlusJakartaSans_800ExtraBold'),
  monoMedium: pick('IBMPlexMono-Medium', 'IBMPlexMono_500Medium'),
  monoSemibold: pick('IBMPlexMono-SemiBold', 'IBMPlexMono_600SemiBold'),
} as const;
