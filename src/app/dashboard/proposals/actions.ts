"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createProposal, getProposalSettings } from "@/lib/proposals/store";
import { resolvePackageItem } from "@/lib/proposals/packages";
import { standardProposalPricing } from "@/lib/proposals/types";
import { buildNewContent, parseDateInput } from "@/lib/proposal-editor/form";
import { proposalActionError, type ActionState } from "./errors";
import { gateStaffAction } from "./gate";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * "New proposal". The prices, includes and office action note come from the
 * firm's own settings read HERE, never from the form: the form carries only
 * who the proposal is for, and optionally the id of a service-library package.
 * A package id is re-read through the caller's own scoped client and sets only
 * the package name and base price; every other value stays the firm's standard,
 * so a price field a browser sends is ignored. The lead and matter ids are
 * re-checked by 0089's composite foreign keys, so another firm's cannot be linked.
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
  const packageRaw = field(formData, "serviceItemId");
  if (packageRaw && !UUID.test(packageRaw)) return { error: "That package isn't valid." };
  const expires = parseDateInput(field(formData, "expiresOn"), "Expiry date");
  if (!expires.ok) return { error: expires.error };

  const chosen = packageRaw ? await resolvePackageItem(packageRaw) : null;
  if (chosen && !chosen.ok) return { error: chosen.error };

  let id: string;
  try {
    const settings = await getProposalSettings();
    const standard = standardProposalPricing(settings?.pricing ?? {});
    if (chosen) standard.pricing = { ...standard.pricing, package: chosen.label, base_cents: chosen.baseCents };
    const content = buildNewContent({
      firstName,
      fullName,
      company: field(formData, "company"),
      brandName: field(formData, "brandName"),
      standard,
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
