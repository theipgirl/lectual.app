import { quoteWithClientClasses } from "@/lib/proposals/client-classes";
import { normalizeSelection } from "@/lib/proposals/pricing";
import { buildAcceptedSnapshot } from "@/lib/proposals/public";
import type { AcceptedSnapshot, ProposalContent, ProposalRow } from "@/lib/proposals/types";
import { faithe } from "../proposals/general-fixture";
import { TEST_DETAILS } from "./full-letter-fixture";
import { twoBrandPerMark, withLoe } from "./loe-fixtures";

/** Test-only letter text for the flat-fee (general) kind. The real one is the firm's own; this has merge fields and no USPTO wording. */
export const GENERAL_LETTER_BODY = [
  "{{date}}",
  "{{client_name}}\n{{entity_name}}\n{{address_block}}",
  "**Scope.** We will do only the work listed in Exhibit A for the flat fee shown there.",
  "**Fee.** The flat fee in Exhibit A is due now. It is not an hourly charge.",
  "**Signature.** Signed by {{signer_name}} on {{signed_date}}. A copy goes to {{client_email}}.",
].join("\n\n");

export const SIGNED_AT = "2026-11-12T19:14:00.000Z";
export const FINGERPRINT = "c".repeat(64);

/** The two-brand per-mark fixture: partial selection (Essential, "Online retail" and "Consulting" NOT selected) plus a class the client typed. */
export function signedTrademark(): AcceptedSnapshot {
  const content = withLoe(twoBrandPerMark());
  const selection = normalizeSelection(content, {
    "fold-word": true,
    "fold-logo": false,
    "fold-c1": true,
    "fold-c2": false,
    "ci-word": true,
    "ci-logo": false,
    "ci-c1": true,
    "ci-c2": false,
  });
  const priced = quoteWithClientClasses(content, selection, { entries: {}, added: { ci: [{ text: "Gaming consoles", on: true }] } }, { repair: true });
  if (!priced.ok) throw new Error("no quote");
  return buildAcceptedSnapshot({
    version: 1,
    content: priced.content,
    selection: priced.selection,
    quote: priced.quote,
    acceptedAt: SIGNED_AT,
    signed: {
      agreement: { signature_id: "sig-1", signer_name: "Sevetri Wilson", signed_at: SIGNED_AT, sha256: FINGERPRINT, template_version: 3 },
      signing: { details: { ...TEST_DETAILS }, date_text: "November 12, 2026", client_email: "sevetri@example.com" },
    },
  });
}

/** Faithe Williams' flat-fee proposal, signed: matter, three work lines worth $1,250, flat fee $500. */
export function signedGeneral(): AcceptedSnapshot {
  const base: ProposalContent = faithe();
  const content: ProposalContent = {
    ...base,
    loe: { kind: "general", template_id: "22222222-2222-4222-8222-222222222222", template_version: 1, title: "Engagement letter", body: GENERAL_LETTER_BODY },
  };
  const priced = quoteWithClientClasses(content, normalizeSelection(content, {}), { entries: {}, added: {} }, { repair: true });
  if (!priced.ok) throw new Error("no quote");
  return buildAcceptedSnapshot({
    version: 1,
    content: priced.content,
    selection: priced.selection,
    quote: priced.quote,
    acceptedAt: SIGNED_AT,
    signed: {
      agreement: { signature_id: "sig-2", signer_name: "Faithe Williams", signed_at: SIGNED_AT, sha256: "e".repeat(64), template_version: 1 },
      signing: { details: { ...TEST_DETAILS, client_name: "Faithe Williams", entity_name: "" }, date_text: "November 12, 2026", client_email: "faithe@example.com" },
    },
  });
}

export function acceptedProposalRow(snapshot: AcceptedSnapshot, over: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    org_id: "org-1",
    family_id: "44444444-4444-4444-8444-444444444444",
    version: 1,
    public_token: "t".repeat(43),
    lead_id: "lead-1",
    matter_id: "matter-1",
    client_name: "Sevetri Wilson",
    client_email: "sevetri@example.com",
    title: "Trademark Proposal",
    status: "accepted",
    content: snapshot.content,
    expires_on: null,
    pay_url: "https://pay.example/x",
    source: "manual",
    created_by: null,
    updated_by: null,
    approved_by: null,
    approved_at: null,
    sent_at: null,
    accepted_at: SIGNED_AT,
    superseded_at: null,
    withdrawn_at: null,
    accepted_selection: snapshot.selection,
    accepted_snapshot: snapshot,
    created_at: "2026-11-10T12:00:00Z",
    updated_at: SIGNED_AT,
    ...over,
  };
}
