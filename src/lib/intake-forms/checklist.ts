import type { IntakeFormConfig } from "./config";

/**
 * "Finish these to go live." (design/Intake_Forms.dc.html, `items()`).
 *
 * The same function draws the checklist in the editor AND decides, on the
 * server, whether a save may set `status = 'live'` — so the UI can never show
 * a form as ready that the server would refuse, or the reverse.
 *
 * The office and participation-agreement items exist only for a firm that
 * receives Lectual referrals (`crm_intake_form.receives_referrals`). Both of
 * those facts — whether the firm is in the referral program and whether its
 * agreement is signed — are columns only Lectual can write (0075 grants the
 * firm no INSERT/UPDATE on them), so the firm cannot tick its own box.
 */

export type ChecklistKey = "fit" | "closing" | "questions" | "office" | "agreement";
/** The editor section a "Fix" link scrolls to. */
export type ChecklistSection = "screening" | "questions" | "compliance";

export type ChecklistItem = { key: ChecklistKey; label: string; ok: boolean; section: ChecklistSection };

export type ChecklistContext = { receivesReferrals: boolean; agreementSigned: boolean };

export function goLiveChecklist(
  config: Pick<IntakeFormConfig, "fitText" | "closing" | "questions" | "office">,
  ctx: ChecklistContext,
): ChecklistItem[] {
  const items: ChecklistItem[] = [
    { key: "fit", label: "Fit criteria", ok: config.fitText.trim() !== "", section: "screening" },
    { key: "closing", label: "Closing message", ok: config.closing.trim() !== "", section: "screening" },
    {
      key: "questions",
      label: "At least one question or question pack",
      ok: config.questions.some((q) => q.text.trim() !== ""),
      section: "questions",
    },
  ];
  if (ctx.receivesReferrals) {
    items.push({ key: "office", label: "Office location", ok: config.office.trim() !== "", section: "compliance" });
    items.push({ key: "agreement", label: "Participation agreement signed", ok: ctx.agreementSigned, section: "compliance" });
  }
  return items;
}

export function checklistComplete(items: ChecklistItem[]): boolean {
  return items.every((i) => i.ok);
}

export function checklistRemaining(items: ChecklistItem[]): number {
  return items.filter((i) => !i.ok).length;
}
