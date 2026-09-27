"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Citation = { type: "matter" | "lead"; id: string; label: string; href: string };
type ChatResponse = { answer: string; citations: Citation[]; declined: boolean };

type Exchange = {
  id: string;
  question: string;
  status: "pending" | "done" | "error";
  answer?: string;
  citations?: Citation[];
  declined?: boolean;
  error?: string;
};

const SUGGESTED_PROMPTS = [
  "What's due in the next two weeks?",
  "Which matters haven't moved in 30 days?",
  "What happened across the firm this week?",
  "Is anything overdue right now?",
];

/**
 * The chat panel behind /dashboard/copilot/. Client-only chrome around
 * POST /api/matters-chat — all the real work (tool-calling, the UPL-firewall
 * system prompt, citation collection) lives server-side in
 * @/lib/agents/matters-chat; this component only renders the thread and
 * whatever comes back.
 *
 * Each question is answered independently (the API is stateless per call,
 * same as the source this was ported from) — "New thread" only clears what
 * is shown here, since there is no server-side conversation to reset.
 *
 * "cite-required" is the literal design constraint: every citation chip
 * below links straight to the matter or lead record it came from, and an
 * answer with no citations says so plainly instead of pretending to be
 * backed by one.
 */
export function CopilotChat() {
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [pending, setPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [exchanges.length]);

  async function ask(raw: string) {
    const text = raw.trim();
    if (!text || pending) return;

    const id = crypto.randomUUID();
    setExchanges((prev) => [...prev, { id, question: text, status: "pending" }]);
    setQuestion("");
    setPending(true);

    try {
      const res = await fetch("/api/matters-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const data = (await res.json().catch(() => null)) as ChatResponse | { error: string } | null;

      if (!res.ok || !data || "error" in data) {
        const message = (data && "error" in data && data.error) || "Something went wrong — try again.";
        setExchanges((prev) => prev.map((e) => (e.id === id ? { ...e, status: "error", error: message } : e)));
        return;
      }

      setExchanges((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, status: "done", answer: data.answer, citations: data.citations, declined: data.declined } : e,
        ),
      );
    } catch {
      setExchanges((prev) =>
        prev.map((e) => (e.id === id ? { ...e, status: "error", error: "Couldn't reach the copilot — try again." } : e)),
      );
    } finally {
      setPending(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void ask(question);
  }

  return (
    <div className="cpl-panel lx-card">
      <div className="cpl-thread">
        {exchanges.length === 0 ? (
          <div className="cpl-empty">
            <p className="lx-note" style={{ margin: 0 }}>
              Ask about a matter, a lead, an open deadline, or recent activity. Try:
            </p>
            <div className="cpl-prompts">
              {SUGGESTED_PROMPTS.map((p) => (
                <button key={p} type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => void ask(p)} disabled={pending}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          exchanges.map((ex) => (
            <div key={ex.id} className="cpl-exchange">
              <div className="cpl-bubble cpl-bubble-user">{ex.question}</div>

              {ex.status === "pending" && (
                <div className="cpl-bubble cpl-bubble-copilot cpl-thinking" aria-live="polite">
                  Reading the firm&apos;s records…
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
                  <p style={{ margin: 0 }}>{ex.answer}</p>
                  {ex.citations && ex.citations.length > 0 ? (
                    <div className="cpl-cites">
                      {ex.citations.map((c) => (
                        <Link key={`${c.type}-${c.id}`} href={c.href} className="lx-pill lx-pill-mute cpl-cite">
                          {c.label}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="lx-note" style={{ margin: 0 }}>
                      No matter or lead record backs this — for case judgment, ask the attorney of record.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="cpl-composer">
        <input
          type="text"
          className="lx-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about a matter, lead, or deadline…"
          aria-label="Ask the copilot"
          disabled={pending}
          maxLength={2000}
        />
        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending || !question.trim()}>
          {pending ? "Asking…" : "Ask"}
        </button>
        {exchanges.length > 0 && (
          <button type="button" className="lx-btn lx-btn-ghost" onClick={() => setExchanges([])} disabled={pending}>
            New thread
          </button>
        )}
      </form>
    </div>
  );
}
