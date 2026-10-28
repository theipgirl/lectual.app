"use server";

import { revalidatePath } from "next/cache";
import { listMemberDirectory } from "@/lib/members/directory";
import { getProposalSettings, saveProposalSettings } from "@/lib/proposals/store";
import { parsePackageList, parseSettingsPricing } from "@/lib/proposal-editor/form";
import { validatePackages, withPackages } from "@/lib/proposals/package-list";
import { proposalActionError, type ActionState } from "../../proposals/errors";
import { gateAdminAction } from "../../proposals/gate";

/**
 * Save the firm's proposal settings: who may approve (the stored default pay link is kept as it was),
 * where acceptance emails go, and the standard prices + includes a new
 * proposal starts from.
 *
 * Its own POST entry point: the module gate (notFound) and the owner / admin /
 * senior_admin gate run first, and `saveProposalSettings` re-checks the role
 * and validates the input again; 0089's RLS is the boundary underneath.
 *
 * Approvers are picked from the firm's own member directory, and an id that is
 * not on it is refused here: the database holds a bare uuid[] with no
 * foreign key, so nothing else would stop a stray id being named an approver.
 */
export async function saveProposalSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const refused = await gateAdminAction();
  if (refused) return refused;

  const text = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" ? v.trim() : "";
  };

  try {
    const members = await listMemberDirectory();
    const known = new Set(members.map((m) => m.userId));
    const approvers = formData.getAll("approver").filter((v): v is string => typeof v === "string");
    if (approvers.some((id) => !known.has(id))) return { error: "An approver you picked isn't on your team any more. Refresh the page." };

    const existing = await getProposalSettings();
    const pricing = parseSettingsPricing(formData, existing?.pricing ?? {});
    if (!pricing.ok) return { error: pricing.error };

    // The page's one form also carries the package prices (`pkg.<n>.<field>`). A post without them (an
    // older caller) keeps the stored list exactly as it was.
    let nextPricing: Record<string, unknown> = pricing.value;
    if (formData.has("pkg.0.package")) {
      const list = parsePackageList(formData);
      if (!list.ok) return { error: list.error };
      const problems = validatePackages(list.value);
      if (problems.length > 0) return { error: problems[0].message };
      nextPricing = withPackages(nextPricing, list.value);
    }

    await saveProposalSettings({
      approverUserIds: approvers,
      // The Default pay link field was removed (Sprint 25); a stored value is kept as it was.
      defaultPayUrl: existing?.default_pay_url ?? null,
      notifyEmail: text("notifyEmail") || null,
      pricing: nextPricing,
    });
  } catch (err) {
    return proposalActionError(err, "Couldn't save the proposal settings.");
  }
  revalidatePath("/dashboard/settings/proposals/");
  return { saved: true };
}

/**
 * Save the firm's package prices alone. The settings page no longer uses it (its one form saves
 * the prices too, through `saveProposalSettingsAction`); it stays as the prices-only entry point.
 *
 * It writes ONLY the price list: the stored approvers, pay link, notify address,
 * includes table and office-action note are read back and saved as they were, so
 * saving prices can never change who may approve. `withPackages` also writes the
 * flat price fields from the first package, which keeps an older reader working.
 *
 * Same gates as the settings form: the module, then owner / admin / senior_admin,
 * re-checked by `saveProposalSettings`; RLS is the boundary underneath.
 */
export async function savePackagesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const refused = await gateAdminAction();
  if (refused) return refused;

  const list = parsePackageList(formData);
  if (!list.ok) return { error: list.error };
  const problems = validatePackages(list.value);
  if (problems.length > 0) return { error: problems[0].message };

  try {
    const existing = await getProposalSettings();
    await saveProposalSettings({
      approverUserIds: existing?.approver_user_ids ?? [],
      defaultPayUrl: existing?.default_pay_url ?? null,
      notifyEmail: existing?.notify_email ?? null,
      pricing: withPackages(existing?.pricing ?? {}, list.value),
    });
  } catch (err) {
    return proposalActionError(err, "Couldn't save the package prices.");
  }
  revalidatePath("/dashboard/settings/proposals/");
  revalidatePath("/dashboard/proposals/new/");
  return { saved: true, notice: "Saved. New proposals can now start from these packages." };
}
