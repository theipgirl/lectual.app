import "server-only";

import type { LawmaticsClient } from "./client";
import { readFieldMeta, type FieldMetaRead } from "./field-meta";
import { field, idOf } from "./jsonapi";

export type OriginLookups = {
  /** Tag id -> name. Empty when /tags couldn't be read (the tag rules are then skipped). */
  tagNames: Map<string, string>;
  /** Custom field id -> name. Empty when it couldn't be read (names on the values, then id hints, decide). */
  fieldNames: Map<string, string>;
  /**
   * The same `/custom_fields` read, kept whole (type and option labels), for the callers that print a value (the consult brief). One
   * read feeds both: `fieldNames` is its names. `failed` when the list couldn't be read.
   */
  fieldMeta?: FieldMetaRead;
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
  const [tagNames, fieldMeta] = await Promise.all([nameMap(client, "/tags"), readFieldMeta(client)]);
  const fieldNames = new Map<string, string>();
  if (fieldMeta.state === "ok") for (const [id, m] of fieldMeta.index.byId) if (m.name) fieldNames.set(id, m.name);
  return { tagNames, fieldNames, fieldMeta };
}
