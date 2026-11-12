/**
 * "More options" (Sprint 28 C): the one closed section of New proposal (the editor has two Advanced sections since Sprint 1) that holds
 * everything a person rarely changes. Pure, so the count, the summary and the "open it on an
 * error" rule are tested without a browser.
 */

export const MORE_OPTIONS_LABEL = "More options";

/** "More options", or "More options - 2 changed" once something differs from the firm's defaults. */
export function moreOptionsSummary(changed: number): string {
  return changed > 0 ? `${MORE_OPTIONS_LABEL} - ${changed} changed` : MORE_OPTIONS_LABEL;
}

/** How many fields differ from their default. Compared as trimmed text, so "4950" and " 4950 " agree. */
export function countChangedFields(fields: ReadonlyArray<{ current: string; baseline: string }>): number {
  return fields.filter((f) => f.current.trim() !== f.baseline.trim()).length;
}

/**
 * The same question for a refusal that comes back as a sentence ("Second-mark discount: enter a
 * percentage from 0 to 100."). The parsers always begin with the field's label.
 */
const MORE_LABELS = [
  "price",
  "base price",
  "price per class",
  "classes included",
  "second-mark discount",
  "second mark discount",
  "uspto fee",
  "title",
  "this brand",
];

export function messageInMoreOptions(message: string | null | undefined): boolean {
  if (!message) return false;
  const label = message.split(":")[0]?.trim().toLowerCase() ?? "";
  return MORE_LABELS.some((l) => label === l || label.startsWith(`${l} `));
}
