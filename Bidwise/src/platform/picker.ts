import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
} from '@react-native-documents/picker';

// Document picker for checklist attachments and prep docs. The pick is copied into the
// app's caches (the picker's own access is temporary); the stores then keep a permanent
// copy under Documents/attachments/ (see sharedProjects.ts).
export type PickedFile = {
  uri: string;
  name: string;
  size: number | null;
  mimeType: string | null;
};

export interface PickerAdapter {
  /** Resolves null when the user cancels. */
  pickDocument(): Promise<PickedFile | null>;
}

export const picker: PickerAdapter = {
  async pickDocument() {
    try {
      const [file] = await pick({ allowMultiSelection: false });
      const name = file.name || 'Document';
      const [copy] = await keepLocalCopy({
        files: [{ uri: file.uri, fileName: name }],
        destination: 'cachesDirectory',
      });
      return {
        uri: copy.status === 'success' ? copy.localUri : file.uri,
        name,
        size: file.size,
        mimeType: file.type,
      };
    } catch (e) {
      if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED)
        return null;
      throw e;
    }
  },
};
