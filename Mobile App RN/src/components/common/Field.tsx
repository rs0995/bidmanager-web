import { View, Text, TextInput, type TextInputProps } from "react-native";
import { Picker } from "@react-native-picker/picker";
import { useThemeColors } from "@/constants/colors";

type FieldProps = {
  label?: string;
  error?: string;
  children: React.ReactNode;
};

export function Field({ label, error, children }: FieldProps) {
  return (
    <View className="flex flex-col gap-1.5">
      {label && <Text className="text-xs font-medium text-text-muted">{label}</Text>}
      {children}
      {error && <Text className="text-xs text-danger">{error}</Text>}
    </View>
  );
}

export function Input(props: TextInputProps) {
  const colors = useThemeColors();
  return (
    <TextInput
      placeholderTextColor={colors.textMuted}
      className="w-full bg-surface-1 border border-border rounded-[10px] px-3 h-[46px] text-text text-[15px]"
      {...props}
    />
  );
}

// Web <select> has no direct RN equivalent — this wraps
// @react-native-picker/picker (native iOS/Android picker), so the calling
// convention is onValueChange(value) rather than onChange(event), unlike
// the web version. Options: [{ value, label }].
type SelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
};

export function Select({ value, onValueChange, options }: SelectProps) {
  return (
    <View className="w-full bg-surface-1 border border-border rounded-[10px] overflow-hidden">
      <Picker selectedValue={value} onValueChange={onValueChange}>
        {options.map((opt) => (
          <Picker.Item key={opt.value} value={opt.value} label={opt.label} />
        ))}
      </Picker>
    </View>
  );
}
