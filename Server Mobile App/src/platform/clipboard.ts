import Clipboard from '@react-native-clipboard/clipboard';

export interface ClipboardAdapter {
  copy(text: string): Promise<void>;
}

export const clipboard: ClipboardAdapter = {
  async copy(text) {
    Clipboard.setString(text);
  },
};
