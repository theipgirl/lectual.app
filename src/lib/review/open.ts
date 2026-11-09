import type { ReviewKind } from "./buckets";

/**
 * `?open=<matter|lead>:<uuid>` on the review URL opens the detail panel for one record. Pure.
 * Anything that is not exactly one of the two kinds, a colon and a uuid is no panel at all.
 */
export type OpenRef = { kind: ReviewKind; id: string };

const OPEN = /^(matter|lead):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function parseOpenParam(raw: string | string[] | null | undefined): OpenRef | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const m = OPEN.exec(value.trim());
  return m ? { kind: m[1].toLowerCase() as ReviewKind, id: m[2].toLowerCase() } : null;
}

export function openToken(ref: OpenRef): string {
  return `${ref.kind}:${ref.id}`;
}
