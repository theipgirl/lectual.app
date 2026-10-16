import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { canEditIntakeForm, loadIntakePackages, loadOrCreateIntakeForm } from "@/lib/intake-forms/store";
import { intakePackages } from "@/lib/intake-forms/packages";
import { parseRange } from "@/lib/intake-forms/performance";
import { intakeOrigin } from "@/lib/intake-forms/origin";
import { IntakeFormsWorkspace } from "./_components/IntakeFormsWorkspace";
import { IntakePerformance } from "./_components/IntakePerformance";
import "./forms.css";

export const dynamic = "force-dynamic";

/**
 * Intake → Forms: the firm's public intake — its setup (what it asks, how it
 * looks, where it lives) and how it performs (design/Intake_Forms.dc.html).
 *
 * ── NO MODULE GATE, ON PURPOSE ──────────────────────────────────────────────
 * Modules exist for surfaces RLS cannot isolate: data from outside this
 * database, or content hardcoded to one firm. This page is neither — every
 * row it reads or writes is in a 0079 table with org-scoped RLS, and nothing
 * on it names a firm but the caller's own. It is available to every firm.
 *
 * ── WHO SEES WHAT ───────────────────────────────────────────────────────────
 * Everyone in the firm can see the setup and the Performance tab. Only
 * owner/admin/senior_admin can change the setup (read-only for the rest; the
 * save action re-checks). Anyone but a viewer can move an intake's status.
 * The first admin visit creates the draft row.
 *
 * ── THREE STATES ────────────────────────────────────────────────────────────
 * 0079 is applied on lectual-dev; an environment without it renders
 * "not set up in this environment", and an unreachable read says so — never
 * an empty editor that would overwrite nothing and look like a fresh form.
 */
export default async function IntakeFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; range?: string; intake?: string }>;
}) {
  const sp = await searchParams;
  const session = await resolveFirmSession({ signInNext: "/dashboard/forms/" });
  if (session.kind !== "ok") notFound();

  const tab = sp.tab === "performance" ? "performance" : "setup";
  const range = parseRange(sp.range);
  const canEdit = canEditIntakeForm(session.role);

  const [load, pkgs, origin] = await Promise.all([loadOrCreateIntakeForm(session.org.name), loadIntakePackages(), intakeOrigin()]);

  if (load.status !== "ok" || !load.form) {
    return (
      <>
        <div className="lx-page-head">
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="lx-label">Intake</div>
            <h1 className="lx-h1">Intake forms</h1>
            <p className="lx-sub">Your public intake, how it looks, and where it lives.</p>
          </div>
        </div>
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            {load.status === "unconfigured"
              ? "Intake forms aren't set up in this environment"
              : load.status === "unavailable"
                ? "Your intake couldn't be loaded"
                : "Your firm hasn't set up its intake yet"}
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            {load.status === "unconfigured"
              ? "The intake tables (lectual migration 0079) are not in this database. Nothing is broken; it needs the migration."
              : load.status === "unavailable"
                ? "This is a problem reaching the database, not a missing intake. Nothing was changed. Try again shortly."
                : "An owner, admin or senior admin sets it up here."}
          </p>
        </div>
      </>
    );
  }

  const form = load.form;
  const packages =
    pkgs.status === "ok"
      ? {
          status: "ok" as const,
          items: intakePackages(pkgs.items, []).map(({ id, name, price, includes }) => ({ id, name, price, includes })),
        }
      : { status: "unavailable" as const };

  return (
    <IntakeFormsWorkspace
      form={form}
      orgName={session.org.name}
      packages={packages}
      origin={origin}
      canEdit={canEdit}
      tab={tab}
      range={range}
      performance={
        tab === "performance" ? (
          <IntakePerformance form={form} range={range} intakeId={sp.intake ?? null} canChangeStatus={hasRole(session.role, "clerk")} />
        ) : null
      }
    />
  );
}
