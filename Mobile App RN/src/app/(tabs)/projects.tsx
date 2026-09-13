import { useState, useMemo } from "react";
import { View, Text, ScrollView } from "react-native";
import { FolderOpen } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { SegmentedControl } from "@/components/common/SegmentedControl";
import { ProjectCard } from "@/components/project/ProjectCard";
import { EmptyState } from "@/components/feedback/EmptyState";
import { useProjects } from "@/lib/projects";

export default function ProjectsScreen() {
  const [seg, setSeg] = useState("active");
  const projects = useProjects();

  const rows = useMemo(
    () => projects.filter((p: any) => (seg === "active" ? p.status !== "Archived" : p.status === "Archived")),
    [projects, seg],
  );
  const activeCount = projects.filter((p: any) => p.status !== "Archived").length;
  const archivedCount = projects.length - activeCount;

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Projects" />
      <ScrollView contentContainerClassName="p-4">
        <Text className="mb-3 text-xs text-text-muted">
          Track bids in preparation — add checklist items & attach documents. Stored on this device, synced to your account.
        </Text>
        <SegmentedControl
          value={seg}
          onChange={setSeg}
          options={[
            { value: "active", label: `Active · ${activeCount}` },
            { value: "archived", label: `Archived · ${archivedCount}` },
          ]}
        />
        <View className="flex flex-col gap-3 mt-3">
          {rows.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title={seg === "active" ? "No active projects yet" : "No archived projects"}
              body={seg === "active" ? 'Open a tender and tap "Add to Projects" to start one.' : undefined}
            />
          ) : rows.map((p: any) => <ProjectCard key={p.id} project={p} />)}
        </View>
      </ScrollView>
    </View>
  );
}
