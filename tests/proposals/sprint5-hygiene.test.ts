import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Sprint 5 (Q1, Q2): the new mapping code can approve nothing, make no link, queue nothing, send nothing; and neither
 * mapper's request or spec has a price field. Comments are stripped, so only code is judged.
 */

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = (f: string) => strip(readFileSync(f, "utf8"));

const MAPPERS = ["src/lib/consult-proposal/draft.ts", "src/lib/copilot/draft-proposal.ts", "src/lib/agents/copilot-draft-proposal.ts"];
const CHECK_CODE = ["src/lib/proposal-editor/checklist.ts", "src/lib/proposals/draft-spec.ts"];

const FORBIDDEN = [
  /\bapproveProposal\b/, /\bsendProposal\b/, /\bcreateLink\w*/, /\bapproveAction\b/, /\bsendAction\b/,
  /\bcreateDraft\b/, /\bqueueDraft\b/, /queue_draft/, /\bcreateMailboxDraft\b/, /\bsendMail\b/, /\bsendInternalMail\b/, /\bresolveQueueItem\b/,
  /dangerouslySetInnerHTML/,
  /getAdmin\w*Client\(/, /@\/lib\/db\/admin/, /SERVICE_ROLE/,
];

describe("Q1: no approve, link, queue, mail or service-role path in the mapping or check code", () => {
  it.each([...MAPPERS, ...CHECK_CODE])("%s", (f) => {
    const c = code(f);
    for (const re of FORBIDDEN) expect(c, `${f} must not match ${re}`).not.toMatch(re);
  });

  it("the checks component draws only text and links", () => {
    const c = code("src/components/proposal-editor/EditorSide.tsx");
    expect(c).not.toMatch(/dangerouslySetInnerHTML/);
  });
});

describe("Q2: no price field on the request or the spec", () => {
  it("the Copilot request types and the draft spec carry no package price", () => {
    for (const f of ["src/lib/copilot/draft-proposal.ts", "src/lib/proposals/draft-spec.ts"]) {
      const src = readFileSync(f, "utf8");
      const types = src.slice(src.indexOf("export type"));
      // `base_cents` / `per_class_cents` are the firm's package fields: they may be read, never asked for in a request or spec type.
      const typeBlocks = [...types.matchAll(/export type \w+ =[\s\S]*?\n(?=\n|export|\/\*\*)/g)].map((m) => m[0]).join("\n");
      expect(typeBlocks, f).not.toMatch(/\b(base_cents|per_class_cents|gov_per_class_cents|baseCents|perClassCents|price|basePrice)\??:/);
    }
  });

  it("the Copilot tool schema has no price field except the matter's typed fee and hourly rate", () => {
    const src = readFileSync("src/lib/agents/matters-chat.ts", "utf8");
    const start = src.indexOf("draft_proposal: {");
    const schema = src.slice(start, src.indexOf("execute: (input) =>", start));
    expect(schema).not.toMatch(/base_cents|per_class_cents|gov_per_class_cents|basePrice|\bprice\b/);
    expect(schema).toMatch(/hourlyRate/);
    expect(schema).toMatch(/fee: \{ type: "number"/);
  });

  it("the consult mapper passes the builder a spec with no price", () => {
    const src = code("src/lib/consult-proposal/draft.ts");
    const spec = src.slice(src.indexOf("const spec: TrademarkDraftSpec"), src.indexOf("const built = buildDraftContent"));
    expect(spec).not.toMatch(/base_cents|per_class_cents|price/i);
  });
});
