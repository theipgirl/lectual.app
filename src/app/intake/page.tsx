import Link from "next/link";

import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Shell } from "@/components/Shell";
import { requireSession } from "@/lib/auth/session";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types.generated";
import { courtToday, formatDocketDateTime, formatDocketDateWithYear } from "@/lib/format/date";
import { listMatters, type Matter } from "@/lib/matters/read";

/**
 * `/intake` — where the work comes from, and where it stops.
 *
 * Two read-only panels, side by side, answering the two halves of one question.
 *
 * REFERRAL SOURCES. This firm's debt-litigation work arrives from credit-repair
 * partners rather than from direct leads, so "who sends us matters" is a real
 * business question with an answer already sitting in `crm_matter.referral_source`
 * — a free-text column nobody has ever grouped. Grouping it is the whole panel.
 * Matters with no source recorded are counted and shown as their own row rather
 * than dropped: a blank source is the most common value on this docket, and
 * hiding it would make the referral mix look far tidier than it is.
 *
 * CONSULTS THAT DID NOT CONVERT. Wins are visible everywhere and losses are
 * visible nowhere, which is exactly backwards for deciding what to change. A
 * lead sits in a `crm_stage`, and the stage carries a category: `open`, `won`,
 * `lost`, `nurture`. This panel reads the two that are not a win. `nurture` is
 * deliberately in scope alongside `lost` — a consult parked for later is a
 * consult that has not converted, and the useful list is the one that includes
 * the ones still worth a call.
 *
 * READ-ONLY, ON PURPOSE. There is no write on this page and no form. Intake
 * capture (two forms, referral-partner submission, the Spanish booking email)
 * is later work; what ships here is the visibility, which is what makes the
 * capture worth designing.
 *
 * NO `org_id` FILTER ON EITHER QUERY. RLS scopes both reads on the caller's
 * `active_org_id` claim, as everywhere else in this app.
 */

export const dynamic = "force-dynamic";

type LeadRow = Database["public"]["Tables"]["crm_lead"]["Row"];
type StageCategory = Database["public"]["Enums"]["crm_stage_category"];

/** The stage categories that mean "this consult is not a client". */
const NON_CONVERTING: readonly StageCategory[] = ["lost", "nurture"] as const;

type NonConvertingConsult = {
  lead: LeadRow;
  stageName: string;
  category: StageCategory;
};

/**
 * Consults sitting in a `lost` or `nurture` stage.
 *
 * Two plain queries rather than a PostgREST embed, matching the pattern the
 * read modules already use: the embed's shape depends on how PostgREST resolves
 * the composite `(current_stage_id, org_id)` FK, and that is the kind of thing
 * that changes under you. Both queries are RLS-scoped, so a lead pointing at a
 * stage this caller cannot see simply yields no match rather than an error.
 */
async function readNonConvertingConsults(): Promise<NonConvertingConsult[]> {
  const supabase = await getScopedClient();

  const { data: stages, error: stageError } = await supabase
    .from("crm_stage")
    .select("id, name, category")
    .in("category", [...NON_CONVERTING]);
  if (stageError) throw stageError;
  if (!stages || stages.length === 0) return [];

  const stageById = new Map(stages.map((s) => [s.id, s]));

  const { data: leads, error: leadError } = await supabase
    .from("crm_lead")
    .select("*")
    .in("current_stage_id", [...stageById.keys()])
    // Most recently parked first: the consult that just went cold is the one
    // still worth a phone call this week.
    .order("stage_entered_at", { ascending: false });
  if (leadError) throw leadError;

  return (leads ?? []).flatMap((lead) => {
    const stage = stageById.get(lead.current_stage_id);
    return stage ? [{ lead, stageName: stage.name, category: stage.category }] : [];
  });
}

// ── Referral grouping ────────────────────────────────────────────────────────

/** How a blank `referral_source` is labelled. Counted, never hidden. */
const NO_SOURCE = "Not recorded";

