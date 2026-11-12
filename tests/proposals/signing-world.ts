import { agreementFingerprint } from "@/lib/loe/fingerprint";
import { buildExhibit } from "@/lib/loe/exhibit";
import { assembleAgreement, cleanSigningDetails, type SignerDetails } from "@/lib/loe/signing";
import { money } from "@/components/client-proposal/format";
import { parseClientClassInput, quoteWithClientClasses } from "@/lib/proposals/client-classes";
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

/** What the page does in the browser: the same pure pipeline, over the same read, cleaned details, then the fingerprint. */
export async function browserSigning(
  db: ReturnType<typeof world>["db"],
  over: { details?: SignerDetails | Record<string, unknown>; typedName?: string; agree?: boolean; selection?: Record<string, boolean> } = {},
) {
  const read = await readPublicProposal(TOKEN, NOW, db);
  if (read.status !== "ok" || !read.view.letter) throw new Error("no letter");
  const content = read.view.content;
  const selection = normalizeSelection(content, { ...defaultSelection(content), ...(over.selection ?? {}) });
  const priced = quoteWithClientClasses(content, selection, parseClientClassInput(content, undefined), { repair: true });
  if (!priced.ok) throw new Error("no quote");
  const details = cleanSigningDetails(over.details ?? TEST_DETAILS);
  const typedName = over.typedName ?? "Sevetri Wilson";
  const exhibit = buildExhibit(priced.content, priced.quote, money);
  const assembled = assembleAgreement({
    body: content.loe!.body,
    inputs: { details, typedName: cleanSigningDetails({ client_name: typedName }).client_name, dateText: read.view.letter.dateText, clientEmail: read.view.letter.clientEmail },
    exhibit,
  });
  if (!assembled.ok) throw new Error("no agreement");
  const fingerprint = agreementFingerprint({ letter: assembled.agreement.blocks, details, exhibit });
  return {
    selection,
    text: assembled.agreement.text,
    signing: { typedName, agree: over.agree ?? true, details: over.details ?? TEST_DETAILS, fingerprint },
  };
}

