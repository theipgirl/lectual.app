import "server-only";

import type { getScopedClient } from "@/lib/db/scoped-client";
import { LawmaticsNotConnectedError, firmLawmaticsToken } from "@/lib/lawmatics/connection";
import { accessText, STEP_TEXT } from "./step-text";
import type { ProposalRow } from "./types";

/**
 * The two lookups every signed-in Sprint 19 step that talks to Lawmatics starts with:
 * the firm's own token, and the one matter the proposal belongs to. Both are three-state
 * (found / nothing / couldn't read) so a failed read is never reported as "no matter" or
 * "not connected".
 */

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

export type TokenAccess = { status: "ok"; token: string } | { status: "not_connected" } | { status: "unavailable" };

/** The calling firm's own token, from an ACTIVE connection only (`firmLawmaticsToken`). */
export async function signedInLawmaticsToken(): Promise<TokenAccess> {
  try {
    return { status: "ok", token: await firmLawmaticsToken() };
  } catch (err) {
    return err instanceof LawmaticsNotConnectedError ? { status: "not_connected" } : { status: "unavailable" };
  }
}

export type MatterLookup =
  | { status: "one"; id: string; lawmaticsId: string | null }
  | { status: "none" }
  | { status: "many" }
  | { status: "unreadable" };

function lawmaticsIdOf(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() || null : null;
}

/**
 * The proposal's matter: `matter_id` when it is set; otherwise the single matter whose
 * `lead_id` is the proposal's lead. Two or more is `many` (never picked); a matter is
 * never created or opened here.
 */
export async function resolveProposalMatter(supabase: ScopedClient, proposal: Pick<ProposalRow, "matter_id" | "lead_id">): Promise<MatterLookup> {
  try {
    if (proposal.matter_id) {
      const { data, error } = await supabase.from("crm_matter").select("id, lawmatics_id").eq("id", proposal.matter_id).maybeSingle();
      if (error) return { status: "unreadable" };
      return data ? { status: "one", id: data.id, lawmaticsId: lawmaticsIdOf(data.lawmatics_id) } : { status: "none" };
    }
    if (!proposal.lead_id) return { status: "none" };
    const { data, error } = await supabase.from("crm_matter").select("id, lawmatics_id").eq("lead_id", proposal.lead_id).limit(3);
    if (error) return { status: "unreadable" };
    const rows = data ?? [];
    if (rows.length === 0) return { status: "none" };
    if (rows.length > 1) return { status: "many" };
    return { status: "one", id: rows[0].id, lawmaticsId: lawmaticsIdOf(rows[0].lawmatics_id) };
  } catch {
    return { status: "unreadable" };
  }
}

export type LawmaticsMatterAccess = { ok: true; token: string; lawmaticsId: string } | { ok: false; reason: string };

/**
 * Everything a write to the proposal's Lawmatics matter needs: one matter that is linked to
 * Lawmatics, and the firm's own active connection. Otherwise the sentence that says which
 * is missing. `did` is the word for what would have happened ("uploaded" or "written").
 */
export function lawmaticsMatterAccess(matter: MatterLookup, token: TokenAccess, did: "uploaded" | "written"): LawmaticsMatterAccess {
  const text = accessText(did);
  if (matter.status === "none") return { ok: false, reason: text.noMatter };
  if (matter.status === "many") return { ok: false, reason: text.manyMatters };
  if (matter.status === "unreadable") return { ok: false, reason: text.mattersUnreadable };
  if (token.status === "not_connected") return { ok: false, reason: text.notConnected };
  if (token.status === "unavailable") return { ok: false, reason: text.connectionUnreadable };
  if (!matter.lawmaticsId) return { ok: false, reason: STEP_TEXT.matterNotLinked };
  return { ok: true, token: token.token, lawmaticsId: matter.lawmaticsId };
}
