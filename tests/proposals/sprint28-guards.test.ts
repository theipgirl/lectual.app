import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Sprint 28 source guards: one price calculation, nothing money-shaped from the browser, no new admin client, no raw HTML. */

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}
const read = (p: string) => readFileSync(p, "utf8");

describe("one price calculation", () => {
  it("per-class and USPTO cents are multiplied only inside pricing.ts", () => {
    // loe-adapter only CHECKS that the stored USPTO total equals per-class x classes before printing "$700 ($350 x 2 classes)"; it prices nothing.
    const allowed = ["src/lib/proposals/pricing.ts", "src/lib/proposals/loe-adapter.ts"];
    const hits = walk("src").filter((f) => !allowed.includes(f) && /(?:per_class_cents|perClassCents|gov_per_class_cents|govPerClassCents)\s*\*|\*\s*(?:pricing\.)?(?:per_class_cents|perClassCents|gov_per_class_cents|govPerClassCents)/.test(read(f)));
    expect(hits).toEqual([]);
  });

  it("the page and the accept path both price through quoteWithClientClasses (Spec 3's one effective-content builder)", () => {
    expect(read("src/components/client-proposal/ProposalDocument.tsx")).toContain("quoteWithClientClasses(");
    expect(read("src/lib/proposals/public.ts")).toContain("quoteWithClientClasses(");
    expect(read("src/lib/proposals/client-classes.ts")).toContain("quoteProposal(");
  });
});

describe("nothing money-shaped is read from the browser in the accept action", () => {
  it("acceptProposalAction takes the token, the ticks and what the client wrote only", () => {
    const src = read("src/app/p/[token]/actions.ts");
    expect(src).toMatch(/acceptProposalAction\(token: string, selection: unknown, clientClasses\?: unknown\)/);
    expect((src.split("export async function")[1] ?? "").match(/price|total|cents|classCount/i)).toBeNull();
  });

  it("acceptPublicProposal's signature has no money parameter", () => {
    const src = read("src/lib/proposals/public.ts");
    const sig = src.slice(src.indexOf("export async function acceptPublicProposal("), src.indexOf("): Promise<AcceptResult>"));
    expect(sig.replace(/clientClasses/g, "").match(/price|total|cents|class_?count/i)).toBeNull();
  });
});

describe("client-added text", () => {
  it("is never logged by the modules that handle it", () => {
    for (const f of ["src/lib/proposals/client-classes.ts", "src/lib/proposals/class-lock.ts", "src/lib/proposals/added-view.ts", "src/lib/proposals/public.ts"]) {
      expect(read(f), f).not.toMatch(/console\.(log|info|warn|error)/);
    }
  });
});

describe("hard rules", () => {
  const touched = [
    "src/lib/proposals/client-classes.ts",
    "src/lib/proposals/class-lock.ts",
    "src/lib/proposals/added-view.ts",
    "src/lib/proposals/lead-link.ts",
    "src/lib/consult-proposal/package-choice.ts",
    "src/lib/proposal-editor/more-options.ts",
    "src/components/proposal-editor/BuilderLayout.tsx",
    "src/components/proposal-editor/LeadLink.tsx",
    "src/components/proposal-editor/LinkLeadForm.tsx",
    "src/components/proposal-editor/Sections.tsx",
    "src/components/proposal-editor/NewProposalForm.tsx",
    "src/components/client-proposal/ProposalDocument.tsx",
    "src/app/dashboard/proposals/[id]/page.tsx",
  ];
  it("adds no admin client and no raw HTML", () => {
    for (const f of touched) {
      const src = read(f);
      expect(src, f).not.toMatch(/getAdminClient\(|@\/lib\/db\/admin/);
      expect(src, f).not.toContain("dangerouslySetInnerHTML");
    }
  });

  it("reads no mailbox or email body for proposals (spec D2)", () => {
    for (const f of walk("src/lib/consult-proposal")) {
      expect(read(f), f).not.toMatch(/fetchMessageBody|graph\.microsoft|@\/lib\/mailbox|@\/lib\/inbox/);
    }
  });

  it("the client page only references /_next/static/ and /brand/ root-relative assets", () => {
    for (const f of walk("src/components/client-proposal")) {
      expect(read(f), f).not.toMatch(/src="\/(?!brand\/|_next\/static\/)/);
    }
  });
});
