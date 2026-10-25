import { useState, useEffect } from "react";
import { View } from "react-native";
import { Search } from "lucide-react-native";
import { Input } from "@/components/common/Field";
import { useThemeColors } from "@/constants/colors";

type SearchFieldProps = {
  value: string;
  onSearch: (q: string) => void;
  placeholder: string;
  debounceMs?: number;
};

// Search box with a debounced callback: the parent only hears about the text
// once typing pauses, so server-side searches are not fired per keystroke.
export function SearchField({ value, onSearch, placeholder, debounceMs = 300 }: SearchFieldProps) {
  const [text, setText] = useState(value || "");
  const colors = useThemeColors();

  useEffect(() => {
    const t = setTimeout(() => { if (text !== (value || "")) onSearch(text); }, debounceMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <View className="relative flex-1 justify-center">
      <Search size={15} color={colors.textMuted} style={{ position: "absolute", left: 12, zIndex: 1 }} />
      <Input style={{ paddingLeft: 34 }} placeholder={placeholder} value={text} onChangeText={setText} />
    </View>
  );
}
