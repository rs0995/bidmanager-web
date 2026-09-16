import { Pressable, View, Text } from "react-native";
import { router } from "expo-router";
import { Clock } from "lucide-react-native";
import { ProgressRing } from "@/components/common/ProgressRing";
import { fmtINR, timeRemaining, urgency } from "@/lib/format";
import { getChecklist } from "@/lib/projects";
import { useThemeColors, urgencyColor, hexToRgba } from "@/constants/colors";

export function ProjectCard({ project }: { project: any }) {
  const items = getChecklist(project.id);
  const done = items.filter((i: any) => i.status === "Completed").length;
  const total = items.length;
  const { totalDays, label, expired } = timeRemaining(project.deadline);
  const u = urgency(totalDays);
  const colors = useThemeColors();
  const color = urgencyColor(u.key, colors);

  return (
    <Pressable
      className="bg-surface-0 border border-border rounded-2xl p-4 flex-row items-center gap-3"
      onPress={() => router.push(`/projects/${project.id}` as any)}
    >
      <View className="items-center">
        <ProgressRing pct={total ? done / total : 0} size={44}>
          <Text className="text-xs font-bold text-text">{done}/{total}</Text>
        </ProgressRing>
        <Text className="mt-1 text-[14px] text-text-muted">Docs Ready</Text>
      </View>
      <View className="flex-1">
        {project.source_tender_id && (
          <Text className="text-[12px] font-bold text-accent" style={{ fontFamily: "IBMPlexMono_600SemiBold" }}>
            {project.source_tender_id}
          </Text>
        )}
        <Text className="mt-0.5 text-lg font-semibold text-text" numberOfLines={3}>{project.title}</Text>
        <Text className="mt-1 text-[14px] text-text-muted" numberOfLines={1}>
          {project.client_name} · {fmtINR(project.project_value)}
        </Text>
      </View>
      <View
        className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full"
        style={{ backgroundColor: expired ? colors.surface2 : hexToRgba(color, 0.16) }}
      >
        <Clock size={13} color={expired ? colors.textMuted : color} />
        <Text className="text-base font-semibold" style={{ color: expired ? colors.textMuted : color }}>
          {expired ? "Closed" : label}
        </Text>
      </View>
    </Pressable>
  );
}
