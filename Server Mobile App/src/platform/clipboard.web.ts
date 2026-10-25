import type { ClipboardAdapter } from './clipboard';

export const clipboard: ClipboardAdapter = {
  copy: text => navigator.clipboard.writeText(text),
};
