"use client";

import { useState, useTransition } from "react";
import { createIntakeRequestAction, revokeIntakeRequestAction } from "@/app/dashboard/matters/[id]/intake-request-actions";
import { intakeRequestUrl } from "@/lib/intake-forms/request-links";

/**
 * "Send intake questions": makes a private link to the firm's intake
 * questions for this matter's client, and lists the links already made.
 * Nothing is emailed — the firm copies the link and sends it itself. The
 * client's answers come back as a note on this matter's timeline.
 */

type Row = { id: string; token: string; status: "sent" | "completed" | "revoked"; sentAt: string; completedAt: string | null };

const STATUS: Record<Row["status"], { label: string; cls: string }> = {
  sent: { label: "Waiting", cls: "lx-pill-warn" },
  completed: { label: "Answered", cls: "lx-pill-ok" },
  revoked: { label: "Withdrawn", cls: "lx-pill-mute" },
};

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function IntakeRequestCard(props: { matterId: string; origin: string; requests: Row[]; formReady: boolean; canSend: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (token: string) => {
    navigator.clipboard?.writeText(intakeRequestUrl(props.origin, token)).then(
      () => setCopied(token),
      () => setError("Couldn't copy. Select the link and copy it instead."),
    );
  };

  const create = () =>
    start(async () => {
      setError(null);
      const res = await createIntakeRequestAction(props.matterId);
      if (res.error) setError(res.error);
      else if (res.token) setFresh(res.token);
    });

  const revoke = (id: string) =>
    start(async () => {
      setError(null);
      const res = await revokeIntakeRequestAction(props.matterId, id);
      if (res.error) setError(res.error);
    });

  return (
    <section className="lx-card lx-aside">
      <div className="lx-label">Intake questions</div>
      {!props.formReady ? (
        <p className="lx-note" style={{ margin: 0 }}>
          Set up your intake questions in Intake → Forms, then send them to a client from here.
        </p>
      ) : props.canSend ? (
        <>
          <p className="lx-note" style={{ margin: 0 }}>
            Makes a private link to your intake questions. Nothing is emailed; copy the link and send it to the client yourself.
          </p>
          <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" style={{ justifySelf: "start" }} onClick={create} disabled={pending}>
            {pending ? "Working…" : "Create intake link"}
          </button>
        </>
      ) : null}
      {fresh && (
        <div style={{ display: "grid", gap: 6 }}>
          <input className="lx-input" readOnly value={intakeRequestUrl(props.origin, fresh)} onFocus={(e) => e.currentTarget.select()} aria-label="Link to send the client" />
          <button type="button" className="lx-btn lx-btn-pri lx-btn-sm" style={{ justifySelf: "start" }} onClick={() => copy(fresh)}>
            {copied === fresh ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
      {error && (
        <p className="lx-banner lx-banner-risk" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      {props.requests.length > 0 && (
        <ul className="lx-list" style={{ display: "grid", gap: 8 }}>
          {props.requests.map((r) => (
            <li key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className={`lx-pill ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
              <span className="lx-note" style={{ flex: 1, minWidth: 100 }}>
                {r.status === "completed" && r.completedAt ? `Answered ${day(r.completedAt)}` : `Made ${day(r.sentAt)}`}
              </span>
              {r.status === "sent" && props.canSend && (
                <>
                  <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => copy(r.token)}>
                    {copied === r.token ? "Copied" : "Copy link"}
                  </button>
                  <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => revoke(r.id)} disabled={pending}>
                    Withdraw
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
