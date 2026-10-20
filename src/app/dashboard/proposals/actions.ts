"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createProposal, getProposalSettings } from "@/lib/proposals/store";
import { findPackage, normalisePackages } from "@/lib/proposals/package-list";
import { standardProposalPricing, type ProposalPackageBasis, type ProposalSettingRow } from "@/lib/proposals/types";
import { buildNewContent, parseDateInput, pricingFromPackage } from "@/lib/proposal-editor/form";
import { proposalActionError, type ActionState } from "./errors";
import { gateStaffAction } from "./gate";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * "New proposal". The prices, includes and office action note come from the
 * firm's own settings read HERE. The form carries who the proposal is for and
 * the NAME of one of the firm's packages; the server re-reads that package from
 * the saved list through the caller's own scoped client, so the browser never
 * decides what a package costs. The five numbers the form fills in are kept
 * only where the person changed one from the package, and then they are this
 * proposal's own price and are named in `content.package_basis.edited` ("Edited
 * from Concierge"). A package name that is not on the firm's list is refused.
 *
 * If the settings cannot be read the form offers no package (it says so), and a
 * draft is still created from the standard defaults rather than lost; a package
 * name posted anyway is refused, because there is nothing to check it against.
 * The lead and matter ids are re-checked by 0089's composite foreign keys, so
 * another firm's cannot be linked.
 */
export async function createProposalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const refused = await gateStaffAction();
  if (refused) return refused;

  const fullName = field(formData, "fullName");
  if (!fullName) return { error: "Enter the client's full name." };
  const firstName = field(formData, "firstName");
  const leadRaw = field(formData, "leadId");
  if (leadRaw && !UUID.test(leadRaw)) return { error: "That lead isn't valid." };
  const matterRaw = field(formData, "matterId");
  if (matterRaw && !UUID.test(matterRaw)) return { error: "That matter isn't valid." };
  const packageName = field(formData, "package");
  const expires = parseDateInput(field(formData, "expiresOn"), "Expiry date");
  if (!expires.ok) return { error: expires.error };

  let settings: ProposalSettingRow | null = null;
  let settingsRead = true;
  try {
    settings = await getProposalSettings();
  } catch {
    settingsRead = false;
  }

  const standard = standardProposalPricing(settings?.pricing ?? {});
  let basis: ProposalPackageBasis | null = null;
  if (packageName) {
    if (!settingsRead) return { error: "Couldn't read your packages, so nothing was created. Try again shortly." };
    const chosen = findPackage(normalisePackages(settings?.pricing ?? {}), packageName);
    if (!chosen) return { error: "That package isn't one of your firm's packages. Pick one from the list." };
    const priced = pricingFromPackage(formData, chosen);
    if (!priced.ok) return { error: priced.error };
    standard.pricing = priced.value.pricing;
    basis = { name: chosen.package, edited: priced.value.edited };
  }

  let id: string;
  try {
    const content = buildNewContent({
      firstName,
      fullName,
      company: field(formData, "company"),
      brandName: field(formData, "brandName"),
      standard,
      packageBasis: basis,
      rand: () => randomBytes(4).toString("hex"),
    });
    const created = await createProposal({
      clientName: fullName,
      clientEmail: field(formData, "clientEmail") || null,
      title: field(formData, "title") || undefined,
      content,
      leadId: leadRaw || null,
      matterId: matterRaw || null,
      expiresOn: expires.value,
      payUrl: field(formData, "payUrl") || settings?.default_pay_url || null,
    });
    id = created.id;
  } catch (err) {
    return proposalActionError(err, "Couldn't create this proposal.");
  }

  revalidatePath("/dashboard/proposals/");
  redirect(`/dashboard/proposals/${id}/`);
}
