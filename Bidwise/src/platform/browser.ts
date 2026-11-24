import { Linking } from 'react-native';

// Opens a tender's source page. Plain Linking is enough for now; swap for an in-app
// browser library only if the design needs it.
export interface BrowserAdapter {
  open(url: string): Promise<void>;
}

export const browser: BrowserAdapter = {
  open: url => Linking.openURL(url),
};
