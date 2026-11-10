import Link from "next/link";
import type { Role } from "@/lib/auth/roles";
import { aiConfigured } from "@/lib/ai/claude";
import { orgHasModule } from "@/lib/org/modules";
import { getFirmTimeZone } from "@/lib/org/profile";
import { listMemberDirectory } from "@/lib/members/directory";
import { greetingName, greetingSuffix } from "@/lib/today/greeting-name";
import { hourInZone } from "@/lib/today/priorities";
import { civilInZone } from "@/lib/today/outcomes";
import { loadDeckSummary, type DeckSummary } from "@/lib/queue/deck-summary";
import { loadTodayConsults, type TodayConsultsResult } from "@/lib/calendar/consult-sources";
import { liveConsultDeps } from "@/lib/calendar/consult-sources-live";
import { loadOwnerDeadlines, loadOwnerProposals } from "@/lib/today/owner-load";
import { cardsLine, dueText, OWNER_PROPOSALS_SHOWN, OWNER_DEADLINES_SHOWN, weekStrip } from "@/lib/today/owner-rules";
import { DECK_PATH } from "@/lib/views";
import { AddNameLink } from "@/components/account/AddNameLink";
import { TodayConsultsView } from "@/components/calendar/TodayConsults";
import { WeekStrip } from "@/components/today/owner/WeekStrip";
import { CopilotBox } from "@/components/today/owner/CopilotBox";
import "@/components/today/owner/owner-today.css";
import {
  OWNER_CALENDAR_LINK,
  OWNER_CARDS_HEADING,
  OWNER_CARDS_START,
  OWNER_DEADLINES_FAILED,
  OWNER_DEADLINES_HEADING,
  OWNER_DEADLINES_NONE,
  OWNER_PROPOSALS_FAILED,
  OWNER_PROPOSALS_HEADING,
  OWNER_PROPOSALS_LINK,
  OWNER_PROPOSALS_NONE,
  OWNER_WEEK_BOTH_FAILED,
  OWNER_WEEK_CONSULTS_FAILED,
  OWNER_WEEK_DEADLINES_FAILED,
  OWNER_WEEK_HEADING,
} from "@/lib/ui/words";

