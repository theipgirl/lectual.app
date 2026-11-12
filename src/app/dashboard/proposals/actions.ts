"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getApprovedLetter } from "@/lib/loe/templates-store";
import { getFirmTimeZone } from "@/lib/org/profile";
import { firmCivilDate, FIRM_TIME_ZONE } from "@/lib/quotes/firm-time";
import { createProposal, getProposalSettings } from "@/lib/proposals/store";
import { loadConsultForPrefill } from "@/lib/proposals/consult-prefill-load";
import { buildDraftContent, type DraftBrand, type ProposalDraftSpec } from "@/lib/proposals/draft-spec";
import { brandPlan, packageFromConsult, consultPrefill, CHANGED_SINCE_LOAD } from "@/lib/proposals/prefill";
import { normalisePackages } from "@/lib/proposals/package-list";
import { readStartSubject } from "@/lib/proposals/start-subject";
import { GENERAL_PROPOSAL_TITLE } from "@/lib/proposal-editor/general-form";
import { proposalActionError, type ActionState } from "./errors";
import { gateStaffAction } from "./gate";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_OPEN_DAYS = 14;

function field(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * "New proposal", in ONE step (Sprint 3). A person chooses a lead or a matter (or starts blank with a name), and
 * the draft is created and the editor opens. Everything else is chosen in the editor.
 *
 * The form carries an id, never the client's details: the lead or matter is read HERE through the caller's own
 * scoped client, so another firm's id is "not found". Blank carries only the name the person typed. The content
 * is built by `buildDraftContent` (the one builder every way of starting a proposal uses) from the firm's saved
 * packages, its "New proposals offer" and its approved engagement letter; the browser decides no price.
 *
 * "Use the marks and classes from the reviewed consult" (`useConsult`) carries no marks or classes: when it is
 * posted with a lead the action reads that lead's consult details itself, requires the newest to still be
 * reviewed, and builds the brand names from that read. If they changed or can't be read, nothing is created.
 *
 * The settings read failing falls back to the standard defaults rather than losing the draft. The lead and
 * matter ids are re-checked by 0089's composite foreign keys, so another firm's cannot be linked.
 */
export async function createProposalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const refused = await gateStaffAction();
  if (refused) return refused;

  const kind = field(formData, "kind") === "general" ? "general" : "trademark";
  const leadRaw = field(formData, "leadId");
  if (leadRaw && !UUID.test(leadRaw)) return { error: "That lead isn't valid." };
  const matterRaw = field(formData, "matterId");
  if (matterRaw && !UUID.test(matterRaw)) return { error: "That matter isn't valid." };

  // Who it is for: a record read on the server, or (blank) the name typed.
  let client: { fullName: string; firstName: string; company: string; clientEmail: string };
  let brand = "";
  let leadId: string | null = null;
  let matterId: string | null = null;
  if (leadRaw || matterRaw) {
    const read = await readStartSubject({ leadId: leadRaw || null, matterId: matterRaw || null });
    if (read.status === "not-found") return { error: "That lead or matter couldn't be found." };
    if (read.status === "unavailable") return { error: "Couldn't read that record, so nothing was created. Try again shortly." };
    const s = read.subject;
    if (!s.fullName) return { error: "That record has no client name yet. Add one on the lead, or start blank." };
    client = { fullName: s.fullName, firstName: s.firstName, company: s.company, clientEmail: s.clientEmail };
    brand = s.brand;
    leadId = s.leadId;
    matterId = s.matterId;
  } else {
    const fullName = field(formData, "fullName");
    if (!fullName) return { error: "Enter the client's full name." };
    client = { fullName, firstName: field(formData, "firstName"), company: field(formData, "company"), clientEmail: field(formData, "clientEmail") };
  }

  // The firm's packages and offer. Unreadable settings = the standard defaults (a draft is still created).
  let settingsPricing: Record<string, unknown> = {};
  let settingsRead = true;
  try {
    settingsPricing = (await getProposalSettings())?.pricing ?? {};
  } catch {
    settingsRead = false;
  }

  // The firm's approved letter. A missing table means no letter yet; a failed read creates nothing (a draft
  // that silently lacks the letter would be mistaken for one that has it).
  const letterRead = await getApprovedLetter(await getScopedClient(), kind);
  if (letterRead.status === "unavailable") return { error: "Couldn't read your engagement letter, so nothing was created. Try again shortly." };
  const letter = letterRead.status === "ok" ? letterRead.letter : null;

  let brands: DraftBrand[] = brand ? [{ name: brand }] : [];
  let recommended: string | undefined;
  if (kind === "trademark" && field(formData, "useConsult") && leadId) {
    const fill = consultPrefill(await loadConsultForPrefill(leadId));
    if (fill.state !== "filled" && fill.state !== "no_marks") return { error: CHANGED_SINCE_LOAD };
    if (fill.state === "filled") {
      brands = brandPlan(brand, fill.brands).map((p) => ({ name: p.name, marks: p.kinds.map((k) => ({ kind: k })), classes: [...p.classes] }));
      const pick = packageFromConsult(fill.recommendedPackage, settingsRead ? normalisePackages(settingsPricing) : null);
      if (pick.kind === "match") recommended = pick.name;
    }
  }

  const spec: ProposalDraftSpec =
    kind === "general"
      ? {
          kind: "general",
          client,
          madeBy: "person",
          general: { matterTitle: "", items: [], flatFee: 0 },
        }
      : { kind: "trademark", client, madeBy: "person", names: brands, ...(recommended ? { package: recommended } : {}) };

  const rand = () => randomBytes(4).toString("hex");
  const built = buildDraftContent(spec, { pricing: settingsPricing, letter }, rand);
  if (!built.ok) return { error: built.error };

  let tz = FIRM_TIME_ZONE;
  try {
    tz = await getFirmTimeZone();
  } catch {
    /* the default zone */
  }
  const expiresOn = firmCivilDate(new Date(Date.now() + DEFAULT_OPEN_DAYS * 86_400_000), tz);

  let id: string;
  try {
    const created = await createProposal({
      clientName: client.fullName,
      clientEmail: client.clientEmail || null,
      title: kind === "general" ? GENERAL_PROPOSAL_TITLE : undefined,
      content: built.content,
      leadId,
      matterId,
      expiresOn,
      payUrl: null,
    });
    id = created.id;
  } catch (err) {
    return proposalActionError(err, "Couldn't create this proposal.");
  }

  revalidatePath("/dashboard/proposals/");
  redirect(`/dashboard/proposals/${id}/`);
}
