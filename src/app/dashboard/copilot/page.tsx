import { aiConfigured } from "@/lib/ai/claude";
import { resolveFirmSession } from "@/lib/firm/session";
import { getFirmTimeZone } from "@/lib/org/profile";
import { listMemberDirectory } from "@/lib/members/directory";
import { listMatters, listUpcomingDeadlines, summarizeDocket } from "@/lib/matters";
import { loadActiveQueue } from "@/lib/queue/load";
import { greetingName } from "@/lib/today/greeting-name";
import { hourInZone } from "@/lib/today/priorities";
import { copilotGreeting } from "@/lib/copilot/part-of-day";
import { buildStatCards, type StatRead } from "@/lib/copilot/stats";
import { CopilotChat } from "@/components/copilot/CopilotChat";
import { StatCards } from "./stat-cards";
import "./copilot.css";

export const dynamic = "force-dynamic";

const DEADLINE_WINDOW_DAYS = 14;

/** A settled read as a stat: a number, or "couldn't load". Never a zero from a failure. */
function statOf<T>(settled: PromiseSettledResult<T>, count: (value: T) => number): StatRead {
  return settled.status === "fulfilled" ? { status: "ok", value: count(settled.value) } : { status: "unavailable" };
}

/**
 * AI copilot (/dashboard/copilot/) — read-only Q&A over the signed-in firm's
 * own matters, leads, deadlines and activity. Ported from lectual main's
 * home-page "search your matters" copilot (src/lib/agents/matters-chat.ts,
 * src/app/api/matters-chat/route.ts, src/components/firm/MattersCopilotBox.tsx)
 * as its own page, since this app has no home-page copilot box.
 *
 * No module gate: unlike inbox/document-center/lawmatics-import, this
 * surface holds no global credential and names no one firm's attorney —
 * every read it can make already goes through the caller's own RLS scope
 * (see @/lib/agents/matters-chat), so there is nothing per-firm to switch on.
 * `src/lib/nav.ts` reflects that (no `module` on the "copilot" entry).
 *
 * Three states, not two: when no AI key is configured this says so plainly
 * instead of rendering a chat box that would only fail on the first question
 * (AGENTS.md — a broken surface must never look like an empty or working
 * one). A per-question failure once the chat is live (a bad network call, a
 * model error) is shown inline in the thread instead, for the same reason.
 *
 * The four numbers on the landing state are each their own read (allSettled),
 * so one dead source never blanks the others or the page, and a failed read
 * says so instead of printing a zero.
 */
export default async function CopilotPage() {
  const configured = aiConfigured();
  const session = configured ? await resolveFirmSession() : null;
  if (configured && session?.kind !== "ok") return null; // the layout already handled this

  let landing: React.ReactNode = null;
  let greeting = "";
  if (configured && session?.kind === "ok") {
    const now = new Date();
    const [tzS, membersS, mattersS, deadlinesS, queueS] = await Promise.allSettled([
      getFirmTimeZone(),
      listMemberDirectory(),
      listMatters(),
      listUpcomingDeadlines({ withinDays: DEADLINE_WINDOW_DAYS }),
      loadActiveQueue(),
    ]);
    const tz = tzS.status === "fulfilled" ? tzS.value : "America/New_York";
    const members = membersS.status === "fulfilled" ? membersS.value : [];
    greeting = copilotGreeting(
      hourInZone(now, tz),
      greetingName({ userId: session.user.id, members, metadata: session.user.user_metadata, email: session.user.email }),
    );

    // loadActiveQueue never throws; a rejection would be a bug, shown as unavailable.
    const queueRead: StatRead =
      queueS.status !== "fulfilled" || queueS.value.status === "unavailable"
        ? { status: "unavailable" }
        : queueS.value.status === "unconfigured"
          ? { status: "unconfigured" }
          : { status: "ok", value: queueS.value.items.length };

    landing = (
      <StatCards
        cards={buildStatCards({
          open: statOf(mattersS, (m) => summarizeDocket(m, now).open),
          stalled: statOf(mattersS, (m) => summarizeDocket(m, now).stalled.length),
          deadlines: statOf(deadlinesS, (d) => d.length),
          approvals: queueRead,
        })}
      />
    );
  }

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">IP.OS</div>
          <h1 className="lx-h1">AI copilot</h1>
          <p className="lx-sub">
            Ask about a matter, a lead, an open deadline, or recent activity — answered from your
            firm&apos;s own records, with a link to every matter or lead it read.
          </p>
        </div>
      </div>

      {configured ? (
        <CopilotChat variant="page" greeting={greeting} stats={landing} />
      ) : (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            The copilot isn&apos;t configured for this deployment yet
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            An administrator needs to set an AI provider key before this page can answer
            questions. Nothing here is broken — there is simply nothing to ask yet.
          </p>
        </div>
      )}

      <div className="lx-upl">
        <span aria-hidden="true">§</span>
        <div>
          <b style={{ color: "var(--ox)" }}>The one rule.</b>{" "}This copilot only reports what is
          already in the firm&apos;s own records — it never gives legal analysis, an opinion, or a
          recommendation. A question that calls for legal judgment is declined here and belongs
          with the attorney of record.
        </div>
      </div>
    </>
  );
}
