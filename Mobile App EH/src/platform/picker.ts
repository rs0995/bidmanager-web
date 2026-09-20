// Phase 2D: implement with @react-native-documents/picker; copy the pick into app storage.
export type PickedFile = {
  uri: string;
  name: string;
  size: number | null;
  mimeType: string | null;
};

export interface PickerAdapter {
  pickDocument(): Promise<PickedFile | null>;
}

export const picker: PickerAdapter = {
  pickDocument: () =>
    Promise.reject(new Error('picker is not wired yet (Phase 2D)')),
};
