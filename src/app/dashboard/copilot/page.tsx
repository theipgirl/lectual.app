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
import { getScopedClient } from "@/lib/db/scoped-client";
import { listConversations, loadConversation, type ListResult } from "@/lib/copilot/history-store";
import { exchangesFromMessages } from "@/lib/copilot/history-pure";
import type { Exchange } from "@/lib/copilot/client";
import { CopilotWorkspace } from "@/components/copilot/CopilotWorkspace";
import { StatCards } from "./stat-cards";
import "./copilot.css";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { SectionTabs } from "@/components/shell/SectionTabs";
import { REPORTS } from "@/lib/nav";
import { COPILOT_NAME } from "@/lib/ui/words";

export const metadata: Metadata = { title: pageTitle("Copilot") };

export const dynamic = "force-dynamic";

const DEADLINE_WINDOW_DAYS = 14;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The saved chats, and the one the address names. Both reads are three-state; a thrown read is "unavailable". */
async function readHistory(openParam: string | null): Promise<{ history: ListResult; openId: string | null; exchanges?: Exchange[]; openNote: string | null }> {
  let db: Awaited<ReturnType<typeof getScopedClient>>;
  try {
    db = await getScopedClient();
  } catch {
    return { history: { status: "unavailable" }, openId: null, openNote: null };
  }
  const [history, opened] = await Promise.all([
    listConversations(db as never),
    openParam && UUID.test(openParam) ? loadConversation(db as never, openParam) : Promise.resolve(null),
  ]);
  if (openParam && !opened) return { history, openId: null, openNote: "That saved chat couldn't be found." };
  if (!opened || opened.status === "not-set-up") return { history, openId: null, openNote: null };
  if (opened.status === "ok") return { history, openId: opened.conversation.id, exchanges: exchangesFromMessages(opened.messages), openNote: null };
  return { history, openId: null, openNote: opened.status === "none" ? "That saved chat couldn't be found." : "That saved chat couldn't be loaded." };
}

/** A settled read as a stat: a number, or "couldn't load". Never a zero from a failure. */
function statOf<T>(settled: PromiseSettledResult<T>, count: (value: T) => number): StatRead {
  return settled.status === "fulfilled" ? { status: "ok", value: count(settled.value) } : { status: "unavailable" };
}

/**
 * Copilot (/dashboard/copilot/) — read-only Q&A over the signed-in firm's
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
export default async function CopilotPage(props?: { searchParams?: Promise<{ c?: string | string[] }> }) {
  const params = (await props?.searchParams) ?? {};
  const openParam = typeof params.c === "string" ? params.c : null;
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

  const saved = configured ? await readHistory(openParam) : null;

  return (
    <>
      <h1 className="cpw-sr">Copilot</h1>
      <SectionTabs active="list" listLabel={COPILOT_NAME} listHref="/dashboard/copilot/" summaryHref={REPORTS.ipos.href} />

      {configured && saved ? (
        <CopilotWorkspace
          key={saved.openId ?? "new"}
          history={saved.history}
          openId={saved.openId}
          initialExchanges={saved.exchanges}
          openNote={saved.openNote}
          greeting={greeting}
          stats={landing}
          now={new Date().getTime()}
        />
      ) : (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            Copilot isn&apos;t switched on for your firm yet
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            Lectual will turn it on. Nothing here is broken: there is simply nothing to ask yet.
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
