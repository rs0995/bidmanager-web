import { useState } from "react";
import { View, Text, TextInput, Pressable, type TextInputProps } from "react-native";
import { ChevronDown, Check } from "lucide-react-native";
import { Sheet } from "@/components/common/Sheet";
import { useThemeColors } from "@/constants/colors";

type FieldProps = {
  label?: string;
  error?: string;
  children: React.ReactNode;
};

export function Field({ label, error, children }: FieldProps) {
  return (
    <View className="flex flex-col gap-1.5">
      {label && <Text className="text-[14px] font-medium text-text-muted">{label}</Text>}
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
      className="w-full bg-surface-1 border border-border rounded-[10px] px-3 h-[41px] text-text text-[15px]"
      {...props}
    />
  );
}

// Web <select> has no direct RN equivalent. @react-native-picker/picker was
// tried first, but on iOS it always renders as a tall inline scroll wheel
// (not a compact dropdown) and offers no way to "unselect" back to a blank
// value other than spinning to it — neither matches the web app's compact
// <select>. This instead reuses the same tap-to-open-a-list-sheet pattern
// already used for the portal picker (see SiteScope.tsx): a compact
// Pressable trigger showing the current label, opening a Sheet with one row
// per option (including whatever blank/"Any" option the caller passes) and
// a checkmark on the active one. Calling convention is onValueChange(value)
// rather than onChange(event), unlike the web version. Options: [{ value, label }].
type SelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  title?: string;
};

export function Select({ value, onValueChange, options, title }: SelectProps) {
  const [open, setOpen] = useState(false);
  const colors = useThemeColors();
  const current = options.find((opt) => opt.value === value);

  return (
    <>
      <Pressable
        className="w-full flex-row items-center justify-between gap-2 bg-surface-1 border border-border rounded-[10px] px-3 h-[41px]"
        onPress={() => setOpen(true)}
      >
        <Text className="flex-1 text-[15px] text-text" numberOfLines={1}>{current?.label ?? ""}</Text>
        <ChevronDown size={16} color={colors.textMuted} />
      </Pressable>

      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <View className="flex flex-col gap-2">
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <Pressable
                key={opt.value}
                className="bg-surface-0 border rounded-[11px] p-[10px] flex-row items-center justify-between gap-3"
                style={selected ? { borderColor: colors.accent, backgroundColor: colors.accentBg } : { borderColor: colors.border }}
                onPress={() => { onValueChange(opt.value); setOpen(false); }}
              >
                <Text className="text-sm font-medium" numberOfLines={1} style={{ color: selected ? colors.accent : colors.text }}>
                  {opt.label}
                </Text>
                {selected && <Check size={16} color={colors.accent} />}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </>
  );
}
