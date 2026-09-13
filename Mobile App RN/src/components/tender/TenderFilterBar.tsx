import { useState, useEffect } from "react";
import { View, ScrollView } from "react-native";
import { Search, Plus, Star, X } from "lucide-react-native";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Field";
import { CustomFilterMenu, customFilterLabel } from "./CustomFilterMenu";
import { useThemeColors } from "@/constants/colors";

const MAX_CUSTOM = 2;

type TenderFilterBarProps = {
  q: string;
  onSearch: (q: string) => void;
  bookmarkedOnly: boolean;
  onToggleBookmarked: (v: boolean) => void;
  closingSoon: boolean;
  onToggleClosingSoon: (v: boolean) => void;
  customFilters: string[];
  onAddCustom: (key: string) => void;
  onRemoveCustom: (key: string) => void;
  rows: any[];
  onOpenAdvanced: () => void;
};

export function TenderFilterBar({
  q, onSearch, bookmarkedOnly, onToggleBookmarked, closingSoon, onToggleClosingSoon,
  customFilters, onAddCustom, onRemoveCustom, rows, onOpenAdvanced,
}: TenderFilterBarProps) {
  const [text, setText] = useState(q || "");
  const [menuOpen, setMenuOpen] = useState(false);
  const colors = useThemeColors();

  useEffect(() => {
    const t = setTimeout(() => { if (text !== (q || "")) onSearch(text); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <View className="px-4 pt-3 pb-2 bg-surface-0 border-b border-border">
      <View className="relative mb-2 justify-center">
        <Search size={15} color={colors.textMuted} style={{ position: "absolute", left: 12, zIndex: 1 }} />
        <Input
          style={{ paddingLeft: 34 }}
          placeholder="Search title, org, tender ID"
          value={text}
          onChangeText={setText}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pb-1">
        <Chip active={!bookmarkedOnly && !closingSoon} onPress={() => { onToggleBookmarked(false); onToggleClosingSoon(false); }}>
          All
        </Chip>
        <Chip active={bookmarkedOnly} onPress={() => onToggleBookmarked(!bookmarkedOnly)}>
          <Star size={12} color={bookmarkedOnly ? colors.accent : colors.textMuted} /> Bookmarked
        </Chip>
        <Chip active={closingSoon} onPress={() => onToggleClosingSoon(!closingSoon)}>
          Closing &lt; 5 days
        </Chip>
        {customFilters.map((key) => (
          <Chip key={key} active onPress={() => onRemoveCustom(key)}>
            {customFilterLabel(key)} <X size={11} color={colors.accent} />
          </Chip>
        ))}
        {customFilters.length < MAX_CUSTOM && (
          <Chip onPress={() => setMenuOpen((v) => !v)}>
            <Plus size={12} color={colors.textMuted} /> Filter
          </Chip>
        )}
        <Chip onPress={onOpenAdvanced}>More</Chip>
      </ScrollView>
      <CustomFilterMenu
        open={menuOpen}
        rows={rows}
        active={customFilters}
        onAdd={(key) => { onAddCustom(key); setMenuOpen(false); }}
      />
    </View>
  );
}
