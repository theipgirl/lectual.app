import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { LoeDetailsForm } from "@/components/client-proposal/LoeDetailsForm";
import { LoeSignPanel } from "@/components/client-proposal/LoeSignPanel";
import { LoeSideAction, type LoeSideActionProps } from "@/components/client-proposal/LoeSideAction";
import { ProposalDocument } from "@/components/client-proposal/ProposalDocument";
import { money } from "@/components/client-proposal/format";
import { SIGN_AGREE_LABEL, SIGN_NAME_LABEL, SIGN_REQUIRED_NOTE } from "@/lib/loe/client-words";
import { US_STATES } from "@/lib/loe/us-states";
import { buildExhibit, exhibitLines } from "@/lib/loe/exhibit";
import { addressBlock, addressJson, agreementText, canSign, checkSigning, emptyDetails, pageAgreement, type SignerDetails } from "@/lib/loe/signing";
import { quoteWithClientClasses } from "@/lib/proposals/client-classes";
import { defaultSelection } from "@/lib/proposals/pricing";
import { TEST_DETAILS, fullLetterBody } from "../loe/full-letter-fixture";
import { twoBrandPerMark, withLoe } from "../loe/loe-fixtures";

const noop = () => {};

function details(d: SignerDetails, over: { readOnly?: boolean } = {}) {
  return renderToStaticMarkup(<LoeDetailsForm details={d} onChange={noop} {...over} />);
}

/** Every <input ...> / <select ...> start tag in the markup. */
const tags = (html: string, tag: "input" | "select") => html.match(new RegExp(`<${tag}\\b[^>]*>`, "g")) ?? [];
const tagNamed = (html: string, name: string) => [...tags(html, "input"), ...tags(html, "select")].find((t) => t.includes(`name="${name}"`)) ?? "";

