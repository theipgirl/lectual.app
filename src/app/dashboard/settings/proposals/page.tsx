import { currentRole } from "@/lib/auth/current-role";
import { listMemberDirectory, type MemberIdentity } from "@/lib/members/directory";
import { getProposalSettings } from "@/lib/proposals/store";
import { PROPOSAL_ADMIN_ROLES, standardProposalPricing } from "@/lib/proposals/types";
import { normalisePackages } from "@/lib/proposals/package-list";
import { moneyInput } from "@/lib/proposal-editor/form";
import { firstNameOf } from "@/lib/proposal-editor/labels";
import { SettingsForm } from "@/components/proposal-editor/SettingsForm";
import { PackagePricesForm } from "@/components/proposal-editor/PackagePricesForm";
import { requireProposalsModule } from "../../proposals/gate";
import "../../proposals/proposals.css";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle("Proposal settings") };

export const dynamic = "force-dynamic";

/**
 * Proposal settings — who may approve, the default pay link, where acceptance
 * notices go, the firm's named packages and their prices (the "Package prices"
 * card, its own form), and the "what's included" table a new proposal starts
 * from (`client_proposal_setting`).
 *
 * Gate: the `proposals` module (notFound when off), then owner / admin /
 * senior_admin (0089's insert/update policy). The role refusal is an in-firm
 * explanation; the save action re-checks both, and RLS is the boundary.
 */
export default async function ProposalSettingsPage() {
  await requireProposalsModule();
  const role = await currentRole();
  const isAdmin = !!role && PROPOSAL_ADMIN_ROLES.includes(role);

  const head = (
    <div>
      <div className="lx-label">Settings</div>
      <h1 className="lx-h1">Client proposals</h1>
      <p className="lx-sub">
        Who approves proposals, the packages and prices a new proposal starts from, and the included items. Nothing reaches a client until one of the named approvers has
        approved it.
      </p>
    </div>
  );

  if (!isAdmin) {
    return (
      <>
        {head}
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            Restricted to the firm&apos;s admins
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            Owners, admins and senior admins manage the proposal settings. Anyone on the team can open the proposals themselves.
          </p>
        </div>
      </>
    );
  }

  let loadError = false;
  let members: MemberIdentity[] = [];
  let settings: Awaited<ReturnType<typeof getProposalSettings>> = null;
  try {
    [members, settings] = await Promise.all([listMemberDirectory(), getProposalSettings()]);
  } catch {
    loadError = true;
  }

  if (loadError) {
    return (
      <>
        {head}
        <div role="alert" className="lx-banner lx-banner-risk">
          We couldn&apos;t load the proposal settings. This is a problem reaching the database, not empty settings. Try again shortly.
        </div>
      </>
    );
  }

  // The forms show what a NEW proposal would start from: stored values where
  // they are well-formed, the RPB defaults otherwise.
  const standard = standardProposalPricing(settings?.pricing ?? {});
  const packages = normalisePackages(settings?.pricing ?? {});

  return (
    <>
      {head}
      {!settings && (
        <p className="lx-note" style={{ margin: 0 }}>
          Nothing is saved yet. The values below are the defaults a new proposal uses until you save. Name at least one approver, or no one can approve.
        </p>
      )}
      <PackagePricesForm
        packages={packages.map((p) => ({
          package: p.package,
          base: moneyInput(p.base_cents),
          includedClasses: String(p.included_classes),
          perClass: moneyInput(p.per_class_cents),
          secondMarkPct: String(p.second_mark_discount_pct),
          govPerClass: moneyInput(p.gov_per_class_cents),
        }))}
      />
      <SettingsForm
        members={members.map((m) => ({
          userId: m.userId,
          name: m.displayName ?? firstNameOf(m.email) ?? m.email ?? "Teammate",
          email: m.email,
          role: m.role,
        }))}
        values={{
          approverUserIds: settings?.approver_user_ids ?? [],
          notifyEmail: settings?.notify_email ?? "",
          officeActionNote: standard.office_action_note,
          includes: standard.includes,
        }}
      />
    </>
  );
}
