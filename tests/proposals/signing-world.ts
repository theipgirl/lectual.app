import { buildExhibit } from "@/lib/loe/exhibit";
import { pageAgreement, pageSigningPayload, type SignerDetails } from "@/lib/loe/signing";
import { money } from "@/components/client-proposal/format";
import { quoteForAcceptance } from "@/lib/proposals/client-classes";
import { defaultSelection, normalizeSelection } from "@/lib/proposals/pricing";
import { readPublicProposal } from "@/lib/proposals/public";
import { fakeDb, signAndAcceptImpl, type Row } from "./public-db-double";
import { TEST_DETAILS } from "../loe/full-letter-fixture";
import { twoBrandPerMark, withLoe } from "../loe/loe-fixtures";

/** A fake service-role world holding one live proposal with an engagement letter, and the browser-side signing pipeline. */

export const TOKEN = "T".repeat(43);
export const NOW = new Date("2026-10-20T15:00:00.000Z");

export function world(over: { content?: unknown; proposal?: Row; token?: string; noRpc?: boolean; rpcImpl?: Parameters<typeof fakeDb>[1] extends infer O ? (O extends { rpcImpl?: infer F } ? F : never) : never } = {}) {
  const proposal: Row = {
    id: "prop-2",
    org_id: "org-1",
    family_id: "prop-1",
    version: 2,
    public_token: over.token ?? TOKEN,
    title: "Trademark Proposal",
    client_name: "Sevetri Wilson",
    client_email: "sevetri@example.com",
    status: "sent",
    content: over.content ?? withLoe(twoBrandPerMark()),
    expires_on: "2026-10-26",
    pay_url: "https://app.lawmatics.com/forms/share/abc",
    sent_at: "2026-10-19T00:00:00Z",
    accepted_at: null,
    accepted_selection: null,
    accepted_snapshot: null,
    ...over.proposal,
  };
  return fakeDb(
    {
      client_proposal: [proposal],
      crm_org: [{ id: "org-1", name: "RPB Law Firm", slug: "rpb-law", modules: ["agents", "proposals"] }],
      crm_org_profile: [{ org_id: "org-1", time_zone: "America/New_York" }],
      client_proposal_event: [],
    },
    { rpcImpl: over.rpcImpl ?? signAndAcceptImpl, noRpc: over.noRpc },
  );
}

/**
 * What the page does in the browser: the REAL page pipeline (`pageAgreement` / `pageSigningPayload`, the functions `useLoeFlow`
 * calls), over the same read. The typed name and details go in exactly as typed; nothing here cleans them for the page.
 * `pageDate` overrides the date the page was opened with (the read's own by default).
 */
export async function browserSigning(
  db: ReturnType<typeof world>["db"],
  over: {
    details?: SignerDetails | Record<string, unknown>;
    typedName?: string;
    agree?: boolean;
    selection?: Record<string, boolean>;
    pageDate?: string;
    readAt?: Date;
    /** What the client wrote in the class boxes, exactly as typed: `{ entries, added }`. */
    clientClasses?: unknown;
  } = {},
) {
  const read = await readPublicProposal(TOKEN, over.readAt ?? NOW, db);
  if (read.status !== "ok" || !read.view.letter) throw new Error("no letter");
  const content = read.view.content;
  const selection = normalizeSelection(content, { ...defaultSelection(content), ...(over.selection ?? {}) });
  // The page builds what it signs over with `quoteForAcceptance` (ProposalDocument's `signBasis`), the function the server calls.
  const priced = quoteForAcceptance(content, selection, over.clientClasses);
  if (!priced.ok) throw new Error("no quote");
  const typedName = over.typedName ?? "Sevetri Wilson";
  const state = {
    body: content.loe!.body,
    details: over.details ?? TEST_DETAILS,
    typedName,
    dateText: over.pageDate ?? read.view.letter.dateText,
    clientEmail: read.view.letter.clientEmail,
    exhibit: buildExhibit(priced.content, priced.quote, money),
  };
  const agreement = pageAgreement(state);
  if (!agreement) throw new Error("no agreement");
  const payload = await pageSigningPayload({ ...state, agree: true });
  if (!payload) throw new Error("the page could not sign");
  return {
    selection,
    /** What the client wrote, as typed: posted beside the ticks. */
    clientClasses: over.clientClasses,
    /** The agreement text as THE PAGE drew it (its own date). The server stamps its own date into what it stores. */
    text: agreement.text,
    pageDate: state.dateText,
    /** What the page posts. `agree` may be overridden to play a hand-made post. */
    signing: { ...payload, agree: over.agree ?? true },
    /** A hand-made post: the page's fingerprint with the values exactly as typed (the server must clean them itself). */
    rawSigning: { typedName, agree: over.agree ?? true, details: over.details ?? TEST_DETAILS, fingerprint: payload.fingerprint },
  };
}
