import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import type { Role } from "@/lib/auth/roles";
import { aiConfigured } from "@/lib/ai/claude";
import { orgHasModule } from "@/lib/org/modules";
import { getFirmTimeZone } from "@/lib/org/profile";
import { listMemberDirectory } from "@/lib/members/directory";
import { listTasks } from "@/lib/matters";
import { loadActiveQueue, type QueueLoad } from "@/lib/queue/load";
import { mineQueue } from "@/lib/queue/mine-load";
import { greetingName, greetingSuffix } from "@/lib/today/greeting-name";
import { hourInZone } from "@/lib/today/priorities";
import { civilInZone } from "@/lib/today/outcomes";
import { loadTodayConsults, type TodayConsultsResult } from "@/lib/calendar/consult-sources";
import { consultDepsForViewer } from "@/lib/calendar/consult-deps-view";
import { consultPreview } from "@/lib/views/view-as";
import { DECK_PATH } from "@/lib/views";
import { loadOwnerDeadlines, loadOwnerProposals } from "@/lib/today/owner-load";
import { deadlineChip, deadlineParts, proposalTone, weekdayDate, weekStrip, OWNER_PROPOSALS_SHOWN, OWNER_DEADLINES_SHOWN } from "@/lib/today/owner-rules";
import { TEAM_STEPS_SHOWN, teamNextSteps, teamSeesProposals, type TeamStep } from "@/lib/today/team-rules";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { Pill } from "@/components/ui/Pill";
import { formatDay } from "@/lib/ui/dates";
import type { PillTone } from "@/lib/ui/tones";
import { AddNameLink } from "@/components/account/AddNameLink";
import { OwnerConsults } from "@/components/today/owner/OwnerConsults";
import { WeekStrip } from "@/components/today/owner/WeekStrip";
import { CopilotBox } from "@/components/today/owner/CopilotBox";
import { DeadlineAlertsCard, loadDeadlineAlerts } from "@/components/today/DeadlineAlertsCard";
import "@/components/today/owner/owner-today.css";
import {
  OWNER_CONSULTS_FAILED,
  OWNER_CONSULTS_HEADING,
  OWNER_DEADLINES_FAILED,
  OWNER_DEADLINES_HEADING,
  OWNER_DEADLINES_NONE,
  OWNER_PROPOSAL_LINK_LIVE,
  OWNER_PROPOSALS_FAILED,
  OWNER_PROPOSALS_HEADING,
  OWNER_PROPOSALS_NONE,
  OWNER_WEEK_BOTH_FAILED,
  OWNER_WEEK_CONSULTS_FAILED,
  OWNER_WEEK_DEADLINES_FAILED,
  OWNER_WEEK_HEADING,
  OWNER_WEEK_KEY_CONSULT,
  OWNER_WEEK_KEY_DEADLINE,
  OWNER_WEEK_OPEN_CALENDAR,
  ownerSeeAll,
  TEAM_APPROVALS_FAILED,
  TEAM_APPROVALS_HEADING,
  TEAM_APPROVALS_NONE,
  TEAM_APPROVALS_NOT_CONNECTED,
  TEAM_APPROVALS_OPEN,
  TEAM_STEPS_FAILED,
  TEAM_STEPS_HEADING,
  TEAM_STEPS_NO_DATE,
  TEAM_STEPS_NONE,
  TEAM_STEPS_REVIEW_LINK,
  teamApprovalsWaiting,
} from "@/lib/ui/words";

