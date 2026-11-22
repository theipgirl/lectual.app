import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { PIN_CASES, renderPin } from "./baseline-render";

const DIR = join(__dirname, "__baseline__");

describe("AT1: the in-app letter steps and receipt are byte-identical to the base commit (49efd5e)", () => {
  for (const c of PIN_CASES) {
    it(`AT1: ${c.name} with no signing path (Adobe not set up)`, () => {
      expect(renderPin(c)).toBe(readFileSync(join(DIR, `${c.name}.html`), "utf8"));
    });
    it(`AT1: ${c.name} with an Adobe start action bound but the path in-app (connection active, switch off)`, () => {
      expect(renderPin(c, { onStartAdobe: async () => ({ ok: false, message: "x" }) })).toBe(readFileSync(join(DIR, `${c.name}.html`), "utf8"));
    });
  }
});

import { execFileSync } from "node:child_process";
import { checkSigning } from "@/lib/loe/signing";
import { TEST_DETAILS } from "../loe/full-letter-fixture";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/lib/proposals/accept-followups", () => ({ runAcceptanceFollowups: async () => {} }));

describe("AT1: the in-app signature sends and refuses exactly what it did before", () => {
  const baseline = JSON.parse(readFileSync(join(DIR, "rpc-args.json"), "utf8")) as { rpc: unknown[]; checks: unknown[] };

  it("AT1: client_proposal_sign_and_accept is called with exactly the same arguments as at the base commit (spy)", async () => {
    const { acceptPublicProposal } = await import("@/lib/proposals/public");
    const { NOW, TOKEN, browserSigning, world } = await import("../proposals/signing-world");
    const w = world();
    const b = await browserSigning(w.db, { typedName: "Jordan Sample" });
    await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, b.signing, { ip: "203.0.113.7", userAgent: "UA" });
    expect(JSON.parse(JSON.stringify(w.rpcCalls))).toEqual(baseline.rpc);
  });

  it("AT1: checkSigning returns what it returned before for the existing cases", () => {
    const cases = [
      {},
      null,
      { typedName: "J", agree: true, details: TEST_DETAILS },
      { typedName: "Jordan Sample", agree: false, details: TEST_DETAILS },
      { typedName: "Jordan Sample", agree: true, details: {} },
      { typedName: "  Jordan   Sample ", agree: true, details: TEST_DETAILS },
    ];
    expect(JSON.parse(JSON.stringify(cases.map((c) => checkSigning(c))))).toEqual(baseline.checks);
  });

  it("AT1: the signature-read COLUMNS read is unchanged from the base commit", () => {
    const before = execFileSync("git", ["show", "49efd5e:src/lib/loe/signature-read.ts"], { encoding: "utf8" });
    expect(readFileSync("src/lib/loe/signature-read.ts", "utf8")).toBe(before);
  });
});
