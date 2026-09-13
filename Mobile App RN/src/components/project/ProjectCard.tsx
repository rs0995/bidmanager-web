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
  const pct = total ? done / total : 0;
  const { totalDays, label, expired } = timeRemaining(project.deadline);
  const u = urgency(totalDays);
  const colors = useThemeColors();
  const color = urgencyColor(u.key, colors);

  return (
    <Pressable
      className="bg-surface-0 border border-border rounded-[14px] p-3.5 flex-row items-center gap-3"
      onPress={() => router.push(`/projects/${project.id}` as any)}
    >
      <ProgressRing pct={pct} size={44} />
      <View className="flex-1">
        <Text className="text-sm font-semibold text-text" numberOfLines={2}>{project.title}</Text>
        <Text className="mt-1 text-xs text-text-muted" numberOfLines={1}>
          {project.client_name} · {fmtINR(project.project_value)}
        </Text>
        <Text className="mt-0.5 font-mono text-xs text-text-muted">{done}/{total} docs ready</Text>
      </View>
      <View
        className="flex-row items-center gap-1 px-2 py-1 rounded-full"
        style={{ backgroundColor: expired ? colors.surface2 : hexToRgba(color, 0.16) }}
      >
        <Clock size={11} color={expired ? colors.textMuted : color} />
        <Text className="text-xs font-semibold" style={{ color: expired ? colors.textMuted : color }}>
          {expired ? "Closed" : label}
        </Text>
      </View>
    </Pressable>
  );
}
