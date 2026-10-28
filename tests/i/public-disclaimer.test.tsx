import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NOT_A_LAW_FIRM_DISCLAIMER } from "@/lib/legal/disclaimer";
import { defaultIntakeConfig, publicConfig } from "@/lib/intake-forms/config";
import { ClosedIntakeNotice, IntakeNotice } from "../../src/app/i/[slug]/_components/IntakeShell";

vi.mock("../../src/app/i/[slug]/actions", () => ({
  startIntakeAction: vi.fn(),
  submitIntakeAction: vi.fn(),
  completeAssessmentAction: vi.fn(),
  recordIntakeEventAction: vi.fn(),
  recordIntakeStepAction: vi.fn(),
}));

/**
 * Sprint 36 12.11 and 12.13: the not-a-law-firm line stays, verbatim, on every public state, as small print
 * AFTER the firm's content, and the small print is at least 13.5px.
 */

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
const view = publicConfig(defaultIntakeConfig(), { orgName: "Hartwell IP", receivesReferrals: false });

describe("the disclaimer on every public state", () => {
  it("is after the headline on a live form", async () => {
    const { PublicIntake } = await import("../../src/app/i/[slug]/_components/PublicIntake");
    const html = text(renderToStaticMarkup(<PublicIntake slug="ugw-2026" view={view} packages={[]} stamp="s" embed={false} />));
    expect(html).toContain(NOT_A_LAW_FIRM_DISCLAIMER);
    expect(html.indexOf(view.headline)).toBeGreaterThan(-1);
    expect(html.indexOf(view.headline)).toBeLessThan(html.indexOf(NOT_A_LAW_FIRM_DISCLAIMER));
    expect(html.indexOf(view.consent)).toBeLessThan(html.indexOf(NOT_A_LAW_FIRM_DISCLAIMER));
  });

  it("is after the headline on a live form in an embed", async () => {
    const { PublicIntake } = await import("../../src/app/i/[slug]/_components/PublicIntake");
    const html = text(renderToStaticMarkup(<PublicIntake slug="ugw-2026" view={view} packages={[]} stamp="s" embed utm={{ source: "ig" }} />));
    expect(html.indexOf(view.headline)).toBeLessThan(html.indexOf(NOT_A_LAW_FIRM_DISCLAIMER));
  });

  it("is after the content on an assessment", async () => {
    const { PublicAssessment } = await import("../../src/app/i/[slug]/_components/PublicAssessment");
    const html = text(renderToStaticMarkup(<PublicAssessment slug="booth" view={view} stamp="s" embed={false} />));
    expect(html).toContain(NOT_A_LAW_FIRM_DISCLAIMER);
    expect(html.indexOf(view.headline)).toBeLessThan(html.indexOf(NOT_A_LAW_FIRM_DISCLAIMER));
  });

  it("is after the message on not-found and unavailable", () => {
    for (const title of ["This intake isn't available", "We can't load this intake right now"]) {
      const html = text(renderToStaticMarkup(<IntakeNotice title={title} body="Try later." />));
      expect(html).toContain(NOT_A_LAW_FIRM_DISCLAIMER);
      expect(html.indexOf(title)).toBeLessThan(html.indexOf(NOT_A_LAW_FIRM_DISCLAIMER));
    }
  });

  it("is after the message on a closed link", () => {
    const html = text(renderToStaticMarkup(<ClosedIntakeNotice firmName="Hartwell IP" contactSlug="main-intake" />));
    expect(html).toContain(NOT_A_LAW_FIRM_DISCLAIMER);
    expect(html.indexOf("This form has closed.")).toBeLessThan(html.indexOf(NOT_A_LAW_FIRM_DISCLAIMER));
  });

  it("is rendered after the frame in the component, so the thank-you state carries it too", () => {
    for (const f of ["PublicIntake", "PublicAssessment"]) {
      const src = readFileSync(`src/app/i/[slug]/_components/${f}.tsx`, "utf8");
      expect(src.lastIndexOf("<IntakeDisclaimer")).toBeGreaterThan(src.lastIndexOf('<div className="ipub-frame">'));
    }
  });

  it("is not edited: the constant is the one the whole app uses", () => {
    expect(NOT_A_LAW_FIRM_DISCLAIMER).toBe("Lectual / Oath Innovation Inc is not a law firm and does not provide legal advice. We provide software and document-preparation services.");
  });
});

describe("the closed link", () => {
  it("offers 'Get in touch with <firm>' to the firm's live intake, else says to contact the firm directly", () => {
    const withLink = renderToStaticMarkup(<ClosedIntakeNotice firmName="Hartwell IP" contactSlug="main-intake" />);
    expect(withLink).toContain("Get in touch with Hartwell IP");
    expect(withLink).toContain('href="/i/main-intake/"');
    const without = renderToStaticMarkup(<ClosedIntakeNotice firmName="Hartwell IP" contactSlug={null} />);
    expect(without).toContain("Please contact Hartwell IP directly.");
    expect(without).not.toContain("<a ");
  });
});

describe("small print size (12.13)", () => {
  const css = readFileSync("src/app/i/intake-public.css", "utf8");
  const sizeOf = (selector: string) => {
    const block = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.\s]/g, (m) => `\\${m === " " ? "s" : m}`)}\\s*\\{([^}]*)\\}`));
    const px = block?.[1].match(/font-size:\s*([\d.]+)px/)?.[1];
    return px ? Number(px) : null;
  };
  it("is at least 13.5px for the disclaimer (base, frame and embed rules), the consent and the notes", () => {
    expect(sizeOf(".ipub-upl")).toBeGreaterThanOrEqual(13.5);
    expect(sizeOf(".ipub-frame .ipub-upl")).toBeGreaterThanOrEqual(13.5);
    expect(sizeOf(".ipub.embed .ipub-upl")).toBeGreaterThanOrEqual(13.5);
    expect(sizeOf(".ipub-consent")).toBeGreaterThanOrEqual(13.5);
    expect(sizeOf(".ipub-small")).toBeGreaterThanOrEqual(13.5);
  });
  it("stays muted", () => {
    expect(css.match(/\.ipub-upl \{[^}]*\}/)?.[0]).toContain("var(--ipub-mute)");
  });
});
