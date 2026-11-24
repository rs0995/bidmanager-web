/// <reference lib="dom" />
// Browser preview: a numbered prompt stands in for the iOS action sheet.
import type { SheetOption } from './actionSheet';

export type { SheetOption };

export function showActionSheet(title: string, options: SheetOption[]) {
  const answer = window.prompt(
    `${title}\n${options.map((o, i) => `${i + 1}. ${o.label}`).join('\n')}`,
  );
  const i = Number(answer) - 1;
  options[i]?.onPress();
}
