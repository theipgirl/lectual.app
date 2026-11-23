import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { ProposalContent } from "@/lib/proposals/types";
import type { LetterCopyCheck } from "../editor-state";
import { letterLiveCheck } from "../live-guard";
import { isSigningAddress } from "./address";
import { isMissingObjectError } from "./codes";
import { isObject, type SigningDb } from "./db";
import { emailSigningGate, type GateEnv, type GateResult } from "./gate";
import { markSigningNotSetUp } from "./not-set-up";
import { parseReadiness, readyDecision, type ReadinessRpc } from "./ready-rules";
import { localFailures } from "./failure-memo";

/**
 * Per-proposal readiness for the emailed link (Sprint A item 2). The decision is `readyDecision` (`ready-rules.ts`, pure); this
 * file reads, as the service role and fenced on the proposal row's own org: the gate, the RAW row (its `content` with the letter
 * copy's template id and version, and its `client_email`, neither of which the public view carries), the letter check
 * (`letterLiveCheck`, the one make-live guard) and ONE `client_proposal_signing_readiness` rpc, so the app and 0117 can never
 * disagree about a refusal `signing_open` would make. Every uncertainty resolves to NOT ready: today's in-app signing.
 */

export type ReadyRow = { orgId: string; proposalId: string; familyId: string; version: number; content: ProposalContent; clientEmail: string };

export type Readiness =
  | { ready: true; gate: Extract<GateResult, { on: true }>; row: ReadyRow }
  | { ready: false; gate: GateResult | null; failures: number | null };

export type ReadyDeps = {
  db: () => SigningDb;
  env?: GateEnv;
  /** The letter check; defaults to `letterLiveCheck` over the same service-role client. */
  letterCheck?: (row: { org_id: string; content: ProposalContent }) => Promise<LetterCopyCheck>;
};

const NOT_READY = (gate: GateResult | null, failures: number | null = null): Readiness => ({ ready: false, gate, failures });

export async function emailSigningReadiness(handle: { proposalId: string; orgId: string }, deps: ReadyDeps): Promise<Readiness> {
  try {
    const gate = await emailSigningGate(handle.orgId, { db: deps.db, env: deps.env });
    if (!gate.on) return NOT_READY(gate);
    const db = deps.db();

    const { data, error } = await db
      .from("client_proposal")
      .select("id, org_id, family_id, version, status, content, client_email")
      .eq("id", handle.proposalId)
      .eq("org_id", handle.orgId)
      .maybeSingle();
    if (error || !isObject(data) || data.status !== "sent" || !isObject(data.content)) return NOT_READY(gate);
    const content = data.content as unknown as ProposalContent;
    const row: ReadyRow = {
      orgId: handle.orgId,
      proposalId: handle.proposalId,
      familyId: typeof data.family_id === "string" ? data.family_id : handle.proposalId,
      version: typeof data.version === "number" ? data.version : 1,
      content,
      clientEmail: typeof data.client_email === "string" ? data.client_email : "",
    };
    const hasLetter = isObject(content.loe);
    const addressOk = isSigningAddress(row.clientEmail);

    const check = deps.letterCheck ?? ((r) => letterLiveCheck(db as unknown as SupabaseClient<Database>, r));
    let letterCheck: LetterCopyCheck | null = null;
    if (hasLetter && addressOk) {
      try {
        letterCheck = await check({ org_id: handle.orgId, content });
      } catch {
        letterCheck = "unreadable";
      }
    }

    let readiness: ReadinessRpc | null = null;
    if (letterCheck === "current") {
      try {
        const r = await db.rpc("client_proposal_signing_readiness", { p_proposal_id: handle.proposalId, p_org_id: handle.orgId });
        if (r.error) {
          if (isMissingObjectError(r.error)) {
            markSigningNotSetUp();
            readiness = { kind: "missing" };
          } else readiness = { kind: "error" };
        } else readiness = parseReadiness(r.data);
      } catch {
        readiness = { kind: "error" };
      }
    }

    const local = localFailures(handle.proposalId);
    const ok = readyDecision({ gateOn: true, hasLetter, letterCheck, addressOk, readiness, localFailures: local });
    if (!ok) return NOT_READY(gate, readiness?.kind === "ok" ? readiness.failures + local : null);
    return { ready: true, gate, row };
  } catch {
    return NOT_READY(null);
  }
}
