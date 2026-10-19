import { describe, expect, it } from "vitest";
import { draftProposalFromConsult } from "@/lib/consult-proposal/draft";
import {
  DEFAULT_PROPOSAL_EMAIL_TEMPLATE,
  ProposalEmailError,
  buildReasoningBlock,
  isUsableEmailTemplate,
  proposalEmailSubject,
  renderProposalEmail,
  type RenderableProposalDraft,
} from "@/lib/consult-proposal/email";
import { fakeLlm } from "../agents/helpers";
import { draftInput, sevetriOutput } from "./fixture";

const URL = "https://proposals.rpblawfirm.com/prosperall-7f3k9q2m/";
const opts = { proposalUrl: URL, signOff: "The RPB Law Team" };

async function sevetriDraft(): Promise<RenderableProposalDraft> {
  const d = await draftProposalFromConsult(draftInput(fakeLlm(sevetriOutput()).llm));
  if (!d.ok) throw new Error(d.message);
  return d;
}

/** The whole email for the Sevetri call: Rebecca's template, her three reasoning paragraphs, the link, the second-mark sentence. */
const SEVETRI_BODY = `Hi Sevetri,

Thank you again for taking the time to meet with us for your strategy call. We truly enjoyed learning more about everything you are building, and as promised, I am following up with Rebecca's recommendations and your customized legal proposal.

As Rebecca discussed, generally speaking, securing both a word mark and a logo mark for each brand is best practice, as each provides a different layer of trademark protection.

Based on the preliminary search, Rebecca anticipates that securing a word mark registration for Tech4PublicGood may present some challenges. That said, if you are in a position to pursue both the word mark and logo mark, she believes it is worth considering both options to maximize your potential protection. Of course, once we complete the comprehensive trademark searches, we can reassess our strategy and pivot as necessary based on our findings.

With that in mind, we have included pricing for both word mark and logo mark applications in your proposal so you can evaluate all available options for each brand. If you prefer to move forward with only one application for Tech4PublicGood at this stage, Rebecca believes the logo mark may offer a stronger path toward registration. Ultimately, her goal is to position you and your brands for the best possible outcome.

You can review your full proposal here:
Sevetri Wilson Trademark Proposal
https://proposals.rpblawfirm.com/prosperall-7f3k9q2m/

Rebecca's recommended options have already been preselected for your convenience. However, the proposal is customizable, so you can adjust the marks and classes based on your priorities and budget. Please also note that when you elect to protect both the word mark and logo mark for the same brand, we offer a discounted rate for the second application.

Next Steps

Once you have reviewed the proposal and selected your preferred options, you can accept the proposal and submit payment directly through the link provided. Our team will then prepare your engagement agreement reflecting the services you selected and send it over for your review and signature.

If you have any questions about the proposal, our recommendations, or next steps, please don't hesitate to reach out. We look forward to the opportunity to work together and help protect the brands you are building!

Best,
The RPB Law Team`;

