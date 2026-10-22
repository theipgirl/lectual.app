import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Static guards for the New proposal picker and pre-fill: what the new files must never contain.
 * Patterns are spelled in pieces so this file does not trip its own search.
 */

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const NEW_FILES = [
  "src/lib/proposals/new-picker.ts",
  "src/lib/proposals/prefill.ts",
  "src/lib/proposals/prefill-words.ts",
  "src/lib/proposals/lead-label.ts",
  "src/lib/proposals/consult-prefill-load.ts",
  "src/components/proposal-editor/WhoIsThisFor.tsx",
  "src/components/proposal-editor/FilledFrom.tsx",
  "src/components/matters/MatterProposalCard.tsx",
];
const TOUCHED = [...NEW_FILES, "src/app/dashboard/proposals/new/page.tsx", "src/app/dashboard/proposals/actions.ts", "src/components/proposal-editor/NewProposalForm.tsx", "src/app/dashboard/matters/[id]/page.tsx"];

describe("New proposal picker and pre-fill: what the code must not do", () => {
  it.each(TOUCHED)("%s has no admin client, no raw HTML injection and no external call", (file) => {
    const src = read(file);
    expect(src).not.toMatch(new RegExp(["db\\/ad" + "min", "getAdmin" + "Client", "dangerously" + "SetInnerHTML", "fet" + "ch\\(", "send" + "Mail"].join("|")));
  });

  it.each(NEW_FILES)("%s reads no price from a record", (file) => {
    const src = read(file);
    expect(src).not.toMatch(new RegExp(["package" + "_name", "discount" + "_discussed", "_cen" + "ts", "price" + "_override"].join("|")));
  });

  it.each(NEW_FILES)("%s has no unfinished-work words", (file) => {
    expect(read(file)).not.toMatch(new RegExp(["coming " + "soon", "to" + "do", "lor" + "em", "place" + "holder", "fix" + "me"].join("|"), "i"));
  });

  it("the picker page reads the consult only through loadReviewedConsult (via the one loader)", () => {
    const page = read("src/app/dashboard/proposals/new/page.tsx");
    expect(page).toContain("loadConsultForPrefill");
    expect(page).not.toContain("loadConsultEntries");
    expect(page).not.toContain("consult" + "_details");
    expect(read("src/lib/proposals/consult-prefill-load.ts")).toContain("loadReviewedConsult");
    for (const file of TOUCHED) expect(read(file)).not.toContain("consult" + "_details");
  });

  it("the page's own reads go through the caller's scoped client, with no org id from the URL or form", () => {
    const page = read("src/app/dashboard/proposals/new/page.tsx");
    expect(page).toContain("getScopedClient");
    expect(page).not.toMatch(/org_id|orgId/);
    expect(read("src/app/dashboard/proposals/actions.ts")).not.toMatch(/org_id|orgId/);
  });

  it("the create action takes no marks or classes from the form", () => {
    const action = read("src/app/dashboard/proposals/actions.ts");
    expect(action).not.toMatch(/collectRows|"mark\.|"class\./);
    expect(action).toContain("loadConsultForPrefill");
  });

  it("the gate is still the first statement of the create action", () => {
    const action = read("src/app/dashboard/proposals/actions.ts");
    expect(action).toMatch(/export async function createProposalAction\([^)]*\): Promise<ActionState> \{\n  const refused = await gateStaffAction\(\);/);
    expect(action.indexOf("gateStaffAction()")).toBeLessThan(action.indexOf("loadConsultForPrefill(leadRaw)"));
  });
});
