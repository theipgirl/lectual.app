import "server-only";

import { LawmaticsNotConnectedError, firmLawmaticsClient } from "@/lib/lawmatics/connection";
import { field, idOf, records } from "@/lib/lawmatics/jsonapi";
import { isFieldId, readLoeFieldsConfig, type LoeFieldsConfig } from "./loe-fields";
import { getProposalSettings } from "./store";

/**
 * What the Settings -> Integrations -> Lawmatics "LOE fields" section reads: the saved setting
 * (from the proposals settings row) and the firm's own Lawmatics custom fields to choose from.
 * Both reads are three-state, and a failed one is never "off" and never "no fields": the saved
 * mapping is shown and kept whatever the field list does.
 */

export type LawmaticsFieldOption = { id: string; name: string };

/** `GET /custom_fields?fields=all` through the read-only client. Null when the list couldn't be loaded (not connected, rejected, or unreachable). */
export async function loadLawmaticsCustomFields(): Promise<LawmaticsFieldOption[] | null> {
  try {
    const client = await firmLawmaticsClient();
    const payload = await client.get("/custom_fields", { fields: "all", "page[size]": "100" });
    const seen = new Set<string>();
    const out: LawmaticsFieldOption[] = [];
    for (const rec of records(payload)) {
      const id = idOf(rec);
      const name = field(rec, "name", "label", "title");
      if (!id || !name || !isFieldId(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    if (!(err instanceof LawmaticsNotConnectedError)) console.error("[proposals] the Lawmatics custom field list couldn't be loaded");
    return null;
  }
}

export type LoeFieldsRead = { status: "ok"; config: LoeFieldsConfig } | { status: "unavailable" };

/** The saved setting; `unavailable` when the proposals settings couldn't be read. No saved row is "off, nothing matched". */
export async function loadLoeFieldsConfig(): Promise<LoeFieldsRead> {
  try {
    const row = await getProposalSettings();
    return { status: "ok", config: readLoeFieldsConfig(row?.pricing ?? {}) };
  } catch {
    return { status: "unavailable" };
  }
}