describe("renderProposalEmail", () => {
  it("renders the Sevetri email exactly", async () => {
    const { subject, body } = renderProposalEmail(await sevetriDraft(), opts);
    expect(subject).toBe("Your Trademark Proposal from RPB Law");
    expect(body).toBe(SEVETRI_BODY);
  });

  it("has no class numbers, no dollar amounts, no expiry date and no bare link", async () => {
    const { body } = renderProposalEmail(await sevetriDraft(), opts);
    expect(body).not.toMatch(/\b(?:IC\s*\d|international\s+class|class(?:es)?\s*\d)/i);
    expect(body).not.toContain("$");
    expect(body).not.toMatch(/\b20\d\d\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d/i);
    expect(body).not.toMatch(/expire|heads up/i);
    expect(body).not.toContain("claude.ai");
    const lines = body.split("\n");
    const at = lines.indexOf(URL);
    expect(lines[at - 1]).toBe("Sevetri Wilson Trademark Proposal");
  });

  it("drops the reasoning paragraph cleanly when nothing applies", async () => {
    const d = await sevetriDraft();
    const { body } = renderProposalEmail({ ...d, email: { ...d.email, reasoning: null } }, opts);
    expect(body).toContain("customized legal proposal.\n\nYou can review your full proposal here:");
    expect(body).not.toMatch(/\n{3,}/);
  });

  it("drops the second-mark sentence when no brand offers both marks, or the firm gives no discount", async () => {
    const d = await sevetriDraft();
    const oneMark = {
      ...d,
      content: { ...d.content, names: d.content.names.map((n) => ({ ...n, marks: n.marks.filter((m) => m.kind === "logo") })) },
    };
    const a = renderProposalEmail(oneMark, opts).body;
    expect(a).toContain("based on your priorities and budget.\n\nNext Steps");
    expect(a).not.toContain("discounted rate");
    const noDiscount = { ...d, content: { ...d.content, pricing: { ...d.content.pricing, second_mark_discount_pct: 0 } } };
    expect(renderProposalEmail(noDiscount, opts).body).not.toContain("discounted rate");
  });

  it("uses a placeholder, never a guess, when the first name is missing", async () => {
    const d = await sevetriDraft();
    const body = renderProposalEmail({ ...d, content: { ...d.content, client: { ...d.content.client, first_name: " " } } }, opts).body;
    expect(body.startsWith("Hi [First name],\n")).toBe(true);
  });

  it("refuses a claude.ai link, a non-https link and an empty sign-off", async () => {
    const d = await sevetriDraft();
    expect(() => renderProposalEmail(d, { ...opts, proposalUrl: "https://claude.ai/artifact/abc" })).toThrow(ProposalEmailError);
    expect(() => renderProposalEmail(d, { ...opts, proposalUrl: "http://proposals.rpblawfirm.com/x/" })).toThrow(/https/);
    expect(() => renderProposalEmail(d, { ...opts, proposalUrl: "not a url" })).toThrow(ProposalEmailError);
    expect(() => renderProposalEmail(d, { ...opts, signOff: "  " })).toThrow(/sign-off/);
    expect(renderProposalEmail(d, { ...opts, proposalUrl: "http://localhost:3000/p/tok/" }).body).toContain("http://localhost:3000/p/tok/");
  });

  it("uses a firm's own template when it carries the link and sign-off, else Rebecca's", async () => {
    const d = await sevetriDraft();
    const custom = "Dear {first_name},\n\n{reasoning}\n\n{proposal_title}\n{proposal_url}\n\n{unknown_slot}\n\n{sign_off}";
    const body = renderProposalEmail(d, { ...opts, template: custom }).body;
    expect(body.startsWith("Dear Sevetri,\n\nAs Rebecca discussed")).toBe(true);
    expect(body).toContain("{unknown_slot}");
    expect(isUsableEmailTemplate("Hi {first_name}, no link here. {sign_off}")).toBe(false);
    expect(renderProposalEmail(d, { ...opts, template: "Hi {first_name}, no link. {sign_off}" }).body).toBe(SEVETRI_BODY);
    expect(renderProposalEmail(d, { ...opts, template: null }).body).toBe(SEVETRI_BODY);
  });

  it("never substitutes twice (a value containing a slot stays literal)", async () => {
    const d = await sevetriDraft();
    const body = renderProposalEmail({ ...d, content: { ...d.content, client: { ...d.content.client, first_name: "{proposal_url}" } } }, opts).body;
    expect(body.startsWith("Hi {proposal_url},")).toBe(true);
  });
});

describe("pieces", () => {
  it("the default template carries every slot once", () => {
    for (const slot of ["first_name", "reasoning", "proposal_title", "proposal_url", "second_mark_sentence", "sign_off"]) {
      expect(DEFAULT_PROPOSAL_EMAIL_TEMPLATE.split(`{${slot}}`)).toHaveLength(2);
    }
  });

  it("assembles the reasoning block from Rebecca's paragraphs only", () => {
    expect(buildReasoningBlock({ principle: false, riskBrand: null, fallbackBrand: null })).toBeNull();
    expect(buildReasoningBlock({ principle: true, riskBrand: null, fallbackBrand: null })).toBe(
      "As Rebecca discussed, generally speaking, securing both a word mark and a logo mark for each brand is best practice, as each provides a different layer of trademark protection.",
    );
    const two = buildReasoningBlock({ principle: false, riskBrand: "Acme", fallbackBrand: "Acme" })!;
    expect(two.split("\n\n")).toHaveLength(2);
    expect(two).toContain("securing a word mark registration for Acme may present some challenges");
    expect(two).toContain("only one application for Acme at this stage");
  });

  it("the subject is firm-name driven", () => {
    expect(proposalEmailSubject("RPB Law")).toBe("Your Trademark Proposal from RPB Law");
    expect(proposalEmailSubject("  ")).toBe("Your Trademark Proposal");
  });
});
