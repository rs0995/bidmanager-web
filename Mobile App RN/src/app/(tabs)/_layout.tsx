import { View, Text } from "react-native";
import { Tabs } from "expo-router";
import { LayoutDashboard, Globe, FolderOpen, Bell, Menu } from "lucide-react-native";
import { useAlerts } from "@/lib/alerts";
import { useThemeColors } from "@/constants/colors";
import { interopIcon } from "@/lib/nativeIcons";

const OverviewIcon = interopIcon(LayoutDashboard);
const TendersIcon = interopIcon(Globe);
const ProjectsIcon = interopIcon(FolderOpen);
const AlertsIcon = interopIcon(Bell);
const MoreIcon = interopIcon(Menu);

// RN equivalent of the web app BottomTabBar — expo-router Tabs handles the
// active-tint / safe-area / fixed-position behaviour natively, so this is
// mostly just wiring icons + the unread-alerts badge.
export default function TabsLayout() {
  const alerts = useAlerts();
  const unread = alerts.filter((a: any) => !a.read).length;
  const colors = useThemeColors();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface0, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Overview", tabBarIcon: ({ color, size }) => <OverviewIcon color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="tenders"
        options={{ title: "Tenders", tabBarIcon: ({ color, size }) => <TendersIcon color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="projects"
        options={{ title: "Projects", tabBarIcon: ({ color, size }) => <ProjectsIcon color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: "Alerts",
          tabBarIcon: ({ color, size }) => (
            <View>
              <AlertsIcon color={color} size={size} />
              {unread > 0 && (
                <View className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-1 rounded-full items-center justify-center bg-danger">
                  <Text className="text-white text-[9px] font-bold">{unread > 9 ? "9+" : unread}</Text>
                </View>
              )}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: "More", tabBarIcon: ({ color, size }) => <MoreIcon color={color} size={size} /> }}
      />
    </Tabs>
  );
}
