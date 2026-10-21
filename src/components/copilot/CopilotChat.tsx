"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { createChatController } from "@/lib/copilot/controller";
import type { Exchange } from "@/lib/copilot/client";
import "./copilot.css";

/** Three chips: what the firm asks most. */
export const SUGGESTED_PROMPTS = [
  "What's due in the next two weeks?",
  "Which matters are stalled right now?",
  "What happened across the firm this week?",
];

export const APPROVAL_FOOTER = "Nothing sends without your approval.";
export const HERO_QUESTION = "What do you want to get done today?";

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12l16-8-6 16-2.5-6z" />
    </svg>
  );
}

/** One question and what came back for it. Every state has words, not just a colour. */
export function ExchangeView({ ex }: { ex: Exchange }) {
  const running = Array.from(new Set(ex.tools ?? []));
  return (
    <div className="cpl-exchange">
      <div className="cpl-bubble cpl-bubble-user">{ex.question}</div>

      {ex.status === "pending" && (
        <div className="cpl-bubble cpl-bubble-copilot" aria-busy="true">
          <div className="cpl-label">Copilot</div>
          {ex.streamed ? <p className="cpl-answer">{ex.streamed}</p> : null}
          <p className="cpl-status">{running.length > 0 ? `${running.join(", ")}…` : ex.streamed ? "Still reading the firm's records…" : "Reading the firm's records…"}</p>
        </div>
      )}

      {ex.status === "error" && (
        <div className="cpl-bubble cpl-bubble-copilot cpl-bubble-error" role="alert">
          {ex.error}
        </div>
      )}

      {ex.status === "done" && (
        <div className="cpl-bubble cpl-bubble-copilot">
          <div className="cpl-label">{ex.declined ? "Copilot · not a records question" : "Copilot"}</div>
          {ex.readFailed && (
            <p className="lx-banner lx-banner-warn" role="alert" style={{ margin: 0 }}>
              Some of the firm&apos;s records couldn&apos;t be read while answering, so this
              answer may be incomplete. Try again, or check the record directly.
            </p>
          )}
          {ex.contextStatus && ex.contextStatus !== "found" && (
            <p className="cpl-status">
              {ex.contextStatus === "not-found"
                ? "The record on this page couldn't be found, so this answer doesn't use it."
                : "The record on this page couldn't be read, so this answer doesn't use it."}
            </p>
          )}
          <p className="cpl-answer">{ex.answer}</p>
          {ex.citations && ex.citations.length > 0 ? (
            <div className="cpl-cites">
              {ex.citations.map((c) => (
                <Link key={`${c.type}-${c.id}`} href={c.href} className="cpl-cite">
                  {c.label}
                </Link>
              ))}
            </div>
          ) : (
            <p className="cpl-status">No matter or lead record backs this — for case judgment, ask the attorney of record.</p>
          )}
        </div>
      )}
    </div>
  );
}

type Props = {
  /** `page` is /dashboard/copilot (hero, greeting, stat cards); `drawer` is the compact one in the launcher. */
  variant: "page" | "drawer";
  /** The page variant's greeting, already worded ("Good morning, Taylor."). */
  greeting?: string;
  /** The page variant's stat cards, rendered on the server and shown while the thread is empty. */
  stats?: ReactNode;
  /** The drawer's current page, sent as context. The full page sends none. */
  pathname?: string;
  /** For tests and for restoring a thread. */
  initialExchanges?: Exchange[];
};

/**
 * The chat behind /dashboard/copilot/ and the drawer on every other dashboard
 * page. Client-only chrome around POST /api/matters-chat (an SSE stream) — all
 * the real work (tool-calling, the UPL-firewall system prompt, citation
 * collection) lives server-side in @/lib/agents/matters-chat; the ask/stream
 * behaviour is @/lib/copilot/controller.
 *
 * "cite-required" is the literal design constraint: every citation chip links
 * straight to the matter or lead record it came from, and an answer with no
 * citations says so plainly instead of pretending to be backed by one.
 */
export function CopilotChat({ variant, greeting, stats, pathname, initialExchanges }: Props) {
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>(initialExchanges ?? []);
  const [pending, setPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (exchanges.length > 0) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [exchanges]);

  async function ask(raw: string) {
    if (!raw.trim() || pending) return;
    setQuestion("");
    setPending(true);
    try {
      await createChatController({
        fetchImpl: (input, init) => fetch(input, init),
        getExchanges: () => exchanges,
        setExchanges,
        getPathname: () => pathname,
      }).ask(raw);
    } finally {
      setPending(false);
    }
  }

  const idle = exchanges.length === 0;
  const pill = variant === "page" && idle;

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void ask(question);
      }}
      className={pill ? "cpl-composer cpl-pill" : "cpl-composer"}
    >
      <input
        type="text"
        className="cpl-input"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={pill ? "Ask anything — every answer cites a matter or lead…" : idle ? "Ask about a matter, lead, or deadline…" : "Ask a follow-up…"}
        aria-label="Ask the copilot"
        disabled={pending}
        maxLength={2000}
      />
      <div className="cpl-composer-row">
        <span className="cpl-footnote">{pill ? "Answers come only from your firm's records." : APPROVAL_FOOTER}</span>
        {!idle && (
          <button type="button" className="cpl-ghost" onClick={() => setExchanges([])} disabled={pending}>
            New thread
          </button>
        )}
        <button type="submit" className="cpl-send" disabled={pending || !question.trim()} aria-label={pending ? "Asking" : "Ask"}>
          <SendIcon />
        </button>
      </div>
    </form>
  );

  const chips = (
    <div className="cpl-prompts">
      {SUGGESTED_PROMPTS.map((p) => (
        <button key={p} type="button" className="cpl-chip" onClick={() => void ask(p)} disabled={pending}>
          {p}
        </button>
      ))}
    </div>
  );

  const thread = (
    <div className="cpl-thread" role="log" aria-live="polite" aria-label="Copilot conversation">
      {idle ? (
        <div className="cpl-empty">
          <p className="cpl-status">Ask about a matter, a lead, an open deadline, or recent activity. Try:</p>
          {chips}
        </div>
      ) : (
        exchanges.map((ex) => <ExchangeView key={ex.id} ex={ex} />)
      )}
      <div ref={bottomRef} />
    </div>
  );

  if (variant === "page") {
    return (
      <section className={idle ? "cph-hero cpl-root cpl-page" : "cph-hero cpl-root cpl-page cpl-active"} aria-label="AI copilot">
        {idle ? (
          <div className="cph-stage">
            <h2 className="cph-greeting">
              <span className="cph-greeting-a">{greeting}</span>{" "}
              <span className="cph-greeting-b">{HERO_QUESTION}</span>
            </h2>
            {composer}
            {chips}
            {stats}
          </div>
        ) : (
          <div className="cph-conversation">
            {thread}
            <div className="cpl-rail">{composer}</div>
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="cpl-root cpl-drawer-chat">
      {thread}
      <div className="cpl-rail">{composer}</div>
    </div>
  );
}
