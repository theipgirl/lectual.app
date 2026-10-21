import "server-only";

import type { getScopedClient } from "@/lib/db/scoped-client";
import { LawmaticsNotConnectedError, firmLawmaticsClient } from "@/lib/lawmatics/connection";
import { pullSource } from "@/lib/lawmatics/import";
import type { LawmaticsSourceRecord } from "@/lib/lawmatics/normalize";
import type { StoredMail } from "./email";
import type { LeadRow, StageOpt } from "./types";

/**
 * The server-side readers behind the reconciliation screen. Every database read goes through the
 * caller's scoped client (RLS on the active org), and the Lawmatics read uses the firm's own
 * connection with the read-only client (`get` and `listAll` only: it has no write method).
 *
 * Each reader reports a failure as a named state. None returns an empty result for a failed read.
 */

type Scoped = Awaited<ReturnType<typeof getScopedClient>>;

const PAGE = 1000;
/** Most leads read in one preview; past this the screen says the list was cut short. */
export const LEAD_CAP = 10_000;
/** Leads whose mail is read per query. */
const MAIL_BATCH = 50;
/** Most pages of mail read for one batch of leads. */
const MAIL_PAGES = 10;

export async function readStages(supabase: Scoped): Promise<StageOpt[]> {
  const { data, error } = await supabase
    .from("crm_stage")
    .select("id, name, category, order_index")
    .order("order_index", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((s) => ({ id: s.id, name: s.name, category: String(s.category), orderIndex: s.order_index }));
}

export type LeadsRead = { leads: LeadRow[]; truncated: boolean };

/** Every lead the caller can see, paged past the 1,000-row default up to LEAD_CAP. Throws on a failed read. */
export async function readLeads(supabase: Scoped): Promise<LeadsRead> {
  const leads: LeadRow[] = [];
  let truncated = false;
  for (let from = 0; ; from += PAGE) {
    if (from >= LEAD_CAP) {
      truncated = true;
      break;
    }
    const { data, error } = await supabase
      .from("crm_lead")
      .select("id, first_name, last_name, email, current_stage_id, sheet_key, lawmatics_id, practice_area")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    for (const r of page) {
      leads.push({
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
        currentStageId: r.current_stage_id,
        sheetKey: r.sheet_key,
        lawmaticsId: r.lawmatics_id,
        practiceArea: r.practice_area,
      });
    }
    if (page.length < PAGE) break;
  }
  return { leads, truncated };
}

export type LawmaticsRead =
  | { status: "ok"; records: LawmaticsSourceRecord[] }
  | { status: "not-connected"; reason: string }
  | { status: "unavailable"; reason: string };

/**
 * The firm's Lawmatics book, read-only. A pull that was cut short, or that came back without its
 * stage relationships, is `unavailable`: comparing against half a book would read "not found" as
 * "has no stage".
 */
export async function readLawmatics(): Promise<LawmaticsRead> {
  try {
    const client = await firmLawmaticsClient();
    const pull = await pullSource(client);
    if (pull.includeDropped) {
      return { status: "unavailable", reason: "Lawmatics did not return stage details, so its stages can't be compared." };
    }
    if (pull.truncated) {
      return { status: "unavailable", reason: "Lawmatics returned only part of the firm's records, so its stages can't be compared." };
    }
    return { status: "ok", records: pull.records };
  } catch (err) {
    if (err instanceof LawmaticsNotConnectedError) return { status: "not-connected", reason: err.message };
    console.error("[reconcile] lawmatics read failed", err instanceof Error ? err.name : "error");
    return { status: "unavailable", reason: "Lawmatics could not be reached. Try again shortly." };
  }
}

export type EmailRead =
  | { status: "ok"; byLead: Map<string, StoredMail[]>; total: number }
  | { status: "unavailable"; reason: string };

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The mail the sync already stored on these leads' timelines (`email_sent` / `email_received`, each
 * with its classification in the payload). No mail is fetched. A lead with no mail is simply absent
 * from the map; a failed read is `unavailable`.
 */
export async function readStoredMail(supabase: Scoped, leadIds: readonly string[]): Promise<EmailRead> {
  const byLead = new Map<string, StoredMail[]>();
  let total = 0;
  try {
    for (const batch of chunk(leadIds, MAIL_BATCH)) {
      let done = false;
      for (let page = 0; page < MAIL_PAGES && !done; page++) {
        const { data, error } = await supabase
          .from("crm_activity")
          .select("lead_id, payload, created_at")
          .in("lead_id", batch)
          .in("type", ["email_sent", "email_received"])
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) throw error;
        const rows = data ?? [];
        for (const row of rows) {
          if (!row.lead_id) continue;
          const payload = (row.payload ?? {}) as Record<string, unknown>;
          const at = typeof payload.at === "string" ? payload.at : row.created_at;
          const list = byLead.get(row.lead_id) ?? [];
          list.push({
            type: typeof payload.type === "string" ? payload.type : null,
            sensitive: payload.sensitive === true,
            at,
          });
          byLead.set(row.lead_id, list);
          total += 1;
        }
        if (rows.length < PAGE) done = true;
      }
      if (!done) throw new Error("mail-too-large");
    }
  } catch (err) {
    console.error("[reconcile] stored mail read failed", err instanceof Error ? err.name : "error");
    return { status: "unavailable", reason: "The synced mail on the timeline could not be read. Try again shortly." };
  }
  return { status: "ok", byLead, total };
}