type ReferralGroup = {
  source: string;
  matters: Matter[];
  /** True for the synthetic "Not recorded" bucket. */
  unrecorded: boolean;
};

/**
 * Groups matters by `referral_source`.
 *
 * The column is free text typed by a human, so values are folded on trimmed
 * case for grouping while the FIRST spelling seen is what gets displayed —
 * "Tampa Credit Repair" and "tampa credit repair" are one partner, and
 * inventing a canonical capitalisation for a name nobody wrote would be a small
 * lie in a column whose whole value is that it says what she typed.
 */
function groupByReferralSource(matters: readonly Matter[]): ReferralGroup[] {
  // `null` keys the unrecorded bucket. A real source is trimmed and non-empty,
  // so no typed value can ever collide with it - which a sentinel string could.
  const groups = new Map<string | null, ReferralGroup>();

  for (const matter of matters) {
    const raw = matter.referral_source?.trim();
    const unrecorded = !raw;
    const key = unrecorded ? null : raw.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.matters.push(matter);
    } else {
      groups.set(key, {
        source: unrecorded ? NO_SOURCE : raw,
        matters: [matter],
        unrecorded,
      });
    }
  }

  return [...groups.values()].sort((a, b) => {
    // The unrecorded bucket sorts last whatever its size: it is a data-quality
    // fact, not the firm's biggest referral partner.
    if (a.unrecorded !== b.unrecorded) return a.unrecorded ? 1 : -1;
    if (b.matters.length !== a.matters.length) return b.matters.length - a.matters.length;
    return a.source.localeCompare(b.source);
  });
}

function leadName(lead: LeadRow): string {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
  return name || lead.business_name || lead.email;
}

