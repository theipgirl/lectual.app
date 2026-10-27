import { normalizeStageName } from "@/lib/lawmatics/stage-map";
import { compareStageOrder } from "./stage-order";

/**
 * Where a brand-new lead with no evidence about its stage goes. Pure; the ONE place this is decided.
 *
 * The firm's NEW-ENQUIRY stage: the open stage named like "Potential New Client", "New Lead" or "New
 * Inquiry" (this alias list, tried in order, spelling and punctuation ignored), else the firm's first
 * open stage in pipeline order. Never a stage that opens a matter (`won`), a closing one (`lost`) or a
 * holding one (`nurture`): a person who only just asked is not a client, and was never "Follow-Up"
 * just because that stage happens to sort first.
 *
 * This is a placement rule for people we know nothing about. It reads no Lawmatics stage name: those
 * are not RPB's stages and never choose where a lead goes.
 */
export const NEW_ENQUIRY_STAGE_NAMES = ["Potential New Client", "New Lead", "New Inquiry", "New Enquiry"] as const;

export type EnquiryStage = { id: string; name: string; category?: string | null; order_index: number | null };

export function newEnquiryStage<T extends EnquiryStage>(stages: readonly T[]): T | null {
  const open = stages.filter((s) => s.category === "open").sort(compareStageOrder);
  for (const wanted of NEW_ENQUIRY_STAGE_NAMES) {
    const key = normalizeStageName(wanted);
    const hit = open.find((s) => normalizeStageName(String(s.name ?? "")) === key);
    if (hit) return hit;
  }
  return open[0] ?? null;
}
