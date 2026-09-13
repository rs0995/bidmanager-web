import { Pressable, Text } from "react-native";
import { cn } from "@/lib/cn";

const VARIANTS: Record<string, string> = {
  primary: "bg-accent",
  secondary: "bg-surface-2 border border-border",
  ghost: "bg-transparent",
  danger: "bg-danger-bg",
};

const TEXT_VARIANTS: Record<string, string> = {
  primary: "text-white",
  secondary: "text-text",
  ghost: "text-text-muted",
  danger: "text-danger",
};

type ButtonProps = {
  variant?: keyof typeof VARIANTS;
  className?: string;
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
};

export function Button({ variant = "primary", className, children, onPress, disabled }: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={cn(
        "flex-row items-center justify-center gap-1.5 min-h-11 px-4 rounded-[11px]",
        VARIANTS[variant],
        disabled && "opacity-40",
        className,
      )}
    >
      {typeof children === "string" ? (
        <Text className={cn("text-sm font-semibold", TEXT_VARIANTS[variant])}>{children}</Text>
      ) : (
        children
      )}
    </Pressable>
  );
}
