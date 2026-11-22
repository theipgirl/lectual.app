import type { ColumnsSettingsState, SettingsField } from "@/lib/custom-columns/settings-load";

/** Settings -> Columns fixtures, in the one list's order. Invented names only. */
export const S = {
  fee: "00000000-0000-4000-8000-00000000c101",
  priority: "00000000-0000-4000-8000-00000000c102",
  review: "00000000-0000-4000-8000-00000000c103",
  old: "00000000-0000-4000-8000-00000000c104",
};
export const STAMP = "2026-11-20T10:00:00.123456+00:00";
const f = (over: Partial<SettingsField> & { id: string; label: string }): SettingsField => ({ section: "trademarks", kind: "text", options: [], position: 0, archived: false, updatedAt: STAMP, ...over });
export const LIVE: SettingsField[] = [
  f({ id: S.fee, label: "Quoted fee", section: "both", kind: "money", position: 1 }),
  f({ id: S.priority, label: "Priority", section: "trademarks", kind: "choice", options: ["High", "Medium", "Low"], position: 2 }),
  f({ id: S.review, label: "Review date", section: "contracts", kind: "date", position: 3 }),
];
export const ARCHIVED: SettingsField[] = [f({ id: S.old, label: "Old flag", archived: true, position: 4 })];
export const OK: ColumnsSettingsState = { status: "ok", live: LIVE, archived: ARCHIVED, dropped: 0, use: { status: "ok", counts: { [S.priority]: { High: 3, Low: 1 } } } };
