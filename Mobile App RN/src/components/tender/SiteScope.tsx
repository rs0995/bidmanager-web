import { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { ChevronDown, Check } from "lucide-react-native";
import { useWebsites } from "@/hooks/useWebsites";
import { Sheet } from "@/components/common/Sheet";
import { Skeleton } from "@/components/feedback/Skeleton";
import { useThemeColors } from "@/constants/colors";

type SiteScopeProps = { websiteId: string; onChange: (id: string) => void };

export function SiteScope({ websiteId, onChange }: SiteScopeProps) {
  const { data: websites = [], isLoading } = useWebsites();
  const [open, setOpen] = useState(false);
  const colors = useThemeColors();

  useEffect(() => {
    if (!websiteId && websites.length > 0) onChange(String(websites[0].id));
  }, [websiteId, websites, onChange]);

  // Reserve the same footprint as the real picker while loading -- returning
  // null here (as this used to) left nothing on screen, so the picker
  // popped in abruptly ~1s later instead of the space just being ready.
  if (isLoading) {
    return (
      <View className="px-4 pt-3 pb-2">
        <Skeleton className="w-full h-[46px] rounded-xl" />
      </View>
    );
  }
  if (websites.length === 0) return null;

  const current = websites.find((s: any) => String(s.id) === String(websiteId));

  return (
    <View className="px-4 pt-3 pb-2">
      <Pressable
        className="w-full flex-row items-center justify-between gap-2 px-3.5 py-[11px] rounded-xl bg-surface-0 border border-border"
        onPress={() => setOpen(true)}
      >
        <Text className="text-base font-medium text-text" numberOfLines={1}>{current?.name || "Choose portal"}</Text>
        <ChevronDown size={18} color={colors.textMuted} />
      </Pressable>

      <Sheet open={open} onClose={() => setOpen(false)} title="Choose portal">
        <View className="flex flex-col gap-2">
          {websites.map((site: any) => {
            const selected = String(site.id) === String(websiteId);
            return (
              <Pressable
                key={site.id}
                className="bg-surface-0 border rounded-[14px] p-3 flex-row items-center justify-between gap-3"
                style={selected ? { borderColor: colors.accent, backgroundColor: colors.accentBg } : { borderColor: colors.border }}
                onPress={() => { onChange(String(site.id)); setOpen(false); }}
              >
                <Text className="text-sm font-medium" numberOfLines={1} style={{ color: selected ? colors.accent : colors.text }}>
                  {site.name}
                </Text>
                {selected && <Check size={16} color={colors.accent} />}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}
