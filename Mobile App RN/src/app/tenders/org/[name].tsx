import { useCallback } from "react";
import { View, Pressable } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { RefreshCw, Globe } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { TenderList } from "@/components/tender/TenderList";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Button } from "@/components/common/Button";
import { SpinningIcon } from "@/components/common/SpinningIcon";
import { useTenders } from "@/hooks/useTenders";
import { requestOrgTenders, useOrgRequestPending } from "@/lib/orgRequests";
import { useToast } from "@/components/feedback/ToastProvider";
import { scrapeCooldownMessage } from "@/lib/format";
import { useThemeColors } from "@/constants/colors";

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export default function OrganizationTendersScreen() {
  const { name, website_id: websiteId, org_id: orgId, sort_by: sortBy, sort_order: sortOrder, last_scraped_at } =
    useLocalSearchParams<{ name: string; website_id?: string; org_id?: string; sort_by?: string; sort_order?: string; last_scraped_at?: string }>();
  const orgName = decodeURIComponent(name);
  const lastScrapedAt = Number(last_scraped_at) || 0;
  const toast = useToast();
  const colors = useThemeColors();

  const query = useTenders({ organization: orgName, website_id: websiteId, sort_by: sortBy, sort_order: sortOrder });
  const pending = useOrgRequestPending(orgId);
  const cooldownActive = lastScrapedAt > 0 && (Date.now() - lastScrapedAt * 1000) < COOLDOWN_MS;

  const handleRequest = useCallback(async () => {
    if (!orgId) return;
    if (cooldownActive) {
      toast?.push({ title: "Update not due yet", body: scrapeCooldownMessage(lastScrapedAt), type: "info" });
      return;
    }
    try {
      await requestOrgTenders({ id: Number(orgId), name: orgName });
      toast?.push({ title: "Requested", body: "Fetching tenders for this organisation — this can take a few minutes." });
    } catch (e: any) {
      const message = e?.message || "";
      if (/already/i.test(message)) {
        toast?.push({ title: "Already covered", body: "This organisation already has a scrape job covering it.", type: "info" });
      } else if (/less than 24 hours/i.test(message)) {
        toast?.push({ title: "Update not due yet", body: scrapeCooldownMessage(lastScrapedAt), type: "info" });
      } else {
        toast?.push({ title: "Could not request tenders", body: message, type: "error" });
      }
    }
  }, [orgId, orgName, toast, cooldownActive, lastScrapedAt]);

  const headerRequestButton = orgId ? (
    <Pressable className="p-1.5" style={{ opacity: pending ? 0.6 : 1 }} onPress={handleRequest} disabled={pending}>
      <SpinningIcon spinning={pending}>
        <RefreshCw size={18} color={colors.accent} />
      </SpinningIcon>
    </Pressable>
  ) : null;

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title={orgName} back actions={headerRequestButton} />
      <TenderList
        query={query}
        renderEmpty={() => (
          <EmptyState
            icon={Globe}
            title="No tenders yet"
            body="Nothing scraped for this organisation yet."
            action={orgId ? (
              <Button variant="secondary" className="mt-2" onPress={handleRequest} disabled={pending}>
                {pending ? "Requesting…" : "Request tenders"}
              </Button>
            ) : undefined}
          />
        )}
      />
    </View>
  );
}