function greeting(hour: number): string {
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

/**
 * The owner's Today: short and calm. Every read is independent (allSettled); a failed one says so in words and
 * prints no number. Read-only: nothing is sent, moved or opened from here. The technician Today is untouched.
 */
export async function OwnerToday({
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
  const [hasProposals, tz] = await Promise.all([orgHasModule("proposals").catch(() => false), getFirmTimeZone()]);
  const [deckS, consultsS, deadlinesS, proposalsS, membersS] = await Promise.allSettled([
    loadDeckSummary({ userId, role }),
    loadTodayConsults(now, tz, liveConsultDeps),
    loadOwnerDeadlines(now, tz),
    hasProposals ? loadOwnerProposals(now, tz) : Promise.resolve(null),
    listMemberDirectory(),
  ]);

  // loadDeckSummary never throws; a rejection would be a bug, shown as unavailable.
  const deck: DeckSummary = deckS.status === "fulfilled" ? deckS.value : { status: "unavailable" };
  const consults: TodayConsultsResult | null = consultsS.status === "fulfilled" ? consultsS.value : null;
  const deadlines = deadlinesS.status === "fulfilled" ? deadlinesS.value : null;
  const proposals = proposalsS.status === "fulfilled" ? proposalsS.value : undefined; // null = no proposals feature; undefined = failed
  const members = membersS.status === "fulfilled" ? membersS.value : [];

  const today = civilInZone(now, tz);
  const firstName = greetingName({ userId, members, metadata, email });
  const line = cardsLine(deck);
  const week = weekStrip({ now, tz, consults: consults ? consults.consults : null, deadlines });
  const weekNote =
    consults === null && deadlines === null
      ? OWNER_WEEK_BOTH_FAILED
      : consults === null
        ? OWNER_WEEK_CONSULTS_FAILED
        : deadlines === null
          ? OWNER_WEEK_DEADLINES_FAILED
          : null;

  return (
    <>
      <div className="lx-page-head lx-page-head-list">
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1 className="lx-h1">
            Good {greeting(hourInZone(now, tz))}
            {greetingSuffix(firstName)}.
          </h1>
          {!firstName && <AddNameLink />}
        </div>
      </div>

      <div className="ot-grid">
        <div className="ot-col">
          <section className="ot-deck" aria-labelledby="ot-cards-h" data-state={line.state}>
            <h2 id="ot-cards-h" className="lx-h2" style={{ fontSize: 25 }}>
              {OWNER_CARDS_HEADING}
            </h2>
            <p className="ot-deck-line" role={line.state === "unavailable" ? "alert" : undefined}>
              {line.headline}
            </p>
            {line.sub && <p className="ot-deck-sub">{line.sub}</p>}
            {line.canStart && (
              <Link href={DECK_PATH} className="lx-btn">
                {OWNER_CARDS_START}
              </Link>
            )}
          </section>

          {consults ? (
            <TodayConsultsView result={consults} timeZone={tz} />
          ) : (
            <section className="lx-card ot-card" aria-labelledby="ot-consults-h">
              <h2 id="ot-consults-h" className="lx-h2" style={{ fontSize: 25 }}>
                Consults
              </h2>
              <p className="lx-note" role="alert" style={{ margin: 0 }}>
                Couldn&apos;t load consults.
              </p>
            </section>
          )}

          <section className="lx-card ot-card" aria-labelledby="ot-week-h">
            <div className="ot-head">
              <h2 id="ot-week-h" className="lx-h2" style={{ fontSize: 25 }}>
                {OWNER_WEEK_HEADING}
              </h2>
              <Link href="/dashboard/calendar/" className="lx-note">
                {OWNER_CALENDAR_LINK}
              </Link>
            </div>
            <WeekStrip days={week} />
            {weekNote && (
              <p className="lx-note" role="alert" style={{ margin: 0 }}>
                {weekNote}
              </p>
            )}
          </section>
        </div>

        <div className="ot-col">
          <section className="lx-card ot-card" aria-labelledby="ot-deadlines-h">
            <div className="ot-head">
              <h2 id="ot-deadlines-h" className="lx-h2" style={{ fontSize: 25 }}>
                {OWNER_DEADLINES_HEADING}
              </h2>
              <Link href="/dashboard/calendar/" className="lx-note">
                {OWNER_CALENDAR_LINK}
              </Link>
            </div>
            {deadlines === null ? (
              <p className="lx-note" role="alert" style={{ margin: 0 }}>
                {OWNER_DEADLINES_FAILED}
              </p>
            ) : deadlines.length === 0 ? (
              <p className="lx-note" style={{ margin: 0 }}>
                {OWNER_DEADLINES_NONE}
              </p>
            ) : (
              <ul className="lx-list">
                {deadlines.slice(0, OWNER_DEADLINES_SHOWN).map((d) => (
                  <li key={d.key} className="lx-task">
                    <span style={{ minWidth: 0 }}>
                      <Link href={d.href} style={{ fontWeight: 500, color: "var(--ink)" }}>
                        {d.name}
                      </Link>
                      <span className="lx-note" style={{ display: "block" }}>
                        {d.detail}
                      </span>
                    </span>
                    <span className={d.overdueDays > 0 ? "lx-note ot-risk" : "lx-note"}>{dueText(d, today)}</span>
                  </li>
                ))}
              </ul>
            )}
            {deadlines !== null && deadlines.length > OWNER_DEADLINES_SHOWN && (
              <Link href="/dashboard/calendar/" className="lx-note">
                {deadlines.length - OWNER_DEADLINES_SHOWN} more on the calendar
              </Link>
            )}
          </section>

          {proposals !== null && (
            <section className="lx-card ot-card" aria-labelledby="ot-proposals-h">
              <div className="ot-head">
                <h2 id="ot-proposals-h" className="lx-h2" style={{ fontSize: 25 }}>
                  {OWNER_PROPOSALS_HEADING}
                </h2>
                <Link href="/dashboard/proposals/" className="lx-note">
                  {OWNER_PROPOSALS_LINK}
                </Link>
              </div>
              {proposals === undefined ? (
                <p className="lx-note" role="alert" style={{ margin: 0 }}>
                  {OWNER_PROPOSALS_FAILED}
                </p>
              ) : proposals.length === 0 ? (
                <p className="lx-note" style={{ margin: 0 }}>
                  {OWNER_PROPOSALS_NONE}
                </p>
              ) : (
                <ul className="lx-list">
                  {proposals.slice(0, OWNER_PROPOSALS_SHOWN).map((p) => (
                    <li key={p.id} className="lx-task">
                      <span style={{ minWidth: 0 }}>
                        <Link href={p.href} style={{ fontWeight: 500, color: "var(--ink)" }}>
                          {p.client}
                        </Link>
                        <span className="lx-note" style={{ display: "block" }}>
                          {p.title}
                        </span>
                      </span>
                      <span className={p.expired ? "lx-note ot-risk" : "lx-note"}>{p.expiry}</span>
                    </li>
                  ))}
                </ul>
              )}
              {Array.isArray(proposals) && proposals.length > OWNER_PROPOSALS_SHOWN && (
                <Link href="/dashboard/proposals/" className="lx-note">
                  {proposals.length - OWNER_PROPOSALS_SHOWN} more
                </Link>
              )}
            </section>
          )}

          {aiConfigured() && <CopilotBox />}
        </div>
      </div>
    </>
  );
}
