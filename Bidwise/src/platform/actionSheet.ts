import { ActionSheetIOS, Alert, Platform } from 'react-native';

// A short list of choices: the iOS action sheet, or an alert with buttons elsewhere.
// The browser preview uses actionSheet.web.ts (react-native-web has no ActionSheetIOS).
export type SheetOption = {
  label: string;
  destructive?: boolean;
  onPress: () => void;
};

export function showActionSheet(title: string, options: SheetOption[]) {
  if (Platform.OS === 'ios') {
    const labels = [...options.map(o => o.label), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: labels,
        // The Cancel action is what lets a tap outside the sheet close it.
        cancelButtonIndex: labels.length - 1,
        // Every destructive choice in red ("Remove attachment", "Delete item").
        destructiveButtonIndex: options
          .map((o, i) => (o.destructive ? i : -1))
          .filter(i => i >= 0),
      },
      i => options[i]?.onPress(),
    );
    return;
  }
  Alert.alert(
    title,
    undefined,
    [
      ...options.map(o => ({
        text: o.label,
        style: o.destructive ? ('destructive' as const) : ('default' as const),
        onPress: o.onPress,
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ],
    // A tap outside closes it, as on iOS.
    { cancelable: true },
  );
}
