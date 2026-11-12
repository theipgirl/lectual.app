import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { quoteProposal, defaultSelection } from "@/lib/proposals/pricing";
import { quoteWithClientClasses, emptyClientClassInput } from "@/lib/proposals/client-classes";
import { validateContent } from "@/lib/proposals/validate";
import type { ProposalContent, Selection } from "@/lib/proposals/types";
import { faithe } from "./general-fixture";
import { sevetri } from "./fixture";
import { danielle } from "./danielle-fixture";

/**
 * The engagement letter adds a `loe` key and nothing else. The fixtures for Sevetri (two marks, a package per
 * mark in the mark fixture), Danielle (a package per brand) and Faithe (flat fee) must validate and quote exactly
 * as they did at the commit this sprint branched from, and `pricing.ts` must have no diff since then.
 */

const BASE = "bae91fc";
const show = (path: string): string | null => {
  try {
    return execSync(`git show ${BASE}:${path}`, { stdio: ["ignore", "pipe", "ignore"] }).toString();
  } catch {
    return null;
  }
};
const oldPricing = show("src/lib/proposals/pricing.ts");
const oldValidate = show("src/lib/proposals/validate.ts");
const have = oldPricing !== null && oldValidate !== null;

const FIXTURES: Array<[string, () => ProposalContent]> = [
  ["sevetri", sevetri],
  ["danielle", danielle],
  ["faithe", faithe],
];

describe("fixtures validate and quote as before the engagement letter", () => {
  it.skipIf(!have)("validateContent issues and quotes are identical to the pre-sprint engine", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loe-before-"));
    const pricingFile = join(dir, "pricing-before.ts");
    const validateFile = join(dir, "validate-before.ts");
    // The old modules import their neighbours relatively; point those at the current (unchanged) files.
    const absolute = (src: string) => src.replace(/from "\.\/([\w-]+)"/g, 'from "@/lib/proposals/$1"');
    writeFileSync(pricingFile, absolute(oldPricing!));
    writeFileSync(validateFile, absolute(oldValidate!));
    const beforePricing = (await import(/* @vite-ignore */ pricingFile)) as typeof import("@/lib/proposals/pricing");
    const beforeValidate = (await import(/* @vite-ignore */ validateFile)) as typeof import("@/lib/proposals/validate");

    const options = { forApproval: true, expires_on: "2026-12-01", pay_url: "https://pay.example.com/x", client_email: "c@example.com", title: "Trademark Proposal" };
    for (const [name, make] of FIXTURES) {
      const content = make();
      for (const opts of [{}, options]) {
        expect(JSON.stringify(validateContent(content, opts)), `${name} validate`).toBe(JSON.stringify(beforeValidate.validateContent(content, opts)));
      }
      const selection: Selection = beforePricing.defaultSelection(content);
      expect(JSON.stringify(defaultSelection(content)), `${name} default selection`).toBe(JSON.stringify(selection));
      expect(JSON.stringify(quoteProposal(content, selection)), `${name} quote`).toBe(JSON.stringify(beforePricing.quoteProposal(content, selection)));
      const viaClasses = quoteWithClientClasses(content, selection, emptyClientClassInput());
      expect(viaClasses.ok, `${name} priced`).toBe(true);
      if (!viaClasses.ok) continue;
      expect(JSON.stringify(viaClasses.quote), `${name} quote with client classes`).toBe(JSON.stringify(beforePricing.quoteProposal(content, selection)));
    }
  });

  it.skipIf(!have)("pricing.ts has no diff since the commit this sprint branched from", () => {
    const diff = execSync(`git diff ${BASE} -- src/lib/proposals/pricing.ts`, { stdio: ["ignore", "pipe", "ignore"] }).toString();
    expect(diff).toBe("");
  });
});
