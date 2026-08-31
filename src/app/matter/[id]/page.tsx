import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Shell } from "@/components/Shell";
import { SuggestionChip } from "@/components/SuggestionChip";
import { UrgencyBadge } from "@/components/UrgencyBadge";
import { requireSession } from "@/lib/auth/session";
import { toCourtDateTimeLocal } from "@/lib/court-time";
import {
  computeAnswerClock,
  weekendCaution,
  type AnswerClock,
} from "@/lib/deadlines/answer-clock";
import {
  deadlineKindLabel,
  deadlineSourceLabel,
  deadlineStatusLabel,
  deadlineTitle,
} from "@/lib/deadlines/kinds";
import { listDeadlinesForMatter, type OpenDeadline } from "@/lib/deadlines/read";
import { urgencyBand, urgencyPhrase } from "@/lib/deadlines/urgency";
import {
  FEE_KINDS,
  FEE_KIND_LABEL,
  balanceIsOutstanding,
  hasFeeEntries,
  matterFeeLedger,
  type FeeLedger,
} from "@/lib/fees";
import {
  courtToday,
  formatDocketDate,
  formatDocketDateTime,
  formatDocketDateWithYear,
  isCivilDate,
} from "@/lib/format/date";
import { getMatterFile, type ActivityRow, type MatterContact, type TaskRow } from "@/lib/matters/read";
import {
  DEADLINE_CONFIRM_ROLES,
  MATTER_WRITE_ROLES,
  type LitigationDetailRow,
} from "@/lib/matters/write";
import { practiceLabel, resolvePractice } from "@/lib/practice/resolve";
import {
  addNoteAction,
  addTaskAction,
  closeDeadlineAction,
  completeTaskAction,
  confirmDeadlineAction,
  docketAnswerDate,
  saveLitigationDetail,
} from "./actions";

