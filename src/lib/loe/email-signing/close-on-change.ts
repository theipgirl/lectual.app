import "server-only";

import { createHash } from "node:crypto";
import { publicProposalsDb, readPublicProposal, type PublicProposalRead, type PublicProposalsDb } from "@/lib/proposals/public";
import { isWellFormedProposalToken } from "@/lib/proposals/types";
import { closeTokenLimiter } from "../review-limit";
import { isMissingObjectError } from "./codes";
import { isObject, type SigningDb } from "./db";
import { markSigningNotSetUp } from "./not-set-up";

/**
 * New choices or details close the open signing link (spec decision 2; Sprint A item 17b). Token-bound: the `/p/` token's shape
 * -> its own limiter (20 per token per hour, courtesy) -> the proposal read by that token (live, carries a letter) -> the
 * in-flight request of THAT proposal id (service role) -> ONE `signing_close(proposal_changed)`. Answers only `{ closed }`; never
 * which reason it didn't. A bad token, a withdrawn proposal or the limiter writes nothing.
 */

export type CloseDeps = {
  db?: PublicProposalsDb;
  now: Date;
  read?: (token: string, now: Date, db: PublicProposalsDb) => Promise<PublicProposalRead>;
  limiter?: typeof closeTokenLimiter;
};

export async function closeOnChange(token: string, deps: CloseDeps): Promise<{ closed: boolean }> {
  try {
    const t = String(token ?? "");
    if (!isWellFormedProposalToken(t)) return { closed: false };
    const limiter = deps.limiter ?? closeTokenLimiter;
    const key = `t:${createHash("sha256").update(t).digest("hex")}`;
    if (!limiter.allowed(key)) return { closed: false };
    limiter.record(key);

    const db = publicProposalsDb(deps.db);
    const read = deps.read ? await deps.read(t, deps.now, db) : await readPublicProposal(t, deps.now, db, { emailSigning: false });
    if (read.status !== "ok" || read.handle.storedStatus !== "sent" || !read.view.content.loe) return { closed: false };
    const sdb = db as unknown as SigningDb;

    const { data, error } = await sdb
      .from("client_proposal_signing_request")
      .select("id, status")
      .eq("proposal_id", read.handle.proposalId)
      .eq("org_id", read.handle.orgId)
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) {
      if (isMissingObjectError(error)) markSigningNotSetUp();
      return { closed: false };
    }
    const inFlight = (Array.isArray(data) ? data : []).filter((r) => isObject(r) && (r.status === "sending" || r.status === "open") && typeof r.id === "string");
    let closed = false;
    for (const r of inFlight) {
      const c = await sdb.rpc("client_proposal_signing_close", { p_request_id: (r as { id: string }).id, p_reason: "proposal_changed" });
      if (c.error && isMissingObjectError(c.error)) markSigningNotSetUp();
      if (!c.error && c.data === true) closed = true;
    }
    return { closed };
  } catch {
    return { closed: false };
  }
}
