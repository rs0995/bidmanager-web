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
        cancelButtonIndex: labels.length - 1,
        destructiveButtonIndex: options.findIndex(o => o.destructive),
      },
      i => options[i]?.onPress(),
    );
    return;
  }
  Alert.alert(title, undefined, [
    ...options.map(o => ({
      text: o.label,
      style: o.destructive ? ('destructive' as const) : ('default' as const),
      onPress: o.onPress,
    })),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}
