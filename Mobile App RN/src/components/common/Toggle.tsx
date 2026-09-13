import { Switch } from "react-native";
import { useThemeColors } from "@/constants/colors";

type ToggleProps = {
  checked: boolean;
  onChange?: (value: boolean) => void;
  disabled?: boolean;
};

// RN ships a native Switch primitive, which reads better than reimplementing
// the web app custom toggle-switch CSS.
export function Toggle({ checked, onChange, disabled }: ToggleProps) {
  const colors = useThemeColors();
  return (
    <Switch
      value={checked}
      onValueChange={onChange}
      disabled={disabled}
      trackColor={{ false: colors.surface3, true: colors.accent }}
      thumbColor="#ffffff"
    />
  );
}
