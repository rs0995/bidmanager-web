import { useState } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { Plus, Star, X } from "lucide-react-native";
import { Chip } from "@/components/common/Chip";
import { SearchField } from "./SearchField";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const colors = useThemeColors();

  return (
    <View className="pt-3 pb-2 bg-surface-0 border-b border-border">
      <View className="px-4">
        <View className="flex-row items-center gap-2 mb-2">
          <Pressable
            onPress={() => onToggleBookmarked(!bookmarkedOnly)}
            className="w-[41px] h-[41px] items-center justify-center rounded-[10px] border"
            style={bookmarkedOnly ? { borderColor: colors.accent, backgroundColor: colors.accentBg } : { borderColor: colors.border, backgroundColor: colors.surface1 }}
            accessibilityLabel="Bookmarked only"
          >
            <Star size={16} color={bookmarkedOnly ? colors.accent : colors.textMuted} fill={bookmarkedOnly ? colors.accent : "none"} />
          </Pressable>
          <SearchField value={q} onSearch={onSearch} placeholder="Search title, org, tender ID" />
        </View>
      </View>
      {/* Padding lives in the scroll content (not the outer row) so the chip
          row scrolls flush to the screen edges instead of stopping short of
          them. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pb-1 px-4">
        <Chip active={!bookmarkedOnly && !closingSoon} onPress={() => { onToggleBookmarked(false); onToggleClosingSoon(false); }}>
          All
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
      <View className="px-4">
        <CustomFilterMenu
          open={menuOpen}
          rows={rows}
          active={customFilters}
          onAdd={(key) => { onAddCustom(key); setMenuOpen(false); }}
        />
      </View>
    </View>
  );
}
