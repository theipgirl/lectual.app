import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument, type ProposalDocumentProps } from "@/components/client-proposal/ProposalDocument";
import { rebuildSignedLetter } from "@/lib/loe/signed-letter";
import { withLoeSnapshot, type ApprovedLetter } from "@/lib/proposals/loe-snapshot";
import { editorLetterState } from "@/lib/loe/editor-state";
import { faithe } from "../proposals/general-fixture";
import { sevetri } from "../proposals/fixture";
import { CONTINUE_LABEL, DOWNLOAD_SIGNED_LABEL, PAY_LABEL } from "@/lib/loe/client-words";
import { TEST_DETAILS } from "./full-letter-fixture";
import { GENERAL_LETTER_BODY, signedGeneral } from "./signed-fixtures";

/** P5: the flat-fee (general) letter end to end on the client page: steps 1 to 4 and the receipt, with an exhibit of matter, work and flat fee. */

const GENERAL: ApprovedLetter = { id: "22222222-2222-4222-8222-222222222222", kind: "general", version: 1, title: "Engagement letter", body: GENERAL_LETTER_BODY };
const TRADEMARK: ApprovedLetter = { ...GENERAL, id: "11111111-1111-4111-8111-111111111111", kind: "trademark" };

function render(over: Partial<ProposalDocumentProps> = {}) {
  const content = withLoeSnapshot(faithe(), GENERAL, true);
  return renderToStaticMarkup(
    <ProposalDocument
      content={content}
      title="Proposal"
      clientName="Faithe Williams"
      expiresOn="2026-12-01"
      firm={{ name: "RPB Law", slug: "rpb-law" }}
      mode="live"
      letter={{ dateText: "November 12, 2026", clientEmail: "faithe@example.com" }}
      onAccept={async () => ({ ok: true, payUrl: "https://example.com/pay" })}
      onDownloadReview={async () => ({ ok: false, message: "x" })}
      {...over}
    />,
  );
}
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the editor switch and the general kind", () => {
  it("the general template is attached to a flat-fee proposal and refused for a trademark one (kind mismatch removes `loe`)", () => {
    expect(withLoeSnapshot(faithe(), GENERAL, true).loe).toMatchObject({ kind: "general", template_version: 1, body: GENERAL_LETTER_BODY });
    expect(withLoeSnapshot(sevetri(), GENERAL, true).loe).toBeUndefined();
    expect(withLoeSnapshot(faithe(), TRADEMARK, true).loe).toBeUndefined();
  });

  it("the section's state for a flat-fee proposal reads the general letter's version", () => {
    const attached = withLoeSnapshot(faithe(), GENERAL, true).loe;
    const state = editorLetterState({ read: { status: "ok", letter: GENERAL }, attached });
    expect(state).toMatchObject({ state: "on", version: 1, newerAvailable: false });
  });
});

describe("the client steps for a signed-letter flat-fee proposal", () => {
  it("step 1 is the proposal with four steps and Continue; step 2 asks for details; step 3 shows the letter and an exhibit of matter, work and flat fee", () => {
    const one = render();
    expect(one).toContain(`>${CONTINUE_LABEL}</button>`);
    expect(count(one, '<li class="cp-step ')).toBe(4);
    expect(render({ initialLoe: { step: 2, details: TEST_DETAILS } })).toContain("Your details");

    const three = render({ initialLoe: { step: 3, details: { ...TEST_DETAILS, client_name: "Faithe Williams" } } });
    expect(three).toContain("Exhibit A: Fee Structure and Estimated Costs");
    expect(three).toContain("Management agreement: notice of non-renewal and termination");
    for (const work of ["Review both management agreements", "Review all correspondence and evidence", "Draft the notice of non-renewal and termination"]) expect(three).toContain(work);
    expect(three).toContain("Flat fee");
    expect(three).toContain("$500");
    expect(three).toContain("$1,250");
    expect(three).toContain("The flat fee in Exhibit A is due now.");
    expect(three).not.toMatch(/USPTO/);
    expect(count(three, 'class="cp-side"')).toBe(1);
  });

  it("the receipt after signing: signed line, the signed PDF, Read it again, Pay, and no USPTO anywhere", () => {
    const snapshot = signedGeneral();
    const signed = rebuildSignedLetter(snapshot, "America/New_York")!;
    const html = render({
      mode: "accepted",
      content: snapshot.content,
      initialSelection: snapshot.selection,
      acceptedQuote: snapshot.quote,
      payUrl: "https://example.com/pay",
      letter: { dateText: "November 12, 2026", clientEmail: "", signed },
      signedLine: signed.signedLine,
      onDownloadSigned: async () => ({ ok: false, message: "x" }),
      onDownloadReview: undefined,
      onAccept: undefined,
    });
    expect(html).toContain("Signed November 12, 2026 at 2:14 PM by Faithe Williams");
    expect(html).toContain(DOWNLOAD_SIGNED_LABEL);
    expect(html).toContain(`>${PAY_LABEL}</a>`);
    expect(html).toContain("Management agreement: notice of non-renewal and termination");
    expect(html).not.toMatch(/USPTO/);
  });
});
