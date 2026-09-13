import { cssInterop } from "nativewind";

// lucide-react-native icons take a raw color prop (an SVG stroke color),
// not a NativeWind className — cssInterop teaches NativeWind to resolve a
// className (e.g. "text-accent") into that prop, the same way it already
// resolves className into style for View/Text. Call once per icon
// component; registered tracks that so re-imports (fast refresh, multiple
// screens using the same icon) do not re-register.
const registered = new Set();

export function interopIcon(Icon) {
  if (!registered.has(Icon)) {
    cssInterop(Icon, { className: { target: "style", nativeStyleToProp: { color: true } } });
    registered.add(Icon);
  }
  return Icon;
}
