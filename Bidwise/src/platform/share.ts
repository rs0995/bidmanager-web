import { Share } from 'react-native';

// Phase 2F/2G: implement shareFile with react-native-share (share a local file, e.g. CSV or PDF).
export interface ShareAdapter {
  shareFile(path: string, mimeType?: string): Promise<void>;
  /** The iOS share sheet for text (its first action is Copy). */
  shareText(text: string, title?: string): Promise<void>;
}

export const share: ShareAdapter = {
  shareFile: () =>
    Promise.reject(new Error('share is not wired yet (Phase 2F)')),
  shareText: async (text, title) => {
    await Share.share({ message: text, title });
  },
};
