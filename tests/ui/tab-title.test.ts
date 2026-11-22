import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * One name per page (design item 25): a page's browser tab and its h1 read the SAME words constant, so the two can never drift apart
 * again ("Quotes & proposals" in the tab, "Proposals" on the page). Added at integration (FOUNDATION-PLAN section 4).
 */
const PAGES: Array<[file: string, constant: string]> = [
  ["src/app/dashboard/review/page.tsx", "REVIEW_NAME"],
  ["src/app/dashboard/queue/page.tsx", "APPROVALS_NAME"],
  ["src/app/dashboard/matters/page.tsx", "MATTERS_NAME"],
  ["src/app/dashboard/documents/page.tsx", "DOCUMENTS_NAME"],
  ["src/app/dashboard/documents/new/[matterId]/loe/page.tsx", "NEW_LETTER_NAMES.loe"],
  ["src/app/dashboard/documents/new/[matterId]/opinion-letter/page.tsx", "NEW_LETTER_NAMES.opinion"],
  ["src/app/dashboard/documents/new/[matterId]/trademark-clearance/page.tsx", "NEW_LETTER_NAMES.clearance"],
  ["src/app/dashboard/proposals/page.tsx", "PROPOSALS_NAME"],
  ["src/app/dashboard/quotes/page.tsx", "PROPOSALS_NAME"],
  ["src/app/dashboard/mail/page.tsx", "MAIL_NAME"],
  ["src/app/dashboard/forms/page.tsx", "FORMS_NAME"],
  ["src/app/dashboard/campaigns/templates/page.tsx", "EMAIL_TEMPLATES_NAME"],
  ["src/app/dashboard/agents/page.tsx", "ASSISTANTS_NAME"],
  ["src/app/dashboard/settings/proposals/page.tsx", "PROPOSAL_SETTINGS_NAME"],
  ["src/app/dashboard/settings/approvals/page.tsx", "APPROVAL_SETTINGS_NAME"],
  ["src/app/dashboard/settings/columns/page.tsx", "COLUMNS_SETTINGS_NAME"],
  ["src/app/dashboard/settings/integrations/lawmatics/page.tsx", "LAWMATICS_NAME"],
  ["src/app/dashboard/settings/integrations/meetings/page.tsx", "MEETINGS_INTEGRATION_NAME"],
];

describe("tab title and h1 share one words constant", () => {
  for (const [file, constant] of PAGES) {
    it(file, () => {
      const src = readFileSync(file, "utf8");
      expect(src, "the tab").toContain(`pageTitle(${constant})`);
      expect(src, "the h1").toContain(`title={${constant}}`);
    });
  }
});
