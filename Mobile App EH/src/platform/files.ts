// Phase 2F: implement with react-native-blob-util (download, read, write, copy, delete).
export interface FileAdapter {
  documentsDir: string;
  download(
    url: string,
    destPath: string,
    headers?: Record<string, string>,
  ): Promise<string>;
  exists(path: string): Promise<boolean>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(dir: string): Promise<string[]>;
}

const notReady = () =>
  Promise.reject(new Error('files is not wired yet (Phase 2F)'));

export const files: FileAdapter = {
  documentsDir: '',
  download: notReady,
  exists: notReady,
  readBytes: notReady,
  writeBytes: notReady,
  copy: notReady,
  remove: notReady,
  list: notReady,
};