/**
 * `/matter/[id]` — the case file.
 *
 * One screen holding everything the firm knows about one matter: the docket,
 * the litigation facts, the tasks, the people, the timeline, and the money the
 * tracker recorded. A Server Component throughout — every mutation is a plain
 * `<form action={serverAction}>`, so the page works with JavaScript disabled
 * and a refusal survives a reload as a query parameter rather than evaporating
 * with some client state.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOUR THINGS THIS PAGE IS CAREFUL ABOUT
 *
 * THE MATTER NUMBER IS THE COURT CASE NUMBER. For this firm `matter_number`
 * holds `26-CC-011354` — the number the clerk calls. It is the page's heading,
 * in mono, selectable, above everything else, because it is the string she
 * types into a court portal ten times a day.
 *
 * A HEARING IS SHOWN IN COURT TIME, WITH THE ZONE NAMED. `next_hearing_at` is a
 * `timestamptz`; the hearing stored `2026-08-25T14:00:00Z` is a 10:00 AM EDT
 * appearance, and rendering "2:00 PM" is precisely how a pretrial conference
 * gets missed. Every instant on this page goes through `formatDocketDateTime`,
 * which renders it on the court's day, with its weekday and the zone named.
 *
 * A COMPUTED DATE IS A SUGGESTION AND IS NEVER ON THE DOCKET. The answer clock
 * renders through `SuggestionChip` — dashed, no urgency colour, carrying the
 * "not on the docket" sentence — and nothing about it is counted, banded or
 * calendared. It becomes a docket entry only when she submits the form, and
 * what is then written is `source: 'manual'` with her own basis sentence.
 *
 * FEES ARE PRINTED VERBATIM AND THERE IS NO TOTALS ROW. The amounts are the
 * strings the firm's tracker recorded — "$4,750", "$0.00" — and nothing here
 * parses one, recomputes a balance, or sums a column. A total over verbatim
 * strings is a figure the record does not contain, and showing an attorney a
 * number her file does not say is worse than showing her nothing.
 *
 * NO `org_id` FILTER ANYWHERE. Every read is through an RLS-scoped client; the
 * reads all live in `@/lib/*`, and this file adds no query of its own.
 */

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MatterPage({ params, searchParams }: PageProps) {
  const session = await requireSession();

  if (session.status === "signed-out") {
    return (
      <AccessPanel title="Signed out">
        <p className="text-sm leading-relaxed text-ink-2">
          Sign in with a magic link to open this case file.
        </p>
        <Link
          href="/sign-in/"
          className="justify-self-start rounded-sm bg-accent px-4 py-2.5 text-sm font-bold text-accent-ink"
        >
          Sign in
        </Link>
      </AccessPanel>
    );
  }

  if (session.status === "no-access") {
    return (
      <AccessPanel title="No firm access yet">
        <p className="text-sm leading-relaxed text-ink-2">
          {session.user.email ?? "This account"} is signed in but isn&apos;t a member of a
          Lectual firm workspace, so no matter is visible to it.
        </p>
      </AccessPanel>
    );
  }

  const { id } = await params;
  const query = await searchParams;

  const file = await getMatterFile(id);
  // "Deleted" and "not yours" are deliberately the same answer: RLS hides
  // another firm's matter, and this page must not confirm that it exists.
  if (!file) notFound();

  const [deadlinesResult, feesResult] = await Promise.allSettled([
    listDeadlinesForMatter(id),
    matterFeeLedger(id),
  ]);
  // `undefined`, never `[]` — "we could not read the docket" and "this matter
  // has no deadlines" are opposite statements and must not render alike.
  const deadlines = deadlinesResult.status === "fulfilled" ? deadlinesResult.value : undefined;
  const fees = feesResult.status === "fulfilled" ? feesResult.value : undefined;

  const { matter, litigation, contacts, tasks, activity } = file;
  const today = courtToday();
  const practice = resolvePractice(matter, matter.stage);
  const canWrite = MATTER_WRITE_ROLES.includes(session.role);
  const canConfirm = DEADLINE_CONFIRM_ROLES.includes(session.role);

  const notice = firstParam(query.notice);
  const error = firstParam(query.error);
  const blockingId = firstParam(query.existing);
  const blocking = blockingId ? deadlines?.find((d) => d.id === blockingId) ?? null : null;

  // The answer clock's anchor. Typed into the panel's own GET form, and
  // prefilled from any docket row already anchored to a service date so the
  // number she entered last time is the number she sees this time.
  const servedParam = firstParam(query.servedOn);
  const anchoredRow = deadlines?.find(
    (d) => d.anchor_event === "service" && isCivilDate(d.anchor_date),
  );
  const servedOn = isCivilDate(servedParam)
    ? servedParam
    : (anchoredRow?.anchor_date ?? null);
  const clock: AnswerClock | null =
    servedOn && isCivilDate(servedOn) ? computeAnswerClock({ servedOn }) : null;

  const openDeadlines = (deadlines ?? []).filter((d) => d.status === "open");
  const closedDeadlines = (deadlines ?? []).filter((d) => d.status !== "open");
  const client = contacts.find((c) => c.link_role.trim().toLowerCase() === "client") ?? null;

  return (
    <Shell
      wide
      firmName={session.orgName}
      userLabel={session.user.email}
      roleLabel={session.actingAsStaff ? `${session.role} · Lectual staff` : session.role}
    >
      <div className="grid gap-4">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="grid gap-2">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            Case file
          </p>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {/* The court case number. This firm's matter_number IS it. */}
            <h1 className="select-all font-mono text-2xl font-semibold tracking-[-0.01em] text-ink">
              {matter.matter_number}
            </h1>
            {matter.title ? (
              <p className="min-w-0 truncate text-[15px] text-ink-2">{matter.title}</p>
            ) : null}
          </div>

          <dl className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
            <HeaderFact label="Client">
              {client ? contactName(client) : (matter.owner_name ?? "—")}
            </HeaderFact>
            <HeaderFact label="Stage">
              {matter.stage ? (
                <Badge tone="neutral" mono title={`Stage code ${matter.stage.code}`}>
                  {matter.stage.label}
                </Badge>
              ) : (
                // Not an error and not an empty value: 22 of this firm's 34
                // live litigation matters are deliberately unplaced, awaiting
                // her judgment. The board pins them in their own lane.
                <Badge tone="soon" title="No stage set — this matter is deliberately unplaced.">
                  Unplaced
                </Badge>
              )}
            </HeaderFact>
            <HeaderFact label="Practice">{practiceLabel(practice)}</HeaderFact>
            <HeaderFact label="Status">{matter.status}</HeaderFact>
            {matter.referral_source ? (
              <HeaderFact label="Referred by">{matter.referral_source}</HeaderFact>
            ) : null}
          </dl>
        </header>

        {notice ? (
          <p
            role="status"
            className="rounded-md border border-border-strong bg-surface px-3 py-2 text-xs font-semibold text-ink-2"
          >
            {notice}
          </p>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="grid gap-2 rounded-md border border-overdue-border bg-overdue-bg px-3 py-2 text-xs text-overdue"
          >
            <p className="font-semibold">{error}</p>
            {/* The "already open" collision. Rather than a Postgres constraint
                name, she gets the row that is in the way and a way through it:
                close the standing entry as SUPERSEDED — a court moving a date
                is a replacement, not a completion — then docket the new one. */}
            {blocking ? (
              <form action={closeDeadlineAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="matterId" value={matter.id} />
                <input type="hidden" name="deadlineId" value={blocking.id} />
                <input type="hidden" name="status" value="superseded" />
                <span className="text-ink-2">
                  Standing entry: {deadlineTitle(blocking)} ·{" "}
                  {formatDocketDateWithYear(blocking.due_date)}
                </span>
                <button
                  type="submit"
                  disabled={!canWrite}
                  className="rounded-sm border border-border-strong bg-surface px-2.5 py-1 text-xs font-semibold text-ink-2 disabled:opacity-50"
                >
                  Close it as superseded
                </button>
              </form>
            ) : null}
          </div>
        ) : null}

        {/* ── Deadlines ──────────────────────────────────────────────────── */}
        <Card
          id="deadlines"
          eyebrow="Docket"
          title="Deadlines"
          meta={
            deadlines === undefined ? (
              <span className="text-overdue">unavailable</span>
            ) : (
              <span className="font-mono tabular-nums">
                {openDeadlines.length} open · {closedDeadlines.length} closed
              </span>
            )
          }
        >
          {deadlines === undefined ? (
            <EmptyState
              tone="warning"
              title="The docket could not be read"
              description="This is a failure, not an empty docket. Nothing on this card says anything about what is due on this matter — reload, and check the court docket directly before relying on it."
            />
          ) : openDeadlines.length === 0 && closedDeadlines.length === 0 ? (
            <EmptyState
              title="Nothing docketed on this matter yet"
              description="Dates entered here are what the deadline hero on Today reads. Nothing is calculated for you."
            />
          ) : (
            <div className="grid gap-3">
              {openDeadlines.length > 0 ? (
                <ul className="grid gap-2">
                  {openDeadlines.map((d) => (
                    <DeadlineRow
                      key={d.id}
                      deadline={d}
                      today={today}
                      matterId={matter.id}
                      canWrite={canWrite}
                      canConfirm={canConfirm}
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted">No open deadlines on this matter.</p>
              )}

              {closedDeadlines.length > 0 ? (
                <details className="rounded-sm border border-border bg-surface-2 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-semibold text-ink-2">
                    Closed entries ({closedDeadlines.length})
                  </summary>
                  {/* History, not clutter. Nothing is ever deleted from this
                      docket; what was due and what happened to it both stay. */}
                  <ul className="mt-2 grid gap-1.5">
                    {closedDeadlines.map((d) => (
                      <li
                        key={d.id}
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted"
                      >
                        <span className="font-mono tabular-nums text-ink-2">
                          {formatDocketDateWithYear(d.due_date)}
                        </span>
                        <span className="text-ink-2">{deadlineTitle(d)}</span>
                        <span>· {deadlineStatusLabel(d.status)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          )}
        </Card>

        {/* ── The answer clock ───────────────────────────────────────────── */}
        {matter.type === "LIT" ? (
          <Card
            id="answer-clock"
            eyebrow="Answer clock"
            title="Count 20 days from service"
            meta={<span>suggestion only</span>}
          >
            <div className="grid gap-3">
              <p className="max-w-prose text-xs leading-5 text-muted">
                Enter the date of service and this counts the days for you. It does not put
                anything on the docket, does not move a date off a weekend, and is never
                counted in the deadline totals on Today. Whether the interval and the weekday
                are right is your call, not the software&apos;s.
              </p>

              {/* A GET form: computing a suggestion is a read, so it belongs in
                  the URL where it can be linked and reloaded, not in a write. */}
              <form method="get" className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-xs font-semibold text-ink-2">
                  Date of service
                  <input
                    type="date"
                    name="servedOn"
                    defaultValue={servedOn ?? ""}
                    className="rounded-sm border border-border-strong bg-surface px-2 py-1.5 font-mono text-sm text-ink"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-sm border border-border-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-2"
                >
                  Count the days
                </button>
              </form>

              {clock ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <SuggestionChip
                    label="Answer due"
                    date={clock.answerDue}
                    basis={clock.basis}
                    caution={weekendCaution(clock)}
                    actions={
                      <DocketSuggestionForm
                        matterId={matter.id}
                        servedOn={clock.servedOn}
                        which="answer"
                        disabled={!canWrite}
                      />
                    }
                  />
                  <SuggestionChip
                    label="Default may be sought"
                    date={clock.defaultEligibleOn}
                    basis="The day after the answer date, on the same standing rule. Whether a default is available is a determination for the attorney and the docket."
                    actions={
                      <DocketSuggestionForm
                        matterId={matter.id}
                        servedOn={clock.servedOn}
                        which="default"
                        disabled={!canWrite}
                      />
                    }
                  />
                </div>
              ) : (
                <p className="text-xs text-muted">
                  No service date entered, so there is nothing to count from.
                </p>
              )}
            </div>
          </Card>
        ) : null}

        {/* ── Litigation detail ──────────────────────────────────────────── */}
        {matter.type === "LIT" ? (
          <LitigationCard
            matterId={matter.id}
            detail={litigation}
            canWrite={canWrite}
          />
        ) : null}

        {/* ── Tasks ──────────────────────────────────────────────────────── */}
        <Card
          id="tasks"
          eyebrow="Work"
          title="Tasks"
          meta={
            <span className="font-mono tabular-nums">
              {tasks.filter((t) => t.status === "open").length} open
            </span>
          }
        >
          <div className="grid gap-3">
            {tasks.length === 0 ? (
              <EmptyState compact title="No tasks on this matter." />
            ) : (
              <ul className="grid gap-1.5">
                {tasks.map((task) => (
                  <TaskRowItem
                    key={task.id}
                    task={task}
                    matterId={matter.id}
                    canWrite={canWrite}
                  />
                ))}
              </ul>
            )}

            {canWrite ? (
              <form
                action={addTaskAction}
                className="flex flex-wrap items-end gap-2 border-t border-border pt-3"
              >
                <input type="hidden" name="matterId" value={matter.id} />
                <label className="grid min-w-[16rem] flex-1 gap-1 text-xs font-semibold text-ink-2">
                  New task
                  <input
                    name="title"
                    required
                    placeholder="File default, Barrios"
                    className="rounded-sm border border-border-strong bg-surface px-2 py-1.5 text-sm text-ink"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-ink-2">
                  Due (court time)
                  <input
                    type="datetime-local"
                    name="dueAt"
                    className="rounded-sm border border-border-strong bg-surface px-2 py-1.5 font-mono text-sm text-ink"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-sm bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink"
                >
                  Add task
                </button>
              </form>
            ) : null}
          </div>
        </Card>

        {/* ── Contacts ───────────────────────────────────────────────────── */}
        <Card id="contacts" eyebrow="People" title="Contacts">
          {contacts.length === 0 ? (
            <EmptyState compact title="No contacts linked to this matter." />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {contacts.map((contact) => (
                <li
                  key={contact.id}
                  className="grid gap-0.5 rounded-sm border border-border bg-surface-2 px-3 py-2"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold text-ink">
                      {contactName(contact)}
                    </span>
                    {contact.link_role ? (
                      <Badge tone="neutral" mono>
                        {contact.link_role}
                      </Badge>
                    ) : null}
                  </div>
                  {contact.company_name || contact.business_name ? (
                    <p className="text-xs text-ink-2">
                      {contact.company_name ?? contact.business_name}
                    </p>
                  ) : null}
                  <p className="flex flex-wrap gap-x-3 text-xs text-muted">
                    {contact.email ? (
                      <a className="underline underline-offset-2" href={`mailto:${contact.email}`}>
                        {contact.email}
                      </a>
                    ) : null}
                    {contact.phone ? (
                      <a className="underline underline-offset-2" href={`tel:${contact.phone}`}>
                        {contact.phone}
                      </a>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── Recent activity ────────────────────────────────────────────── */}
        <Card
          id="activity"
          eyebrow="Timeline"
          title="Recent activity"
          meta={<span>append-only</span>}
        >
          <div className="grid gap-3">
            {activity.length === 0 ? (
              <EmptyState compact title="Nothing on this matter's timeline yet." />
            ) : (
              <ol className="grid gap-1.5">
                {activity.map((row) => (
                  <li
                    key={row.id}
                    className="grid gap-0.5 border-l-2 border-border pl-3 text-xs"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 text-muted">
                      <time
                        dateTime={row.created_at}
                        className="font-mono tabular-nums text-ink-2"
                      >
                        {formatDocketDateTime(row.created_at) ?? row.created_at}
                      </time>
                      <span className="font-mono uppercase tracking-[0.06em]">
                        {row.type.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="text-ink-2">{activitySummary(row)}</p>
                  </li>
                ))}
              </ol>
            )}

            {canWrite ? (
              <form action={addNoteAction} className="grid gap-2 border-t border-border pt-3">
                <input type="hidden" name="matterId" value={matter.id} />
                <label className="grid gap-1 text-xs font-semibold text-ink-2">
                  Add a note
                  <textarea
                    name="body"
                    rows={3}
                    required
                    className="rounded-sm border border-border-strong bg-surface px-2 py-1.5 text-sm text-ink"
                  />
                </label>
                {/* Said before the box is submitted, not after. The table is
                    trigger-blocked against UPDATE and DELETE for every role,
                    the service role included. */}
                <p className="text-[11px] text-muted">
                  A note cannot be edited or deleted once it is saved — the timeline is
                  append-only for everyone, including us.
                </p>
                <button
                  type="submit"
                  className="justify-self-start rounded-sm bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink"
                >
                  Save note
                </button>
              </form>
            ) : null}
          </div>
        </Card>

        {/* ── Fees ───────────────────────────────────────────────────────── */}
        <FeesCard ledger={fees} />
      </div>
    </Shell>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

function HeaderFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="font-mono text-[10px] uppercase tracking-[0.09em] text-muted">{label}</dt>
      <dd className="text-xs font-semibold text-ink-2">{children}</dd>
    </div>
  );
}

function contactName(contact: MatterContact): string {
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim();
  return name || contact.company_name || contact.business_name || contact.email || "Unnamed contact";
}

// ── Deadlines ────────────────────────────────────────────────────────────────

/**
 * One open docket row: its band, its date, where the date came from, and the
 * two things that can be done to it.
 *
 * The unconfirmed marker is loud on purpose. `attorney_confirmed = false` means
 * nobody has checked this date against the office record, and a date on a
 * screen reads as authoritative whether or not anyone has.
 */
function DeadlineRow({
  deadline,
  today,
  matterId,
  canWrite,
  canConfirm,
}: {
  deadline: OpenDeadline;
  today: string;
  matterId: string;
  canWrite: boolean;
  canConfirm: boolean;
}) {
  const band = urgencyBand(deadline.due_date, today);

  return (
    <li className="grid gap-1.5 rounded-sm border border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <UrgencyBadge band={band} detail={urgencyPhrase(deadline.due_date, today)} />
        <time
          dateTime={deadline.due_date}
          className="font-mono text-sm font-semibold tabular-nums text-ink"
        >
          {formatDocketDateWithYear(deadline.due_date)}
        </time>
        <span className="text-sm text-ink-2">{deadlineTitle(deadline)}</span>
        {deadline.attorney_confirmed ? (
          <Badge tone="neutral">Confirmed</Badge>
        ) : (
          <Badge tone="soon" title="No attorney has checked this date against the office record.">
            Unconfirmed
          </Badge>
        )}
      </div>

      <p className="text-[11px] leading-4 text-muted">
        {deadlineKindLabel(deadline.kind)} · {deadlineSourceLabel(deadline.source)}
        {deadline.anchor_event ? (
          <>
            {" · runs from "}
            {deadline.anchor_event}
            {deadline.anchor_date ? ` on ${formatDocketDate(deadline.anchor_date)}` : ""}
          </>
        ) : null}
      </p>

      {deadline.calculation_basis ? (
        <p className="max-w-prose text-[11px] leading-4 text-muted">
          {deadline.calculation_basis}
        </p>
      ) : null}

      {deadline.notes ? (
        <p className="max-w-prose text-[11px] leading-4 text-ink-2">{deadline.notes}</p>
      ) : null}

      {canWrite || canConfirm ? (
        <div className="flex flex-wrap gap-2 pt-0.5">
          {/* Attorney-and-owner only. The button is hidden from everyone else
              and the action re-checks the role regardless — a server action is
              a public endpoint, and hiding a button is not a permission. */}
          {canConfirm && !deadline.attorney_confirmed ? (
            <form action={confirmDeadlineAction}>
              <input type="hidden" name="matterId" value={matterId} />
              <input type="hidden" name="deadlineId" value={deadline.id} />
              <button
                type="submit"
                className="rounded-sm border border-border-strong px-2.5 py-1 text-xs font-semibold text-ink-2"
              >
                Confirm this date
              </button>
            </form>
          ) : null}
          {canWrite ? (
            <form action={closeDeadlineAction}>
              <input type="hidden" name="matterId" value={matterId} />
              <input type="hidden" name="deadlineId" value={deadline.id} />
              <input type="hidden" name="status" value="satisfied" />
              <button
                type="submit"
                className="rounded-sm border border-border-strong px-2.5 py-1 text-xs font-semibold text-ink-2"
              >
                Mark satisfied
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The docket button under a suggestion chip.
 *
 * It posts the SERVICE date, not the suggested date. The action recomputes the
 * clock server-side, so the only thing this form can influence is the anchor —
 * and the anchor is the one number the attorney actually typed.
 */
function DocketSuggestionForm({
  matterId,
  servedOn,
  which,
  disabled,
}: {
  matterId: string;
  servedOn: string;
  which: "answer" | "default";
  disabled: boolean;
}) {
  return (
    <form action={docketAnswerDate}>
      <input type="hidden" name="matterId" value={matterId} />
      <input type="hidden" name="servedOn" value={servedOn} />
      <input type="hidden" name="which" value={which} />
      <button
        type="submit"
        disabled={disabled}
        className="rounded-sm bg-accent px-2.5 py-1 text-xs font-semibold text-accent-ink disabled:opacity-50"
      >
        Docket this date
      </button>
    </form>
  );
}

// ── Litigation detail ────────────────────────────────────────────────────────

/**
 * The litigation facts, shown and editable in place.
 *
 * `next_hearing_at` is the field this whole product exists for: it is read back
 * through `formatDocketDateTime` so the weekday, the wall clock and the zone are
 * all on screen, and edited through a `datetime-local` whose reading the action
 * interprets in `America/New_York` rather than in the browser's zone.
 */
function LitigationCard({
  matterId,
  detail,
  canWrite,
}: {
  matterId: string;
  detail: LitigationDetailRow | null;
  canWrite: boolean;
}) {
  const hearing = formatDocketDateTime(detail?.next_hearing_at ?? null);

  return (
    <Card id="litigation" eyebrow="Court" title="Litigation detail">
      <div className="grid gap-4">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="County">{detail?.county}</Fact>
          <Fact label="Division">{detail?.court_division}</Fact>
          <Fact label="Judge">{detail?.judge}</Fact>
          <Fact label="Case style">{detail?.case_style}</Fact>
          <Fact label="Case number">{detail?.case_number}</Fact>
          <Fact label="Our role">{detail?.role}</Fact>
          <Fact label="Filed">
            {detail?.filed_on ? formatDocketDateWithYear(detail.filed_on) : null}
          </Fact>
          <Fact label="Case status">{detail?.case_status}</Fact>
          <Fact label="Default status">{detail?.default_status}</Fact>
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="font-mono text-[10px] uppercase tracking-[0.09em] text-muted">
              Next hearing
            </dt>
            <dd className="text-sm font-semibold text-ink">
              {hearing ? (
                <>
                  {/* Court time, zone named. A hearing stored 14:00Z is a
                      10:00 AM EDT appearance. */}
                  <span className="font-mono tabular-nums">{hearing}</span>
                  {detail?.next_hearing_purpose ? (
                    <span className="ml-2 text-xs font-normal text-ink-2">
                      {detail.next_hearing_purpose}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-muted">— no hearing set</span>
              )}
            </dd>
          </div>
        </dl>

        {detail?.notes ? (
          <p className="max-w-prose whitespace-pre-line rounded-sm bg-surface-2 px-3 py-2 text-xs leading-5 text-ink-2">
            {detail.notes}
          </p>
        ) : null}

        {canWrite ? (
          <details className="rounded-sm border border-border bg-surface-2 px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-ink-2">
              Edit litigation detail
            </summary>
            <form action={saveLitigationDetail} className="mt-3 grid gap-3">
              <input type="hidden" name="matterId" value={matterId} />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field name="county" label="County" defaultValue={detail?.county} />
                <Field
                  name="courtDivision"
                  label="Division"
                  defaultValue={detail?.court_division}
                />
                <Field name="judge" label="Judge" defaultValue={detail?.judge} />
                <Field name="caseStyle" label="Case style" defaultValue={detail?.case_style} />
                <Field name="caseNumber" label="Case number" defaultValue={detail?.case_number} />
                <Field name="role" label="Our role" defaultValue={detail?.role} />
                <Field
                  name="filedOn"
                  label="Filed on"
                  type="date"
                  defaultValue={detail?.filed_on}
                />
                <Field name="caseStatus" label="Case status" defaultValue={detail?.case_status} />
                <Field
                  name="defaultStatus"
                  label="Default status"
                  defaultValue={detail?.default_status}
                />
                <Field
                  name="noticeOfAppearance"
                  label="Notice of appearance"
                  defaultValue={detail?.notice_of_appearance}
                />
                <Field
                  name="motionToDismiss"
                  label="Motion to dismiss"
                  defaultValue={detail?.motion_to_dismiss}
                />
                <Field
                  name="missedHearing"
                  label="Missed hearing"
                  defaultValue={detail?.missed_hearing}
                />
                <Field
                  name="nextHearingAt"
                  label="Next hearing (court time, ET)"
                  type="datetime-local"
                  defaultValue={toCourtDateTimeLocal(detail?.next_hearing_at ?? null)}
                />
                <Field
                  name="nextHearingPurpose"
                  label="Hearing purpose"
                  defaultValue={detail?.next_hearing_purpose}
                />
              </div>

              <label className="grid gap-1 text-xs font-semibold text-ink-2">
                Notes
                <textarea
                  name="notes"
                  rows={3}
                  defaultValue={detail?.notes ?? ""}
                  className="rounded-sm border border-border-strong bg-surface px-2 py-1.5 text-sm text-ink"
                />
              </label>

              <p className="text-[11px] text-muted">
                The hearing time is read as Eastern — the court&apos;s own clock — whatever zone
                this browser is in. An emptied box clears that field; a field this form
                doesn&apos;t show is left untouched.
              </p>

              <button
                type="submit"
                className="justify-self-start rounded-sm bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink"
              >
                Save litigation detail
              </button>
            </form>
          </details>
        ) : null}
      </div>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.09em] text-muted">{label}</dt>
      <dd className="truncate text-sm text-ink-2">{children || <span className="text-muted">—</span>}</dd>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = "text",
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
  type?: string;
}) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-ink-2">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        className="rounded-sm border border-border-strong bg-surface px-2 py-1.5 text-sm text-ink"
      />
    </label>
  );
}

// ── Tasks ────────────────────────────────────────────────────────────────────

function TaskRowItem({
  task,
  matterId,
  canWrite,
}: {
  task: TaskRow;
  matterId: string;
  canWrite: boolean;
}) {
  const open = task.status === "open";
  const due = formatDocketDateTime(task.due_at);

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-1.5 last:border-0">
      <span
        className={
          open ? "text-sm text-ink" : "text-sm text-muted line-through decoration-border-strong"
        }
      >
        {task.title}
      </span>
      <span className="font-mono text-[11px] tabular-nums text-muted">{due ?? "no date"}</span>
      {!open ? <Badge tone="neutral">{task.status}</Badge> : null}
      {open && canWrite ? (
        <form action={completeTaskAction} className="ml-auto">
          <input type="hidden" name="matterId" value={matterId} />
          <input type="hidden" name="taskId" value={task.id} />
          <button
            type="submit"
            className="rounded-sm border border-border-strong px-2 py-0.5 text-[11px] font-semibold text-ink-2"
          >
            Complete
          </button>
        </form>
      ) : null}
    </li>
  );
}

// ── Activity ─────────────────────────────────────────────────────────────────

/**
 * A one-line reading of a timeline row.
 *
 * Deliberately conservative: a payload shape nobody has designed a sentence for
 * renders as its type rather than as JSON or as a crash. The timeline is a
 * record of what happened, not a second copy of the file.
 */
function activitySummary(row: ActivityRow): string {
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {};

  const read = (key: string): string | null => {
    const value = payload[key];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  };

  if (row.type === "note") return read("body") ?? "Note";
  if (row.type === "stage_changed") {
    const from = read("from_label") ?? "Unplaced";
    const to = read("to_label") ?? "Unplaced";
    return `Stage moved: ${from} → ${to}`;
  }

  const change = read("change");
  if (change === "deadline_docketed") {
    return `Deadline docketed: ${read("label") ?? "deadline"} · ${read("due_date") ?? "no date"}`;
  }
  if (change === "deadline_confirmed") return "An attorney confirmed a docket date.";
  if (change === "deadline_closed") {
    return `Deadline closed as ${read("status") ?? "closed"}.`;
  }
  if (change === "litigation_detail") return "Litigation detail updated.";

  return row.type.replace(/_/g, " ");
}

// ── Fees ─────────────────────────────────────────────────────────────────────

/**
 * The fee ledger, rendered exactly as the tracker recorded it.
 *
 * THERE IS NO TOTALS ROW AND THERE MUST NOT BE ONE. The amounts are verbatim
 * strings — "$4,750", "$0.00" — and summing them would mean parsing them, which
 * would mean showing an attorney a figure her own record does not contain. The
 * only thing derived from an amount anywhere on this page is
 * `balanceIsOutstanding`, which picks a colour and never a number.
 */
function FeesCard({ ledger }: { ledger: FeeLedger | undefined }) {
  if (ledger === undefined) {
    return (
      <Card id="fees" eyebrow="Money" title="Fees">
        <EmptyState
          tone="warning"
          title="The fee record could not be read"
          description="Nothing here says anything about what is owed on this matter. Reload before drawing a conclusion."
        />
      </Card>
    );
  }

  if (!hasFeeEntries(ledger)) {
    return (
      <Card id="fees" eyebrow="Money" title="Fees">
        <EmptyState compact title="No fee record on this matter." />
      </Card>
    );
  }

  return (
    <Card
      id="fees"
      eyebrow="Money"
      title="Fees"
      footer={
        <span>
          Shown exactly as the firm&apos;s tracker recorded them. Nothing on this card is
          parsed, recomputed or totalled.
        </span>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-[0.09em] text-muted">
              <th className="py-1 pr-3 font-semibold">Kind</th>
              <th className="py-1 pr-3 font-semibold">Total</th>
              <th className="py-1 pr-3 font-semibold">Paid</th>
              <th className="py-1 pr-3 font-semibold">Balance</th>
              <th className="py-1 font-semibold">Due</th>
            </tr>
          </thead>
          <tbody>
            {FEE_KINDS.map((kind) => {
              const entry = ledger[kind];
              if (!entry) return null;
              const outstanding = balanceIsOutstanding(entry.balance);
              return (
                <tr key={kind} className="border-t border-border align-baseline">
                  <td className="py-1.5 pr-3 text-ink-2">{FEE_KIND_LABEL[kind]}</td>
                  <td className="py-1.5 pr-3 font-mono tabular-nums text-ink">
                    {entry.total ?? "—"}
                  </td>
                  <td className="py-1.5 pr-3 font-mono tabular-nums text-ink">
                    {entry.paid ?? "—"}
                  </td>
                  <td
                    className={`py-1.5 pr-3 font-mono tabular-nums ${
                      outstanding ? "font-semibold text-overdue" : "text-ink"
                    }`}
                  >
                    {entry.balance ?? "—"}
                  </td>
                  <td className="py-1.5 font-mono text-xs tabular-nums text-muted">
                    {entry.dueDate ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {/* No <tfoot>. See the note on this component. */}
        </table>
      </div>
    </Card>
  );
}

// ── Access ───────────────────────────────────────────────────────────────────

function AccessPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="grid w-full max-w-lg gap-3 rounded-lg border border-border bg-surface p-7 shadow-[var(--shadow)]">
        <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted">Lectual</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {children}
      </div>
    </main>
  );
}
