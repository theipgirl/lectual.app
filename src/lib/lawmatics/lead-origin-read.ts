import "server-only";

import type { LawmaticsClient } from "./client";
import { field, idOf } from "./jsonapi";

export type OriginLookups = {
  /** Tag id -> name. Empty when /tags couldn't be read (the tag rules are then skipped). */
  tagNames: Map<string, string>;
  /** Custom field id -> name. Empty when it couldn't be read (names on the values, then id hints, decide). */
  fieldNames: Map<string, string>;
};

async function nameMap(client: LawmaticsClient, path: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const r = await client.listAll(path);
    if (r.unrecognisedShape) return out;
    for (const rec of r.records) {
      const id = idOf(rec);
      const name = field(rec, "name", "title", "label");
      if (id && name) out.set(id, name);
    }
  } catch {
    /* optional: origin rules that need it are skipped, nothing fails */
  }
  return out;
}

/** Read once per run, read-only. Never throws. */
export async function readOriginLookups(client: LawmaticsClient): Promise<OriginLookups> {
  const [tagNames, fieldNames] = await Promise.all([nameMap(client, "/tags"), nameMap(client, "/custom_fields")]);
  return { tagNames, fieldNames };
}
