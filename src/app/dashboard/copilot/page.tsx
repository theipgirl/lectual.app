import { aiConfigured } from "@/lib/ai/claude";
import { CopilotChat } from "@/components/copilot/CopilotChat";
import "./copilot.css";

export const dynamic = "force-dynamic";

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
 */
export default function CopilotPage() {
  const configured = aiConfigured();

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
        <CopilotChat />
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
          <b style={{ color: "var(--ox)" }}>The one rule.</b> This copilot only reports what is
          already in the firm&apos;s own records — it never gives legal analysis, an opinion, or a
          recommendation. A question that calls for legal judgment is declined here and belongs
          with the attorney of record.
        </div>
      </div>
    </>
  );
}
