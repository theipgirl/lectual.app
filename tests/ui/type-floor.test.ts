import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { ceilingCheck, cssFiles, phoneBlocks, pxFontSizes, read, stripCssComments, tsxFiles } from "./_design-scan";

/**
 * Type floor (design items 15, 16, 31): no readable text under 13px (14px at or under 640px), the 13px floor is written as the token
 * var(--fs-1) so a phone gets 14px, and no font size is typed in place in a component. A RATCHET: each count may only go down.
 *   a  CSS font sizes under 13px
 *   b  CSS font sizes under 14px inside @media (max-width: 640px)
 *   c  literal `font-size: 13px` (must be var(--fs-1))
 *   d  TSX inline fontSize under 13px
 *   e  ANY TSX inline fontSize (sizes come from classes and tokens, never typed in place)
 * A file that is not listed has a ceiling of 0.
 */
const A: Record<string, number> = {
  "src/app/dashboard/brain/brain.css": 10,
  "src/app/dashboard/campaigns/campaigns.css": 1,
  "src/app/dashboard/copilot/copilot.css": 1,
  "src/app/dashboard/forms/_components/event.css": 1,
  "src/app/dashboard/forms/forms.css": 20,
  "src/app/dashboard/intake/intake.css": 1,
  "src/app/dashboard/intake/leads.css": 1,
  "src/app/dashboard/intake/reconcile/reconcile.css": 5,
  "src/app/dashboard/proposals/proposals.css": 10,
  "src/app/dashboard/quotes/quotes.css": 17,
  "src/components/copilot/copilot.css": 8,
  "src/components/deck/deck.css": 5,
  "src/components/onboarding/hub.css": 1,
  "src/components/queue/review.css": 5,
  "src/components/review/review-sheet-edit.css": 5,
  "src/components/review/review.css": 7,
  "src/components/setup/setup.css": 1,
  "src/components/shell/account-menu.css": 1,
  "src/components/shell/owner-shell.css": 9,
  "src/components/today/owner/owner-today.css": 3,
};
const B: Record<string, number> = {
  "src/components/review/review-sheet-edit.css": 1,
  "src/components/today/owner/owner-today.css": 1,
};
const C: Record<string, number> = {};
const D: Record<string, number> = {
  "src/app/dashboard/agents/page.tsx": 1,
  "src/app/dashboard/calendar/page.tsx": 1,
  "src/app/dashboard/intake/_components/AddLeadDialog.tsx": 4,
  "src/app/dashboard/page.tsx": 1,
  "src/app/dashboard/quotes/page.tsx": 1,
  "src/components/agents/AgentControls.tsx": 1,
  "src/components/intake/TimeEntryDialog.tsx": 5,
  "src/components/notifications/BellPopover.tsx": 1,
  "src/components/notifications/NotificationRow.tsx": 1,
  "src/components/onboarding/OnboardingTour.tsx": 1,
  "src/components/queue/LinkedProposalPanel.tsx": 1,
  "src/components/queue/ReviewerSummary.tsx": 1,
  "src/components/shell/AccountMenu.tsx": 3,
  "src/components/shell/NoFirmAccess.tsx": 1,
  "src/components/skills/SkillCard.tsx": 1,
};
const E: Record<string, number> = {
  "src/app/dashboard/agents/page.tsx": 6,
  "src/app/dashboard/brain/page.tsx": 3,
  "src/app/dashboard/calendar/page.tsx": 1,
  "src/app/dashboard/campaigns/page.tsx": 2,
  "src/app/dashboard/campaigns/templates/page.tsx": 2,
  "src/app/dashboard/copilot/page.tsx": 1,
  "src/app/dashboard/forms/_components/EventAssessments.tsx": 2,
  "src/app/dashboard/forms/_components/IntakeFormsWorkspace.tsx": 4,
  "src/app/dashboard/forms/_components/IntakeList.tsx": 2,
  "src/app/dashboard/forms/page.tsx": 1,
  "src/app/dashboard/intake/_components/AddLeadDialog.tsx": 6,
  "src/app/dashboard/intake/_components/LeadsNotices.tsx": 1,
  "src/app/dashboard/layout.tsx": 1,
  "src/app/dashboard/leads/[id]/page.tsx": 3,
  "src/app/dashboard/mail/page.tsx": 3,
  "src/app/dashboard/meetings/[id]/page.tsx": 3,
  "src/app/dashboard/meetings/page.tsx": 4,
  "src/app/dashboard/not-found.tsx": 1,
  "src/app/dashboard/notifications/page.tsx": 1,
  "src/app/dashboard/page.tsx": 1,
  "src/app/dashboard/proposals/[id]/page.tsx": 1,
  "src/app/dashboard/proposals/new/page.tsx": 1,
  "src/app/dashboard/proposals/page.tsx": 3,
  "src/app/dashboard/queue/[id]/page.tsx": 2,
  "src/app/dashboard/queue/page.tsx": 2,
  "src/app/dashboard/quotes/[id]/page.tsx": 1,
  "src/app/dashboard/quotes/page.tsx": 4,
  "src/app/dashboard/reports/[key]/page.tsx": 3,
  "src/app/dashboard/reports/page.tsx": 1,
  "src/app/dashboard/review/page.tsx": 2,
  "src/app/dashboard/settings/integrations/lawmatics/page.tsx": 5,
  "src/app/dashboard/settings/integrations/lawpay/page.tsx": 3,
  "src/app/dashboard/settings/proposals/page.tsx": 1,
  "src/app/dashboard/settings/services/page.tsx": 2,
  "src/app/not-found.tsx": 1,
  "src/components/agents/AgentControls.tsx": 1,
  "src/components/answers/AnswersCard.tsx": 1,
  "src/components/calendar/TodayConsults.tsx": 1,
  "src/components/intake/TimeChip.tsx": 6,
  "src/components/intake/TimeEntryDialog.tsx": 7,
  "src/components/lawpay/LawPayForms.tsx": 2,
  "src/components/leads/ConsultDetailsForm.tsx": 1,
  "src/components/leads/ConsultDetailsSection.tsx": 1,
  "src/components/leads/LeadProposalsCard.tsx": 1,
  "src/components/leads/NeedsAttentionCard.tsx": 1,
  "src/components/leads/SequencesCard.tsx": 1,
  "src/components/leads/TemperatureCard.tsx": 1,
  "src/components/leads/WaitingOnRebecca.tsx": 1,
  "src/components/mailbox/DisconnectButton.tsx": 1,
  "src/components/mailbox/LiveInboxList.tsx": 2,
  "src/components/meetings/LinkedMeetings.tsx": 1,
  "src/components/notifications/BellPopover.tsx": 1,
  "src/components/notifications/NotificationRow.tsx": 1,
  "src/components/onboarding/OnboardingTour.tsx": 1,
  "src/components/proposal-list/LegacyProposals.tsx": 1,
  "src/components/proposal/QuoteDocument.tsx": 1,
  "src/components/proposal/Receipt.tsx": 1,
  "src/components/queue/LinkedProposalPanel.tsx": 1,
  "src/components/queue/ReviewPanel.tsx": 1,
  "src/components/queue/ReviewerSummary.tsx": 1,
  "src/components/quotes/PaymentsPanel.tsx": 1,
  "src/components/quotes/QuoteBuilder.tsx": 2,
  "src/components/quotes/QuoteForms.tsx": 1,
  "src/components/quotes/QuoteParts.tsx": 2,
  "src/components/quotes/QuotesRestricted.tsx": 1,
  "src/components/quotes/ServiceLibraryForms.tsx": 1,
  "src/components/reconcile/ApplyBar.tsx": 2,
  "src/components/reconcile/Explanation.tsx": 1,
  "src/components/reconcile/NotInLectual.tsx": 1,
  "src/components/reconcile/ReconcilePreview.tsx": 1,
  "src/components/review/CardsDeck.tsx": 1,
  "src/components/review/ReviewViews.tsx": 2,
  "src/components/settings/FirmProfileForm.tsx": 2,
  "src/components/settings/RoleTable.tsx": 1,
  "src/components/shell/AccountMenu.tsx": 3,
  "src/components/shell/NoFirmAccess.tsx": 2,
  "src/components/skills/CoworkSkills.tsx": 2,
  "src/components/skills/SkillCard.tsx": 3,
  "src/components/today/NeedsYouSection.tsx": 2,
  "src/components/voice/VoiceNoteRecorder.tsx": 7,
};

