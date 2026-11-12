import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { publicContent } from "@/lib/proposals/public";
import { validateContent } from "@/lib/proposals/validate";
import { madeByLine } from "@/lib/proposals/made-by";
import { MadeByLine } from "@/components/proposal-editor/MadeByLine";
import { MADE_BY_VALUES, type ProposalContent } from "@/lib/proposals/types";
import { sevetri } from "./fixture";

/** Sprint 3 F6 and F8: who made a proposal, staff-only. */

const withMade = (over: Record<string, unknown>) => ({ ...sevetri(), ...over }) as ProposalContent;
const errorsOf = (c: unknown) => validateContent(c).filter((i) => i.level === "error");

describe("F6: made_by is accepted, checked, and never published", () => {
  it.each(MADE_BY_VALUES)("publicContent never returns made_by or made_from (%s)", (who) => {
    const out = publicContent(withMade({ made_by: who, made_from: { consult_date: "2026-11-10" } }));
    expect(out).not.toHaveProperty("made_by");
    expect(out).not.toHaveProperty("made_from");
    expect(JSON.stringify(out)).not.toContain("made_");
    expect(JSON.stringify(out)).not.toContain("2026-11-10");
  });

  it.each(MADE_BY_VALUES)("validateContent accepts %s", (who) => {
    expect(errorsOf(withMade({ made_by: who }))).toEqual([]);
  });

  it("validateContent refuses made_by 'robot' and any non-string value", () => {
    expect(errorsOf(withMade({ made_by: "robot" })).map((i) => i.path)).toContain("made_by");
    expect(errorsOf(withMade({ made_by: 3 })).map((i) => i.path)).toContain("made_by");
    expect(errorsOf(withMade({ made_by: null })).map((i) => i.path)).toContain("made_by");
  });

  it("a made_from that isn't a real civil date is refused; a real one is accepted", () => {
    expect(errorsOf(withMade({ made_by: "assistant", made_from: { consult_date: "Nov 10" } })).map((i) => i.path)).toContain("made_from");
    expect(errorsOf(withMade({ made_by: "assistant", made_from: { consult_date: "2026-02-31" } })).map((i) => i.path)).toContain("made_from");
    expect(errorsOf(withMade({ made_by: "assistant", made_from: "2026-11-10" })).map((i) => i.path)).toContain("made_from");
    expect(errorsOf(withMade({ made_by: "assistant", made_from: { consult_date: "2026-11-10" } }))).toEqual([]);
  });

  it("an older proposal with neither key still validates", () => {
    expect(errorsOf(sevetri())).toEqual([]);
  });
});

describe("F8: the editor header's line", () => {
  it("an assistant draft with a consult date reads 'Made by the assistant from the Nov 10 consult'", () => {
    const html = renderToStaticMarkup(createElement(MadeByLine, { content: withMade({ made_by: "assistant", made_from: { consult_date: "2026-11-10" } }) }));
    expect(html).toContain("Made by the assistant from the Nov 10 consult");
  });

  it("copilot reads 'Made with Copilot'", () => {
    expect(renderToStaticMarkup(createElement(MadeByLine, { content: withMade({ made_by: "copilot" }) }))).toContain("Made with Copilot");
  });

  it("a person's draft and an older proposal render no such line", () => {
    for (const content of [withMade({ made_by: "person" }), withMade({}), withMade({ made_from: { consult_date: "2026-11-10" } })]) {
      expect(renderToStaticMarkup(createElement(MadeByLine, { content }))).toBe("");
      expect(madeByLine(content)).toBeNull();
    }
  });

  it("an assistant draft with no consult date says only 'Made by the assistant'", () => {
    expect(madeByLine(withMade({ made_by: "assistant" }))).toBe("Made by the assistant");
  });

  it("the proposal page's header draws the line from the content", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/app/dashboard/proposals/[id]/page.tsx", "utf8");
    expect(page).toContain("<MadeByLine content={content} />");
  });
});