export default async function IntakePage() {
  const session = await requireSession();

  if (session.status !== "ok") {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="grid w-full max-w-lg gap-3 rounded-lg border border-border bg-surface p-7 shadow-[var(--shadow)]">
          <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted">Lectual</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {session.status === "signed-out" ? "Signed out" : "No firm access yet"}
          </h1>
          <p className="text-sm leading-relaxed text-ink-2">
            {session.status === "signed-out"
              ? "Sign in with a magic link to see where the work is coming from."
              : "This account is signed in but isn't a member of a Lectual firm workspace."}
          </p>
          <Link
            href="/sign-in/"
            className="justify-self-start rounded-sm bg-accent px-4 py-2.5 text-sm font-bold text-accent-ink"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  const today = courtToday();
  const [mattersResult, consultsResult] = await Promise.allSettled([
    listMatters(),
    readNonConvertingConsults(),
  ]);

  // `undefined`, never `[]` — a failed read must not render as "no referrals"
  // or as "every consult converted", both of which are cheerful lies.
  const matters = mattersResult.status === "fulfilled" ? mattersResult.value : undefined;
  const consults = consultsResult.status === "fulfilled" ? consultsResult.value : undefined;

  const groups = matters === undefined ? undefined : groupByReferralSource(matters);
  const recordedGroups = groups?.filter((g) => !g.unrecorded).length;

  return (
    <Shell
      wide
      firmName={session.orgName}
      userLabel={session.user.email}
      roleLabel={session.actingAsStaff ? `${session.role} · Lectual staff` : session.role}
    >
      <div className="grid gap-4">
        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">Intake</h1>
          <p className="font-mono text-xs text-muted">{formatDocketDateWithYear(today)}</p>
          <p className="ml-auto text-xs text-muted">Read-only — nothing on this page writes.</p>
        </header>

        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          {/* ── Panel 1: where the matters came from ───────────────────── */}
          <Card
            eyebrow="Referrals"
            title="Where the work comes from"
            meta={
              recordedGroups === undefined ? (
                <span className="text-overdue">unavailable</span>
              ) : (
                <span className="font-mono tabular-nums">
                  {recordedGroups} {recordedGroups === 1 ? "source" : "sources"}
                </span>
              )
            }
            footer={
              <span>
                Grouped from <code className="font-mono text-ink-2">referral_source</code> on each
                matter — free text, so spellings are folded on case but shown as first typed.
              </span>
            }
          >
            {groups === undefined ? (
              <EmptyState
                tone="warning"
                title="Referral sources could not be read"
                description="The matter list failed to load, so this panel can say nothing about where the work came from. Reload before drawing a conclusion."
              />
            ) : groups.length === 0 ? (
              <EmptyState compact title="No matters to group yet." />
            ) : (
              <ul className="grid gap-1.5">
                {groups.map((group) => (
                  <li key={group.source} className="grid gap-1 border-b border-border pb-1.5 last:border-0">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span
                        className={
                          group.unrecorded
                            ? "text-sm italic text-muted"
                            : "text-sm font-semibold text-ink"
                        }
                      >
                        {group.source}
                      </span>
                      <span className="ml-auto font-mono text-sm font-semibold tabular-nums text-ink-2">
                        {group.matters.length}
                      </span>
                    </div>
                    <p className="flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[11px] text-muted">
                      {/* The matter numbers themselves, capped, because "12
                          from this partner" is a number and "which twelve" is
                          the question she asks next. */}
                      {group.matters.slice(0, 8).map((matter) => (
                        <Link
                          key={matter.id}
                          href={`/matter/${matter.id}/`}
                          className="underline underline-offset-2 hover:text-ink-2"
                        >
                          {matter.matter_number}
                        </Link>
                      ))}
                      {group.matters.length > 8 ? (
                        <span>+{group.matters.length - 8} more</span>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* ── Panel 2: the consults that did not become clients ───────── */}
          <Card
            eyebrow="Consults"
            title="Did not convert"
            meta={
              consults === undefined ? (
                <span className="text-overdue">unavailable</span>
              ) : (
                <span className="font-mono tabular-nums">{consults.length}</span>
              )
            }
            footer={
              <span>
                Leads whose stage category is <code className="font-mono text-ink-2">lost</code> or{" "}
                <code className="font-mono text-ink-2">nurture</code>. A nurtured consult has not
                converted either — it is just the half of this list still worth a call.
              </span>
            }
          >
            {consults === undefined ? (
              <EmptyState
                tone="warning"
                title="Consults could not be read"
                description="This panel is empty because a read failed, not because every consult converted. Reload before treating it as good news."
              />
            ) : consults.length === 0 ? (
              <EmptyState
                compact
                title="No non-converting consults recorded"
                description="Nothing is sitting in a lost or nurture stage right now."
              />
            ) : (
              <ul className="grid gap-2">
                {consults.map(({ lead, stageName, category }) => (
                  <li
                    key={lead.id}
                    className="grid gap-1 rounded-sm border border-border bg-surface-2 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-sm font-semibold text-ink">{leadName(lead)}</span>
                      <Badge tone={category === "lost" ? "overdue" : "soon"} dot>
                        {stageName}
                      </Badge>
                      <span className="ml-auto font-mono text-[11px] tabular-nums text-muted">
                        {formatDocketDateTime(lead.stage_entered_at) ?? "—"}
                      </span>
                    </div>

                    {lead.business_name ? (
                      <p className="text-xs text-ink-2">{lead.business_name}</p>
                    ) : null}

                    <p className="flex flex-wrap gap-x-3 text-xs text-muted">
                      <a className="underline underline-offset-2" href={`mailto:${lead.email}`}>
                        {lead.email}
                      </a>
                      {lead.phone ? (
                        <a className="underline underline-offset-2" href={`tel:${lead.phone}`}>
                          {lead.phone}
                        </a>
                      ) : null}
                    </p>

                    {lead.ai_summary ? (
                      <p className="max-w-prose text-[11px] leading-4 text-muted">
                        {lead.ai_summary}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </Shell>
  );
}
