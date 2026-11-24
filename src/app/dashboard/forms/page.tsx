import { notFound } from "next/navigation";
import { isEventCode } from "@/lib/intake-forms/event-name";
import { getFirmTimeZone } from "@/lib/org/profile";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { canEditIntakeForm, listOrCreateIntakeForms, loadIntakeForm, loadIntakePackages } from "@/lib/intake-forms/store";
import { intakePackages } from "@/lib/intake-forms/packages";
import { formatDuration, parseRange, statsByForm } from "@/lib/intake-forms/performance";
import { loadSubmissionStatRows } from "@/lib/intake-forms/load-performance";
import { intakeOrigin } from "@/lib/intake-forms/origin";
import { intakePublicUrl } from "@/lib/intake-forms/links";
import { IntakeFormsWorkspace } from "./_components/IntakeFormsWorkspace";
import { IntakeList } from "./_components/IntakeList";
import { IntakePerformance } from "./_components/IntakePerformance";
import { IntakeResults } from "./_components/IntakeResults";
import { EventAssessments } from "./_components/EventAssessments";
import { EventPage } from "./_components/EventPage";
import { loadBoothEventList } from "@/lib/intake-forms/load-results";
import { parseEventRange } from "@/lib/intake-forms/booth-results";
import { MATTER_WRITE_ROLES } from "@/lib/matters/matters";
import "./forms.css";
import type { Metadata } from "next";
import { pageTitle, recordPageTitle } from "@/lib/ui/page-title";
import { ADMIN_TIER_PHRASE } from "@/lib/setup/roles";
import { EmptyState, LoadFailedCard, PageHeader } from "@/components/ui";
import { FORMS_NAME, BLANK } from "@/lib/ui/words";

/** The tab says "Forms" on the list and the form's own name once one is open (the h1 is that name). */
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ form?: string }> }): Promise<Metadata> {
  const { form } = await searchParams;
  if (!form) return { title: pageTitle(FORMS_NAME) };
  return {
    title: await recordPageTitle(async () => {
      const load = await loadIntakeForm(form);
      return load.status === "ok" ? (load.form?.name ?? null) : null;
    }, FORMS_NAME),
  };
}

export const dynamic = "force-dynamic";

/**
 * Intake → Forms: the firm's public intakes (one per event, campaign or page
 * since 0093). Without `?form=` it lists them with their links, QR codes and
 * numbers; with `?form=<id>` it opens one intake's setup (what it asks, how it
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
 * The first admin visit creates the firm's first draft.
 *
 * ── RESULTS AND EVENTS ─────────────────────────────────────────────────────
 * `?form=<id>&tab=results` lists an intake's answers per question (or an
 * assessment's distributions). `?event=<code>` opens one booth event, read-only.
 * The list's "Event assessments" rows come from `crm_booth_scorecard`. Both are
 * visible to every member; the CSV export, the one thing that moves answers
 * out of the app, is for staff roles and re-checks the caller itself.
 *
 * ── THREE STATES ────────────────────────────────────────────────────────────
 * 0079 is applied on lectual-dev; an environment without it renders
 * "not set up in this environment", and an unreachable read says so — never
 * an empty editor that would overwrite nothing and look like a fresh form.
 */
export default async function IntakeFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ form?: string; tab?: string; range?: string; intake?: string; event?: string }>;
}) {
  const sp = await searchParams;
  const session = await resolveFirmSession({ signInNext: "/dashboard/forms/" });
  if (session.kind !== "ok") notFound();

  const tab = sp.tab === "performance" ? "performance" : sp.tab === "results" ? "results" : "setup";
  const range = parseRange(sp.range);
  const canEdit = canEditIntakeForm(session.role);

  if (!sp.form && sp.event !== undefined) {
    // One booth event. A code that is not shaped like one (letters, digits, - and _, at most 120) is no event.
    if (!isEventCode(sp.event)) notFound();
    return <EventPage code={sp.event} range={parseEventRange(sp.range)} role={session.role} />;
  }

  if (!sp.form) {
    const [list, statRows, origin, events, timeZone] = await Promise.all([
      listOrCreateIntakeForms(session.org.name),
      loadSubmissionStatRows(null, 30),
      intakeOrigin(),
      loadBoothEventList(),
      getFirmTimeZone(),
    ]);
    if (list.status === "ok" && list.value.length > 0) {
      const byForm = statRows.status === "ok" ? statsByForm(statRows.value.rows) : null;
      return (
        <>
          <IntakeList
            canEdit={canEdit}
            statsFailed={statRows.status !== "ok"}
            items={list.value.map((f) => {
              const st = byForm?.get(f.id);
              return {
                id: f.id,
                name: f.name,
                slug: f.slug,
                url: intakePublicUrl(origin, f.slug),
                sourceTag: f.sourceTag,
                kind: f.kind,
                status: f.status,
                stats: byForm
                  ? {
                      captured: st?.captured ?? 0,
                      completed: st?.completed ?? 0,
                      unfinished: st?.unfinished ?? 0,
                      median: formatDuration(st?.medianMs ?? null),
                      rate: st?.completionRate ?? BLANK,
                    }
                  : null,
              };
            })}
          />
          <EventAssessments read={events} timeZone={timeZone} />
        </>
      );
    }
    return <IntakeEmpty status={list.status === "ok" ? "none" : list.status} />;
  }

  const [load, pkgs, origin, timeZone] = await Promise.all([loadIntakeForm(sp.form), loadIntakePackages(), intakeOrigin(), getFirmTimeZone()]);
  if (load.status === "ok" && !load.form) notFound();

  if (load.status !== "ok" || !load.form) return <IntakeEmpty status={load.status === "ok" ? "none" : load.status} />;

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
      timeZone={timeZone}
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
      results={
        tab === "results" ? (
          <IntakeResults
            form={form}
            range={range}
            intakeId={sp.intake ?? null}
            canChangeStatus={hasRole(session.role, "clerk")}
            canExport={MATTER_WRITE_ROLES.includes(session.role)}
          />
        ) : null
      }
    />
  );
}

/** No intakes to show: not set up here, unreachable, or none yet (and the caller can't create). */
function IntakeEmpty({ status }: { status: "none" | "unconfigured" | "unavailable" }) {
  return (
    <>
      <PageHeader title={FORMS_NAME} tour="forms-head" sub="Your public intake, how it looks, and where it lives." />
      {status === "unavailable" ? (
        <LoadFailedCard what="your intake" body="Nothing was changed. Refresh to try again." />
      ) : (
        <EmptyState title={status === "unconfigured" ? "Forms isn't switched on for your firm yet" : "Your firm hasn't set up its intake yet"}>
          {status === "unconfigured" ? "Lectual will turn it on. Nothing is broken." : `${ADMIN_TIER_PHRASE} can set it up here.`}
        </EmptyState>
      )}
    </>
  );
}
