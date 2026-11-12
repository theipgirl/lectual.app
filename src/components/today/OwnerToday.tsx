import Link from "next/link";
import type { Role } from "@/lib/auth/roles";
import { aiConfigured } from "@/lib/ai/claude";
import { orgHasModule } from "@/lib/org/modules";
import { getFirmTimeZone } from "@/lib/org/profile";
import { listMemberDirectory } from "@/lib/members/directory";
import { greetingName, greetingSuffix } from "@/lib/today/greeting-name";
import { hourInZone } from "@/lib/today/priorities";
import { civilInZone } from "@/lib/today/outcomes";
import { parseDealTimes } from "@/lib/deal/person-times";
import { dealNudge, parseDeckSeen } from "@/lib/deal/nudge";
import { loadDeckSummary, type DeckSummary } from "@/lib/queue/deck-summary";
import { loadTodayConsults, type TodayConsultsResult } from "@/lib/calendar/consult-sources";
import { liveConsultDeps } from "@/lib/calendar/consult-sources-live";
import { loadOwnerDeadlines, loadOwnerNeedsReview, loadOwnerProposals } from "@/lib/today/owner-load";
import { cardsHero, deadlineChip, deadlineParts, proposalTone, weekdayDate, OWNER_PROPOSALS_SHOWN, OWNER_DEADLINES_SHOWN, weekStrip } from "@/lib/today/owner-rules";
import { DECK_PATH } from "@/lib/views";
import { AddNameLink } from "@/components/account/AddNameLink";
import { OwnerNeedsReview } from "@/components/today/owner/OwnerNeedsReview";
import { OwnerConsults } from "@/components/today/owner/OwnerConsults";
import { WeekStrip } from "@/components/today/owner/WeekStrip";
import { CopilotBox } from "@/components/today/owner/CopilotBox";
import "@/components/today/owner/owner-today.css";
import {
  OWNER_CARDS_HEADING,
  OWNER_CARDS_START,
  OWNER_CONSULTS_FAILED,
  OWNER_CONSULTS_HEADING,
  OWNER_PROPOSAL_LINK_LIVE,
  OWNER_WEEK_KEY_CONSULT,
  OWNER_WEEK_KEY_DEADLINE,
  OWNER_WEEK_OPEN_CALENDAR,
  ownerProposalOpens,
  ownerSeeAll,
  OWNER_DEADLINES_FAILED,
  OWNER_DEADLINES_HEADING,
  OWNER_DEADLINES_NONE,
  OWNER_PROPOSALS_FAILED,
  OWNER_PROPOSALS_HEADING,
  OWNER_PROPOSALS_NONE,
  OWNER_WEEK_BOTH_FAILED,
  OWNER_WEEK_CONSULTS_FAILED,
  OWNER_WEEK_DEADLINES_FAILED,
  OWNER_WEEK_HEADING,
} from "@/lib/ui/words";

function longDate(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(now);
}