function measure() {
  const a: Record<string, number> = {}, b: Record<string, number> = {}, c: Record<string, number> = {}, d: Record<string, number> = {}, e: Record<string, number> = {};
  for (const f of cssFiles()) {
    const css = stripCssComments(read(f));
    const all = pxFontSizes(css);
    const na = all.filter((n) => n < 13).length;
    const nb = pxFontSizes(phoneBlocks(css)).filter((n) => n < 14).length;
    const nc = (css.match(/font-size:\s*13px/g) ?? []).length;
    if (na) a[f] = na;
    if (nb) b[f] = nb;
    if (nc) c[f] = nc;
  }
  for (const f of tsxFiles()) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const sizes = [...src.matchAll(/fontSize:\s*(?:"([\d.]+)px"|'([\d.]+)px'|([\d.]+)(?![\d.]*\s*[a-z%]))/g)].map((m) => Number(m[1] ?? m[2] ?? m[3]));
    if (sizes.length) e[f] = sizes.length;
    const small = sizes.filter((n) => n > 0 && n < 13).length;
    if (small) d[f] = small;
  }
  return { a, b, c, d, e };
}

describe("type floor", () => {
  const m = measure();
  if (process.env.DESIGN_DUMP) fs.writeFileSync(`${process.env.DESIGN_DUMP}/type-floor.json`, JSON.stringify(m, null, 2));
  it("a: no CSS font size under 13px beyond the ceilings", () => expect(ceilingCheck(m.a, A)).toEqual([]));
  it("b: no CSS font size under 14px inside a phone block beyond the ceilings", () => expect(ceilingCheck(m.b, B)).toEqual([]));
  it("c: the 13px floor is the token, not a literal, beyond the ceilings", () => expect(ceilingCheck(m.c, C)).toEqual([]));
  it("d: no inline fontSize under 13px beyond the ceilings", () => expect(ceilingCheck(m.d, D)).toEqual([]));
  it("e: no font size typed in place in a component beyond the ceilings", () => expect(ceilingCheck(m.e, E)).toEqual([]));
  it("the shared stylesheet itself is clean", () => {
    for (const f of ["src/app/globals.css", "src/components/list-page/list-page.css", "src/components/view-toggle.css"]) {
      expect(m.a[f] ?? 0, `${f} (a)`).toBe(0);
      expect(m.b[f] ?? 0, `${f} (b)`).toBe(0);
      expect(m.c[f] ?? 0, `${f} (c)`).toBe(0);
    }
  });
});
