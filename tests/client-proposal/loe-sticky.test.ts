import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument } from "@/components/client-proposal/ProposalDocument";
import { TEST_DETAILS } from "../loe/full-letter-fixture";
import { twoBrandPerMark, withLoe } from "../loe/loe-fixtures";

/**
 * The totals panel (.cp-side) sticks on every step. `position: sticky` silently stops working when ANY ancestor has overflow
 * hidden, auto or scroll (overflow: clip is allowed). The mockup had exactly that bug. This test finds the panel's real ancestors
 * in the rendered markup of every step and checks every CSS rule that could apply to them, in the proposal's own CSS and the
 * app's global CSS. (tests/client-proposal/loe-sticky.test.ts; the Playwright scroll check is described in the sprint handoff.)
 */

const root = process.cwd();
const PROPOSAL_CSS = readFileSync(join(root, "src/components/client-proposal/proposal.css"), "utf8");
const GLOBAL_CSS = readFileSync(join(root, "src/app/globals.css"), "utf8");

type Rule = { selector: string; body: string };

function rulesOf(css: string): Rule[] {
  const out: Rule[] = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of m[1].split(",")) out.push({ selector: selector.trim(), body: m[2] });
  }
  return out;
}

const VOID = new Set(["img", "input", "br", "hr", "link", "meta", "source", "area", "base", "col", "embed", "track", "wbr"]);

/** The open elements around the first `<aside class="cp-side"`: tag and class list of each ancestor, outermost first. */
function ancestorsOfSide(html: string): Array<{ tag: string; classes: string[] }> {
  const stack: Array<{ tag: string; classes: string[] }> = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    const [, close, tag, attrs] = m;
    const name = tag.toLowerCase();
    if (!close) {
      const cls = /class="([^"]*)"/.exec(attrs)?.[1].split(/\s+/).filter(Boolean) ?? [];
      if (name === "aside" && cls.includes("cp-side")) return [...stack];
      if (!VOID.has(name) && !attrs.trimEnd().endsWith("/")) stack.push({ tag: name, classes: cls });
    } else {
      const at = stack.map((s) => s.tag).lastIndexOf(name);
      if (at >= 0) stack.length = at;
    }
  }
  throw new Error("no .cp-side in the markup");
}

function render(step: 1 | 2 | 3) {
  return renderToStaticMarkup(
    createElement(ProposalDocument, {
      content: withLoe(twoBrandPerMark()),
      title: "Trademark Proposal",
      clientName: "Sevetri Wilson",
      expiresOn: null,
      firm: { name: "RPB Law", slug: "rpb-law" },
      mode: "live",
      letter: { dateText: "November 12, 2026", clientEmail: "sevetri@example.com" },
      initialLoe: { step, details: TEST_DETAILS },
    }),
  );
}

function appliesTo(selector: string, el: { tag: string; classes: string[] }): boolean {
  const last = selector.split(/[\s>+~]+/).filter(Boolean).pop() ?? "";
  const tag = /^[a-zA-Z][a-zA-Z0-9]*/.exec(last)?.[0];
  const classes = [...last.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
  if (!tag && classes.length === 0) return false;
  if (tag && tag.toLowerCase() !== el.tag) return false;
  return classes.every((c) => el.classes.includes(c));
}

describe("the totals panel stays sticky on every step", () => {
  for (const step of [1, 2, 3] as const) {
    it(`step ${step}: no ancestor of .cp-side scrolls or clips with overflow hidden, auto or scroll`, () => {
      const ancestors = [{ tag: "body", classes: [] as string[] }, { tag: "html", classes: [] as string[] }, ...ancestorsOfSide(render(step))];
      // The letter's own scrolling box must not be an ancestor of the panel.
      expect(ancestors.some((a) => a.classes.includes("cp-letter"))).toBe(false);
      expect(ancestors.map((a) => a.classes.join(" ")).join("|")).toContain("cp-layout");
      const offenders: string[] = [];
      for (const rule of [...rulesOf(PROPOSAL_CSS), ...rulesOf(GLOBAL_CSS)]) {
        const declared = [...rule.body.matchAll(/(?:^|;)\s*(overflow(?:-x|-y)?)\s*:\s*([^;]+)/g)];
        for (const [, prop, value] of declared) {
          if (!/\b(hidden|auto|scroll)\b/.test(value)) continue;
          if (ancestors.some((a) => appliesTo(rule.selector, a))) offenders.push(`${rule.selector} { ${prop}: ${value.trim()} }`);
        }
      }
      expect(offenders).toEqual([]);
    });
  }

  it("the panel is position: sticky with a top offset on a wide page, and static where the page is one column", () => {
    const rules = rulesOf(PROPOSAL_CSS).filter((r) => r.selector === ".cp-side");
    const sticky = rules.find((r) => /position:\s*sticky/.test(r.body));
    expect(sticky?.body).toMatch(/top:\s*\d+px/);
    expect(rules.some((r) => /position:\s*static/.test(r.body))).toBe(true);
    // The grid item stays at the top of its row so the panel has a column's height to travel along.
    expect(rulesOf(PROPOSAL_CSS).find((r) => r.selector === ".cp-layout")?.body).toMatch(/align-items:\s*start/);
  });

  it("the phone total bar is drawn on every step", () => {
    for (const step of [1, 2, 3] as const) expect(render(step)).toContain('class="cp-bar"');
  });

  it("the letter scrolls inside its own box (overflow lives on .cp-letter, a sibling branch of the panel)", () => {
    const letter = rulesOf(PROPOSAL_CSS).find((r) => r.selector === ".cp-letter");
    expect(letter?.body).toMatch(/overflow-y:\s*auto/);
    expect(letter?.body).toMatch(/max-height:\s*\d+px/);
  });
});
