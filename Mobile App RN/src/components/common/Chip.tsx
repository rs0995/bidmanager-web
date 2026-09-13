import { Children, isValidElement } from "react";
import { Pressable, Text, View } from "react-native";
import { cn } from "@/lib/cn";

type ChipProps = {
  active?: boolean;
  children: React.ReactNode;
  onPress?: () => void;
};

// Callers pass a mix of icon elements and raw text as siblings (e.g.
// <Star .../> Bookmarked), the way the web app did inside a flex <button>.
// RN cannot render a bare string as a child of View, so any string/number
// child is wrapped in <Text> here; icon elements pass through unchanged.
export function Chip({ active, children, onPress }: ChipProps) {
  const content = Children.map(children, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      return (
        <Text className={cn("text-[13px] font-medium text-text-muted", active && "text-accent")}>
          {child}
        </Text>
      );
    }
    return isValidElement(child) ? child : null;
  });

  return (
    <Pressable
      onPress={onPress}
      className={cn(
        "flex-row items-center gap-1 px-3 py-1.5 rounded-full border border-border bg-surface-1",
        active && "bg-accent-bg border-accent",
      )}
    >
      {content}
    </Pressable>
  );
}