describe("step 2 is a real address form", () => {
  const us = details(TEST_DETAILS);
  const abroad = details({ ...TEST_DETAILS, region: "Ontario", postal: "M5V 2T6", country: "Canada" });

  it("groups the address under a fieldset with a legend", () => {
    expect(us).toContain('<fieldset class="cp-address"><legend>Address</legend>');
    expect(us).toContain("</fieldset>");
  });

  it("every input carries the right autocomplete token and the same name", () => {
    const tokens = ["name", "organization", "organization-title", "address-line1", "address-line2", "address-level2", "address-level1", "postal-code", "country-name"];
    for (const t of tokens) {
      const tag = tagNamed(us, t);
      expect(tag, t).toContain(`autoComplete="${t}"`);
    }
  });

  it("marks the required fields (asterisk, required, aria-required) and leaves the three optional ones unmarked", () => {
    for (const t of ["name", "address-line1", "address-level2", "address-level1", "postal-code", "country-name"]) {
      const tag = tagNamed(us, t);
      expect(tag, t).toContain("required");
      expect(tag, t).toContain('aria-required="true"');
    }
    for (const t of ["organization", "organization-title", "address-line2"]) expect(tagNamed(us, t), t).not.toContain("required");
    expect(us.match(/<b aria-hidden="true"> \*<\/b>/g)).toHaveLength(6);
  });

  it("US: State is a select of 59 entries, labelled with the full name and the code, valued by the code; ZIP is numeric", () => {
    const sel = us.match(/<select\b[\s\S]*?<\/select>/)?.[0] ?? "";
    expect(sel).toContain('name="address-level1"');
    expect((sel.match(/<option value="[A-Z]{2}"/g) ?? []).length).toBe(US_STATES.length);
    expect(sel).toContain('<option value="FL" selected="">Florida (FL)</option>');
    expect(sel).toContain('<option value="PR">Puerto Rico (PR)</option>');
    expect(sel).toContain('<option value="DC">District of Columbia (DC)</option>');
    expect(tagNamed(us, "postal-code")).toContain('inputMode="numeric"');
    expect(us).toContain("<span>State<b");
  });

  it("another country: State is a free text field with its own label, and ZIP is not forced numeric", () => {
    expect(abroad).not.toContain("<select");
    expect(tagNamed(abroad, "address-level1")).toContain('type="text"');
    expect(tagNamed(abroad, "address-level1")).toContain('value="Ontario"');
    expect(abroad).toContain("State, province or region");
    expect(tagNamed(abroad, "postal-code")).not.toContain("inputMode");
  });

  it("a stored full state name is kept visible rather than dropped", () => {
    const html = details({ ...TEST_DETAILS, region: "Florida" });
    expect(html).toContain('<option value="FL" selected="">Florida (FL)</option>');
  });

  it("lays the address out as street, apartment, city/state/ZIP, country (one column on a phone)", () => {
    const order = ["address-line1", "address-line2", "address-level2", "address-level1", "postal-code", "country-name"].map((n) => us.indexOf(`name="${n}"`));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const css = readFileSync("src/components/client-proposal/proposal.css", "utf8");
    expect(css).toMatch(/\.cp-addr-street, \.cp-addr-street2, \.cp-addr-country \{ grid-column: 1 \/ -1; \}/);
    expect(css).toMatch(/@container cp \(max-width: 640px\)[\s\S]*\.cp-addr-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  });
});

describe("the stored values and the agreement are unchanged", () => {
  const filled: SignerDetails = { ...emptyDetails(), client_name: "Sevetri Wilson", street: "123 Main St", street2: "Suite 4", city: "Miami", region: "FL", postal: "33101", country: "United States" };
  it("the same values give the same address block and address json as before", () => {
    expect(addressBlock(filled)).toBe("123 Main St\nSuite 4\nMiami, FL 33101\nUnited States");
    expect(addressJson(filled)).toEqual({ street: "123 Main St", street2: "Suite 4", city: "Miami", region: "FL", postal: "33101", country: "United States" });
  });
  it("a state typed as free text and the same code picked from the list agree", () => {
    const a = pageAgreement({ body: fullLetterBody(), details: { ...filled, region: "FL" }, typedName: "Sevetri Wilson", dateText: "November 12, 2026", clientEmail: "s@example.com", exhibit: exhibitFor() });
    expect(a?.text).toContain("Miami, FL 33101\nUnited States");
  });
  it("the required rule is exactly as it was", () => {
    expect(canSign({ typedName: "Sevetri Wilson", agree: true, details: filled })).toBe(true);
    expect(canSign({ typedName: "Sevetri Wilson", agree: true, details: { ...filled, region: "" } })).toBe(false);
  });
});

describe("step 3: both fields are plainly required", () => {
  const panel = renderToStaticMarkup(<LoeSignPanel typedName="" onName={noop} onAgree={noop} agree={false} />);
  it("marks the name and the tick with an asterisk, required and aria-required", () => {
    expect(panel).toContain(`${SIGN_NAME_LABEL}<b aria-hidden="true"> *</b>`);
    expect(panel).toContain(`${SIGN_AGREE_LABEL}<b aria-hidden="true"> *</b>`);
    for (const tag of [tagNamed(panel, "typed_name"), tagNamed(panel, "agree")]) {
      expect(tag).toContain("required");
      expect(tag).toContain('aria-required="true"');
    }
  });

  const base: LoeSideActionProps = {
    mode: "live", step: 3, accepted: false, firstName: "Sevetri", signedLine: null, payUrl: null, opened: false, canContinue: true, detailsOk: true,
    signable: false, pending: false, error: null, legalTotalText: "$4,075", onContinue: noop, onBack: noop, onSign: noop, onReadLetter: noop,
  };
  it("the sign button is disabled and described by the reason until a name is typed and the box ticked", () => {
    const html = renderToStaticMarkup(<LoeSideAction {...base} />);
    const btn = html.match(/<button[^>]*>Sign and continue to payment<\/button>/)?.[0] ?? "";
    expect(btn).toContain("disabled");
    expect(btn).toContain('aria-describedby="cp-sign-need"');
    expect(html).toContain(`id="cp-sign-need"`);
    expect(html).toContain("Type your full legal name and tick the box to sign.");
    expect(SIGN_REQUIRED_NOTE).toBe("Type your full legal name and tick the box to sign.");
  });
  it("once signable the button is enabled and the reason is gone", () => {
    const html = renderToStaticMarkup(<LoeSideAction {...base} signable />);
    const btn = html.match(/<button[^>]*>Sign and continue to payment<\/button>/)?.[0] ?? "";
    expect(btn).not.toContain("disabled");
    expect(btn).not.toContain("aria-describedby");
    expect(html).not.toContain("cp-sign-need");
  });
  it("the page's canSign needs a typed name that is non-empty after cleaning, and the tick", () => {
    for (const name of ["", "   ", "\t", "<>"]) expect(canSign({ typedName: name, agree: true, details: TEST_DETAILS }), JSON.stringify(name)).toBe(false);
    expect(canSign({ typedName: "Sevetri Wilson", agree: false, details: TEST_DETAILS })).toBe(false);
    expect(canSign({ typedName: "Sevetri Wilson", agree: true, details: TEST_DETAILS })).toBe(true);
  });
  it("the server still refuses a missing name or tick", () => {
    expect(checkSigning({ typedName: "   ", agree: true, details: TEST_DETAILS })).toEqual({ ok: false, reason: "name_required" });
    expect(checkSigning({ typedName: "Sevetri Wilson", agree: false, details: TEST_DETAILS })).toEqual({ ok: false, reason: "agree_required" });
    expect(checkSigning({ typedName: "Sevetri Wilson", agree: "yes", details: TEST_DETAILS })).toEqual({ ok: false, reason: "agree_required" });
  });
});

function exhibitFor() {
  const content = withLoe(twoBrandPerMark());
  const selection = defaultSelection(content);
  const r = quoteWithClientClasses(content, selection, { entries: {}, added: {} }, { repair: true });
  if (!r.ok) throw new Error("no quote");
  return buildExhibit(r.content, r.quote, money);
}

describe("the brand name in quotation marks is display only", () => {
  const html = renderToStaticMarkup(
    <ProposalDocument
      content={withLoe(twoBrandPerMark())}
      title="Trademark Proposal"
      clientName="Sevetri Wilson"
      expiresOn="2026-12-01"
      firm={{ name: "RPB Law", slug: "rpb-law" }}
      mode="live"
      letter={{ dateText: "November 12, 2026", clientEmail: "s@example.com" }}
      onAccept={async () => ({ ok: true, payUrl: "https://example.com/pay" })}
    />,
  );
  it("step 1 shows the quoted name in the card heading and the review line", () => {
    expect(html).toContain("“The Fold”</h3>");
    expect(html).toContain("<h3>“The Fold” —");
  });
  it("Exhibit A and the agreement text keep the plain name, byte for byte", () => {
    const exhibit = exhibitFor();
    const lines = exhibitLines(exhibit).join("\n");
    expect(lines).toContain("The Fold");
    expect(lines).not.toMatch(/[“”]/);
    expect(exhibit.groups.map((g) => g.title)).toEqual(["The Fold", "The Confidence Interval"]);
    const a = pageAgreement({ body: fullLetterBody(), details: TEST_DETAILS, typedName: "Sevetri Wilson", dateText: "November 12, 2026", clientEmail: "s@example.com", exhibit });
    expect(a).not.toBeNull();
    expect(a!.text).toBe(agreementText(a!.blocks, exhibit));
    // Pinned: a change to the words of a signed letter would break the rebuild check on letters already signed.
    expect(createHash("sha256").update(a!.text).digest("hex")).toBe(PINNED_SHA);
  });
});

const PINNED_SHA = "e5b347f500bb408ec8a1567b25de88ed6f875892ca501eba08c24c3c162dff2b";
