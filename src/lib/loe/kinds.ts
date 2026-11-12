export const LOE_KIND_NAMES = ["trademark", "general"] as const;
export type LoeKindName = (typeof LOE_KIND_NAMES)[number];
export function isLoeKindName(v: unknown): v is LoeKindName {
  return v === "trademark" || v === "general";
}
