import { Text, TextInput } from "react-native";
import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
} from "@expo-google-fonts/ibm-plex-sans";
import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
} from "@expo-google-fonts/ibm-plex-mono";
import {
  BricolageGrotesque_500Medium,
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
} from "@expo-google-fonts/bricolage-grotesque";

// Weights actually used by the web theme (Mobile App/index.html's Google
// Fonts request: Bricolage Grotesque 500/600/700, IBM Plex Mono 400/500/600,
// IBM Plex Sans 400/500/600/700 — the web's "450" instance has no static
// weight and is visually indistinguishable from 400 here).
export const NEW_THEME_FONTS = {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
  BricolageGrotesque_500Medium,
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
};

// NOTE: this used to set Text.defaultProps.style as a way to give every
// Text element the new body font for free (React Native has no CSS-style
// cascade for fontFamily). React 19 removed defaultProps support for
// function components entirely, so that assignment is now a silent no-op —
// RN's <Text> is a function component, so this cannot be revived the same
// way. There is no app-wide default-font fix available without wrapping
// every <Text> usage in a custom component (out of scope for a theme swap).
// The reliable, verified-working pattern is an explicit inline
// `style={{ fontFamily: "IBMPlexSans_400Regular" }}` (or one of the other
// keys exported in NEW_THEME_FONTS above) on each Text that needs it —
// see ScreenHeader.tsx / StatCard.tsx for examples. This function is kept
// as a documented no-op rather than removed, so its call site in
// _layout.tsx doesn't need touching.
export function applyNewThemeDefaultFont() {
  Text.defaultProps = Text.defaultProps || {};
  Text.defaultProps.style = [{ fontFamily: "IBMPlexSans_400Regular" }, Text.defaultProps.style];

  TextInput.defaultProps = TextInput.defaultProps || {};
  TextInput.defaultProps.style = [{ fontFamily: "IBMPlexSans_400Regular" }, TextInput.defaultProps.style];
}
