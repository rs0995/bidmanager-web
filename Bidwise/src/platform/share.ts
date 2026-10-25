// Phase 2F/2G: implement with react-native-share (share a local file, e.g. CSV or PDF).
export interface ShareAdapter {
  shareFile(path: string, mimeType?: string): Promise<void>;
}

export const share: ShareAdapter = {
  shareFile: () =>
    Promise.reject(new Error('share is not wired yet (Phase 2F)')),
};
