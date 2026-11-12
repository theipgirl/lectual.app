import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * New proposal. Sprint 3 removed the second-stage form (the package dropdown, the five price fields, the brand,
 * pay-link and package-choice fields), so the page tests that pinned it and `fieldsForPackage` are gone. Their
 * coverage moved:
 *  - what a lead or matter gives the draft (client, email, first brand, matter + its lead linked, another firm's
 *    id not found, a malformed id) is in create-proposal-one-step.test.ts and new-proposal-picker.test.ts;
 *  - which package the draft starts on, a name not on the firm's list, a package per brand or mark, the discount:
 *    draft-spec.test.ts and new-offer-setting.test.ts;
 *  - the gates and the consult re-read: create-proposal-one-step.test.ts and new-proposal-consult.test.ts.
 * What stays here is the "use server" rule the actions files must keep.
 */

describe("the server action files stay server actions", () => {
  it.each(["src/app/dashboard/proposals/actions.ts", "src/app/dashboard/proposals/transcript-actions.ts", "src/app/dashboard/settings/proposals/actions.ts"])(
    "%s starts with the use server directive (a client form imports it)",
    (file) => {
      expect(readFileSync(file, "utf8").trimStart().startsWith('"use server"')).toBe(true);
    },
  );
});