function greeting(hour: number): string {
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

/**
 * The owner's Today: short and calm. Every read is independent (allSettled); a failed one says so in words and
 * prints no number. Read-only: nothing is sent, moved or opened from here. The technician Today is untouched.
 */
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
  const dealTimes = parseDealTimes(metadata);
  const [deckS, consultsS, deadlinesS, reviewS, proposalsS, membersS] = await Promise.allSettled([
    loadDeckSummary({ userId, role }, dealTimes, now),
    loadTodayConsults(now, tz, liveConsultDeps),
    loadOwnerDeadlines(now, tz),
    loadOwnerNeedsReview(now, tz),
    hasProposals ? loadOwnerProposals(now, tz) : Promise.resolve(null),
    listMemberDirectory(),
  ]);

  // loadDeckSummary never throws; a rejection would be a bug, shown as unavailable.
  const deck: DeckSummary = deckS.status === "fulfilled" ? deckS.value : { status: "unavailable" };
  const consults: TodayConsultsResult | null = consultsS.status === "fulfilled" ? consultsS.value : null;
  const deadlines = deadlinesS.status === "fulfilled" ? deadlinesS.value : null;
  const needsReview = reviewS.status === "fulfilled" ? reviewS.value : null;
  const proposals = proposalsS.status === "fulfilled" ? proposalsS.value : undefined; // null = no proposals feature; undefined = failed
  const members = membersS.status === "fulfilled" ? membersS.value : [];

  const today = civilInZone(now, tz);
  const firstName = greetingName({ userId, members, metadata, email });
  // Ready only when the same read that drew the tile says there are cards in the person's current deal (never from a failed read).
  const nudge = dealNudge({ now, timeZone: tz, times: dealTimes, seen: parseDeckSeen(metadata), read: deck.status === "ok" ? { status: "ok", undecided: deck.count } : { status: deck.status } });
  const hero = cardsHero(deck, nudge);
  const week = weekStrip({ now, tz, consults: consults ? consults.consults : null, deadlines, proposals: Array.isArray(proposals) ? proposals : null });
  const weekNote =
    consults === null && deadlines === null
      ? OWNER_WEEK_BOTH_FAILED
      : consults === null
        ? OWNER_WEEK_CONSULTS_FAILED
        : deadlines === null
          ? OWNER_WEEK_DEADLINES_FAILED
          : null;
  const columns = proposals === null ? 2 : 3;

  return (
    <div className="ot-page">
      <div className="ot-top">
        <h1 className="ot-h1">
          Good {greeting(hourInZone(now, tz))}
          {greetingSuffix(firstName)}.
        </h1>
        <p className="ot-date">{longDate(now, tz)}</p>
        {!firstName && <AddNameLink />}
      </div>

      <section className="ot-hero" aria-labelledby="ot-cards-h" data-state={hero.state}>
        <h2 id="ot-cards-h" className="ot-eyebrow ot-only-narrow">
          {OWNER_CARDS_HEADING}
        </h2>
        {hero.big !== null ? (
          <>
            <div className="ot-hero-main ot-only-wide">
              <span className="ot-big">{hero.big}</span>
              <div className="ot-hero-text">
                <span className="ot-hero-title">
                  {hero.unit} &middot; {hero.about}
                </span>
                <span className="ot-hero-sub" data-ready={hero.ready ? "true" : undefined}>{hero.dealLine}</span>
              </div>
            </div>
            <div className="ot-hero-main ot-only-narrow">
              <p className="ot-hero-count">
                {hero.big} {hero.cards} <span className="ot-hero-about">&middot; {hero.about}</span>
              </p>
              <p className="ot-hero-sub" data-ready={hero.ready ? "true" : undefined}>{hero.dealLine}</p>
            </div>
          </>
        ) : (
          <p className="ot-hero-message" role={hero.state === "unavailable" ? "alert" : undefined}>
            {hero.message}
          </p>
        )}
        {hero.canStart && (
          <Link href={DECK_PATH} className="ot-start">
            {OWNER_CARDS_START}
          </Link>
        )}
      </section>

      <section className="ot-card ot-week-card" aria-labelledby="ot-week-h">
        <div className="ot-card-head">
          <h2 id="ot-week-h" className="ot-card-title">
            {OWNER_WEEK_HEADING}
          </h2>
          <span className="ot-sub">
            <span className="ot-only-narrow">
              <span className="ot-key ot-key-consult" /> {OWNER_WEEK_KEY_CONSULT} <span className="ot-key ot-key-deadline" /> {OWNER_WEEK_KEY_DEADLINE}
            </span>
            <span className="ot-only-wide">
              <Link href="/dashboard/calendar/" className="ot-link">
                {OWNER_WEEK_OPEN_CALENDAR}
              </Link>
            </span>
          </span>
        </div>
        <WeekStrip days={week} />
        {weekNote && (
          <p className="ot-sub ot-note" role="alert">
            {weekNote}
          </p>
        )}
      </section>

      <div className="ot-cols" style={{ ["--ot-cols" as string]: columns }}>
        <div className="ot-col-consults">
          {consults ? (
            <OwnerConsults result={consults} timeZone={tz} today={today} />
          ) : (
            <section className="ot-card" aria-labelledby="ot-consults-h">
              <h2 id="ot-consults-h" className="ot-card-title">
                {OWNER_CONSULTS_HEADING}
              </h2>
              <p className="ot-sub ot-note" role="alert">
                {OWNER_CONSULTS_FAILED}
              </p>
            </section>
          )}
        </div>

        {proposals !== null && (
          <div className="ot-col-proposals">
            <section className="ot-card" aria-labelledby="ot-proposals-h">
              <div className="ot-card-head">
                <h2 id="ot-proposals-h" className="ot-card-title">
                  {OWNER_PROPOSALS_HEADING}
                </h2>
                {Array.isArray(proposals) && proposals.length > 0 && (
                  <span className="ot-sub">
                    {proposals.length}
                  </span>
                )}
              </div>
              {proposals === undefined ? (
                <p className="ot-sub ot-note" role="alert">
                  {OWNER_PROPOSALS_FAILED}
                </p>
              ) : proposals.length === 0 ? (
                <p className="ot-sub ot-empty">{OWNER_PROPOSALS_NONE}</p>
              ) : (
                proposals.slice(0, OWNER_PROPOSALS_SHOWN).map((p) => {
                  const opens = ownerProposalOpens(p.opens);
                  return (
                    <div key={p.id} className="ot-row">
                      <div className="ot-row-main">
                        <Link href={p.href} className="ot-row-title">
                          {p.client} &middot; {p.title}
                        </Link>
                        <span className="ot-sub ot-line ot-only-wide">
                          {OWNER_PROPOSAL_LINK_LIVE}
                          {opens ? ` \u00b7 ${opens}` : ""}
                        </span>
                      </div>
                      <span className={`ot-pill ot-pill-${proposalTone(p, today)}`}>{p.expiry}</span>
                    </div>
                  );
                })
              )}
              {Array.isArray(proposals) && proposals.length > OWNER_PROPOSALS_SHOWN && (
                <Link href="/dashboard/proposals/" className="ot-link ot-more">
                  {ownerSeeAll(proposals.length)}
                </Link>
              )}
            </section>
          </div>
        )}

        <div className="ot-col-deadlines">
          <section className="ot-card" aria-labelledby="ot-deadlines-h">
            <div className="ot-card-head">
              <h2 id="ot-deadlines-h" className="ot-card-title">
                {OWNER_DEADLINES_HEADING}
              </h2>
              {deadlines !== null && deadlines.length > 0 && <span className="ot-sub">{deadlines.length}</span>}
            </div>
            {deadlines === null ? (
              <p className="ot-sub ot-note" role="alert">
                {OWNER_DEADLINES_FAILED}
              </p>
            ) : deadlines.length === 0 ? (
              <p className="ot-sub ot-empty">{OWNER_DEADLINES_NONE}</p>
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
                    <span className={`ot-pill ot-pill-${chip.tone}`}>{chip.text}</span>
                  </div>
                );
              })
            )}
            {deadlines !== null && deadlines.length > OWNER_DEADLINES_SHOWN && (
              <Link href="/dashboard/calendar/" className="ot-link ot-more">
                {ownerSeeAll(deadlines.length)}
              </Link>
            )}
          </section>
          <OwnerNeedsReview items={needsReview} />
        </div>
      </div>

      {aiConfigured() && <CopilotBox />}
    </div>
  );
}
