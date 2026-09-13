import { Pressable, View, Text } from "react-native";
import { router } from "expo-router";
import { ChevronRight, Bookmark } from "lucide-react-native";
import { useOrgBookmarkToggle } from "@/hooks/useBookmarks";
import { recordOrgIds } from "@/lib/store";
import { formatDateTimeIST } from "@/lib/format";
import { useThemeColors } from "@/constants/colors";

type OrganizationCardProps = { org: any; showWebsite?: boolean };

export function OrganizationCard({ org, showWebsite = false }: OrganizationCardProps) {
  const { isOrgBookmarked, toggle } = useOrgBookmarkToggle();
  const bookmarked = isOrgBookmarked(org.name);
  const colors = useThemeColors();
  const unavailable = org.is_available === false;

  const handleBookmark = () => {
    recordOrgIds([org]);
    toggle(org.name);
  };

  const openOrg = () => {
    if (unavailable) return;
    router.push(
      `/tenders/org/${encodeURIComponent(org.name)}?website_id=${org.website_id}&org_id=${org.id}&last_scraped_at=${org.last_scraped_at || 0}` as any,
    );
  };

  return (
    <Pressable
      onPress={openOrg}
      className="bg-surface-0 border border-border rounded-[14px] p-3 flex-row items-center justify-between gap-3"
      style={unavailable ? { opacity: 0.5 } : undefined}
    >
      <View className="flex-1">
        <Text className="text-sm font-medium text-text" numberOfLines={1}>
          {org.name}
          {unavailable && <Text className="text-xs text-text-muted"> (unavailable)</Text>}
        </Text>
        <View className="flex-row gap-2 mt-1">
          {showWebsite && <Text className="text-xs text-text-muted">{org.website_name}</Text>}
          {org.last_scraped_at ? (
            <Text className="text-xs text-text-muted">Last updated {formatDateTimeIST(org.last_scraped_at * 1000)}</Text>
          ) : null}
        </View>
      </View>
      <View className="flex-row items-center gap-3">
        <Text className="font-mono text-sm font-semibold text-text">{org.tender_count}</Text>
        <Pressable onPress={handleBookmark} accessibilityLabel="Toggle organisation bookmark" className="p-0.5">
          <Bookmark size={17} fill={bookmarked ? colors.warn : "none"} color={bookmarked ? colors.warn : colors.textMuted} />
        </Pressable>
        {!unavailable && <ChevronRight size={16} color={colors.textMuted} />}
      </View>
    </Pressable>
  );
}
