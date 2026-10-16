import type { Database } from "@/lib/db/types";
import type { StageCategory, TagDimension } from "@/lib/settings/admin";

/**
 * Plain (non-"use server") module for the settings form enums and their
 * type guards. Next.js 16 requires every export of a "use server" file to be
 * an async function, so these constants — imported directly by client
 * components (NewStageForm, NewTagForm, TagRow) — cannot live in
 * `actions.ts` alongside the server actions. See AGENTS.md / node_modules/
 * next/dist/docs/ for the server-action export rule.
 */

export const STAGE_CATEGORIES = [
  "open",
  "won",
  "lost",
  "nurture",
] as const satisfies readonly Database["public"]["Enums"]["crm_stage_category"][];

export const TAG_DIMENSIONS = [
  "PA",
  "SERV",
  "URG",
  "VAL",
  "QUAL",
  "SRC",
  "EVENT",
  "FU",
  "BILL",
  "OPS",
  "SEG",
  "CAMP",
] as const satisfies readonly Database["public"]["Enums"]["crm_tag_dimension"][];

export function isStageCategory(value: unknown): value is StageCategory {
  return typeof value === "string" && (STAGE_CATEGORIES as readonly string[]).includes(value);
}

export function isTagDimension(value: unknown): value is TagDimension {
  return typeof value === "string" && (TAG_DIMENSIONS as readonly string[]).includes(value);
}