function longDate(now: Date, tz: string): string {
  return formatDay(now, { tz, now, weekday: "long" }) ?? "";
}
const pillTone = (tone: "risk" | "warn" | "plain"): PillTone => (tone === "plain" ? "mute" : tone);
function greeting(hour: number): string {
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

/**
 * The team view's Today (non-owner staff in a firm with role views): short and calm, like the owner's, and about the
 * person's own work. Every section is its own read (allSettled) and says "Couldn't load ..." when it fails, never an
 * empty list or a zero. Only reads the technician and owner Todays already make, through the scoped client; nothing is
 * written, sent or opened. No money, firm numbers, assistant runs or set-up cards (see AGENTS.md, Team view).
 */
export async function TeamToday({
  userId,
  role,
  email,
  metadata,
  now = new Date(),
}: {
  userId: string;
  role: Role;
  email?: string | null;
  metadata?: Record<string, unknown> | null;
  now?: Date;
}) {
  const alertsP = loadDeadlineAlerts(userId, now);
  const [hasProposalsFeature, tz] = await Promise.all([orgHasModule("proposals").catch(() => false), getFirmTimeZone()]);
  const showProposals = teamSeesProposals(role, hasProposalsFeature);
  const [queueS, tasksS, consultsS, deadlinesS, proposalsS, membersS] = await Promise.allSettled([
    loadActiveQueue(),
    listTasks({ status: "open", assigneeId: userId }),
    loadTodayConsults(now, tz, await consultDepsForViewer(await consultPreview())),
    loadOwnerDeadlines(now, tz),
    showProposals ? loadOwnerProposals(now, tz) : Promise.resolve(null),
    listMemberDirectory(),
  ]);

  const alertsData = await alertsP;
  // loadActiveQueue never throws; a rejection would be a bug, shown as unavailable. The count is the person's OWN (mineQueue).
  const queue: QueueLoad = await mineQueue(queueS.status === "fulfilled" ? queueS.value : { status: "unavailable", items: [] }, { userId, role }).catch((): QueueLoad => ({ status: "unavailable", items: [] }));
  const steps: TeamStep[] | null = tasksS.status === "fulfilled" ? teamNextSteps(tasksS.value, userId, now, tz) : null;
  const consults: TodayConsultsResult | null = consultsS.status === "fulfilled" ? consultsS.value : null;
  const deadlines = deadlinesS.status === "fulfilled" ? deadlinesS.value : null;
  const proposals = proposalsS.status === "fulfilled" ? proposalsS.value : undefined; // null = not shown; undefined = failed
  const members = membersS.status === "fulfilled" ? membersS.value : [];

  const today = civilInZone(now, tz);
  const firstName = greetingName({ userId, members, metadata, email });
  const week = weekStrip({ now, tz, consults: consults ? consults.consults : null, deadlines, proposals: Array.isArray(proposals) ? proposals : null });
  const weekNote =
    consults === null && deadlines === null ? OWNER_WEEK_BOTH_FAILED : consults === null ? OWNER_WEEK_CONSULTS_FAILED : deadlines === null ? OWNER_WEEK_DEADLINES_FAILED : null;

  return (
    <div className="ot-page" data-team-today="">
      <PageHeader
        className="ot-top"
        title={
          <>
            Good {greeting(hourInZone(now, tz))}
            {greetingSuffix(firstName)}.
          </>
        }
        sub={longDate(now, tz)}
        actions={!firstName ? <AddNameLink /> : undefined}
      />

      <div className="ot-cols" style={{ ["--ot-cols" as string]: 2 }}>
        <div className="ot-col-consults">
          <section className="lx-card ot-card" aria-labelledby="tt-approvals-h">
            <div className="ot-card-head">
              <h2 id="tt-approvals-h" className="lx-h3">
                {TEAM_APPROVALS_HEADING}
              </h2>
              {queue.status === "ok" && queue.items.length > 0 && <span className="ot-count">{queue.items.length}</span>}
            </div>
            {queue.status === "unavailable" ? (
              <Notice tone="warn" role="alert">
                {TEAM_APPROVALS_FAILED}
              </Notice>
            ) : queue.status === "unconfigured" ? (
              <EmptyState variant="line">{TEAM_APPROVALS_NOT_CONNECTED}</EmptyState>
            ) : queue.items.length === 0 ? (
              <EmptyState variant="line">{TEAM_APPROVALS_NONE}</EmptyState>
            ) : (
              <p className="ot-row-title">{teamApprovalsWaiting(queue.items.length)}</p>
            )}
            <Link href={DECK_PATH} className="lx-link ot-more">
              {TEAM_APPROVALS_OPEN}
            </Link>
          </section>

          <section className="lx-card ot-card" aria-labelledby="tt-steps-h">
            <div className="ot-card-head">
              <h2 id="tt-steps-h" className="lx-h3">
                {TEAM_STEPS_HEADING}
              </h2>
              {steps !== null && steps.length > 0 && <span className="ot-count">{steps.length}</span>}
            </div>
            {steps === null ? (
              <Notice tone="warn" role="alert">
                {TEAM_STEPS_FAILED}
              </Notice>
            ) : steps.length === 0 ? (
              <EmptyState variant="line">{TEAM_STEPS_NONE}</EmptyState>
            ) : (
              steps.slice(0, TEAM_STEPS_SHOWN).map((s) => (
                <div key={s.id} className="ot-row">
                  <div className="ot-row-main">
                    <Link href={s.href} className="ot-row-title">
                      {s.title}
                    </Link>
                    <span className="ot-sub ot-line">{s.dueDate ? weekdayDate(s.dueDate) : TEAM_STEPS_NO_DATE}</span>
                  </div>
                  {s.chip && <Pill tone={pillTone(s.chip.tone)}>{s.chip.text}</Pill>}
                </div>
              ))
            )}
            {steps !== null && steps.length > TEAM_STEPS_SHOWN && (
              <Link href="/dashboard/review/?who=mine" className="lx-link ot-more">
                {ownerSeeAll(steps.length)}
              </Link>
            )}
            {steps !== null && steps.length > 0 && (
              <Link href="/dashboard/review/" className="lx-link ot-more">
                {TEAM_STEPS_REVIEW_LINK}
              </Link>
            )}
          </section>

          {consults ? (
            <OwnerConsults result={consults} timeZone={tz} today={today} />
          ) : (
            <section className="lx-card ot-card" aria-labelledby="ot-consults-h">
              <h2 id="ot-consults-h" className="lx-h3">
                {OWNER_CONSULTS_HEADING}
              </h2>
              <Notice tone="warn" role="alert">
                {OWNER_CONSULTS_FAILED}
              </Notice>
            </section>
          )}
        </div>

        <div className="ot-col-deadlines">
          <DeadlineAlertsCard data={alertsData} userId={userId} />
          <section className="lx-card ot-card" aria-labelledby="ot-deadlines-h">
            <div className="ot-card-head">
              <h2 id="ot-deadlines-h" className="lx-h3">
                {OWNER_DEADLINES_HEADING}
              </h2>
              {deadlines !== null && deadlines.length > 0 && <span className="ot-count">{deadlines.length}</span>}
            </div>
            {deadlines === null ? (
              <Notice tone="warn" role="alert">
                {OWNER_DEADLINES_FAILED}
              </Notice>
            ) : deadlines.length === 0 ? (
              <EmptyState variant="line">{OWNER_DEADLINES_NONE}</EmptyState>
            ) : (
              deadlines.slice(0, OWNER_DEADLINES_SHOWN).map((d) => {
                const chip = deadlineChip(d, today);
                const parts = deadlineParts(d);
                return (
                  <div key={d.key} className="ot-row">
                    <div className="ot-row-main">
                      <Link href={d.href} className="ot-row-title">
                        {parts.title}
                      </Link>
                      <span className="ot-sub ot-line">
                        <span className="ot-only-wide">{parts.who} &middot; </span>
                        {weekdayDate(d.dueDate)}
                      </span>
                    </div>
                    <Pill tone={pillTone(chip.tone)}>{chip.text}</Pill>
                  </div>
                );
              })
            )}
            {deadlines !== null && deadlines.length > OWNER_DEADLINES_SHOWN && (
              <Link href="/dashboard/calendar/" className="lx-link ot-more">
                {ownerSeeAll(deadlines.length)}
              </Link>
            )}
          </section>

          {proposals !== null && (
            <section className="lx-card ot-card" aria-labelledby="ot-proposals-h">
              <div className="ot-card-head">
                <h2 id="ot-proposals-h" className="lx-h3">
                  {OWNER_PROPOSALS_HEADING}
                </h2>
                {Array.isArray(proposals) && proposals.length > 0 && <span className="ot-count">{proposals.length}</span>}
              </div>
              {proposals === undefined ? (
                <Notice tone="warn" role="alert">
                  {OWNER_PROPOSALS_FAILED}
                </Notice>
              ) : proposals.length === 0 ? (
                <EmptyState variant="line">{OWNER_PROPOSALS_NONE}</EmptyState>
              ) : (
                proposals.slice(0, OWNER_PROPOSALS_SHOWN).map((p) => (
                  <div key={p.id} className="ot-row">
                    <div className="ot-row-main">
                      <Link href={p.href} className="ot-row-title">
                        {p.client} &middot; {p.title}
                      </Link>
                      <span className="ot-sub ot-line ot-only-wide">{OWNER_PROPOSAL_LINK_LIVE}</span>
                    </div>
                    <Pill tone={pillTone(proposalTone(p, today))}>{p.expiry}</Pill>
                  </div>
                ))
              )}
              {Array.isArray(proposals) && proposals.length > OWNER_PROPOSALS_SHOWN && (
                <Link href="/dashboard/proposals/" className="lx-link ot-more">
                  {ownerSeeAll(proposals.length)}
                </Link>
              )}
            </section>
          )}
        </div>
      </div>

      <section className="lx-card ot-card ot-week-card" aria-labelledby="ot-week-h">
        <div className="ot-card-head">
          <h2 id="ot-week-h" className="lx-h3">
            {OWNER_WEEK_HEADING}
          </h2>
          <span className="ot-count">
            <span className="ot-only-narrow">
              <span className="ot-key ot-key-consult" /> {OWNER_WEEK_KEY_CONSULT} <span className="ot-key ot-key-deadline" /> {OWNER_WEEK_KEY_DEADLINE}
            </span>
            <span className="ot-only-wide">
              <Link href="/dashboard/calendar/" className="lx-link">
                {OWNER_WEEK_OPEN_CALENDAR}
              </Link>
            </span>
          </span>
        </div>
        <WeekStrip days={week} />
        {weekNote && (
          <Notice tone="warn" role="alert">
            {weekNote}
          </Notice>
        )}
      </section>

      {aiConfigured() && <CopilotBox />}
    </div>
  );
}
