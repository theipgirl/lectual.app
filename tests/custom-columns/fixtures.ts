import type { CustomData, CustomField, CustomValue } from "@/lib/custom-columns/rules";

/** Invented data only (Acme Studio, Northwind Tea): ids are fixed uuids so a test can name them. */
export const F_PRIORITY = "00000000-0000-4000-8000-00000000f001";
export const F_SIGNED = "00000000-0000-4000-8000-00000000f002";
export const F_BOTH = "00000000-0000-4000-8000-00000000f003";
export const F_FEE = "00000000-0000-4000-8000-00000000f004";
export const F_PERSON = "00000000-0000-4000-8000-00000000f005";
export const F_NOTE = "00000000-0000-4000-8000-00000000f006";

export const field = (over: Partial<CustomField> & { id: string }): CustomField => ({ section: "trademarks", label: "Label", kind: "text", position: 0, options: [], ...over });

export const PRIORITY = field({ id: F_PRIORITY, label: "Priority", kind: "choice", options: ["High", "Low"], position: 1 });
export const SIGNED = field({ id: F_SIGNED, section: "contracts", label: "Signed on", kind: "date", position: 2 });
export const BOTH = field({ id: F_BOTH, section: "both", label: "Next review", kind: "text", position: 3 });
export const FEE = field({ id: F_FEE, label: "Quoted fee", kind: "money", position: 4 });
export const PERSON = field({ id: F_PERSON, label: "Reviewer", kind: "person", position: 5 });
export const NOTE = field({ id: F_NOTE, label: "Note", kind: "text", position: 6 });

let n = 0;
export function value(over: Partial<CustomValue> & { fieldId: string }): CustomValue {
  n += 1;
  return { id: `v${String(n).padStart(4, "0")}`, leadId: null, matterId: null, text: null, date: null, cents: null, choice: null, userId: null, updatedAt: "2026-11-01T10:00:00Z", ...over };
}

export const data = (over: Partial<CustomData> = {}): CustomData => ({ fields: [PRIORITY, SIGNED, BOTH, FEE, PERSON, NOTE], values: [], mergedInto: {}, leadOfMatter: {}, ...over });
