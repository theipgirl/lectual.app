"use client";

import { useState, useTransition } from "react";
import { createIntakeRequestAction, revokeIntakeRequestAction } from "@/app/dashboard/matters/[id]/intake-request-actions";
import { intakeRequestUrl } from "@/lib/intake-forms/request-links";
import { DEFAULT_TIME_ZONE } from "@/lib/org/profile-rules";
import { formatDay } from "@/lib/ui/dates";
import { Notice, Pill } from "@/components/ui";
import { toneFor, type PillTone } from "@/lib/ui/tones";
import { BLANK, SAVING } from "@/lib/ui/words";
import "./matter-page.css";

/**
 * "Send intake questions": makes a private link to the firm's intake
 * questions for this matter's client, and lists the links already made.
 * Nothing is emailed — the firm copies the link and sends it itself. The
 * client's answers come back as a note on this matter's timeline.
 */

type Row = { id: string; token: string; status: "sent" | "completed" | "revoked"; sentAt: string; completedAt: string | null };

const STATUS: Record<Row["status"], { label: string; tone: PillTone }> = {
  sent: { label: "Waiting", tone: toneFor("needsPerson") },
  completed: { label: "Answered", tone: toneFor("done") },
  revoked: { label: "Withdrawn", tone: toneFor("neutral") },
};

export function IntakeRequestCard(props: { matterId: string; origin: string; requests: Row[]; formReady: boolean; canSend: boolean; /** The firm's time zone, for the dates. */ tz?: string }) {
  const tz = props.tz ?? DEFAULT_TIME_ZONE;
  const day = (iso: string) => formatDay(iso, { tz }) ?? BLANK;
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
        <p className="lx-note">
          Set up your intake questions in Intake → Forms, then send them to a client from here.
        </p>
      ) : props.canSend ? (
        <>
          <p className="lx-note">
            Makes a private link to your intake questions. Nothing is emailed; copy the link and send it to the client yourself.
          </p>
          <button type="button" className="lx-btn lx-btn-sec lx-btn-sm mx-self-start" onClick={create} disabled={pending}>
            {pending ? SAVING : "Create intake link"}
          </button>
        </>
      ) : null}
      {fresh && (
        <div className="mx-grid-6">
          <input className="lx-input" readOnly value={intakeRequestUrl(props.origin, fresh)} onFocus={(e) => e.currentTarget.select()} aria-label="Link to send the client" />
          <button type="button" className="lx-btn lx-btn-pri lx-btn-sm mx-self-start" onClick={() => copy(fresh)}>
            {copied === fresh ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
      {error && (
        <Notice tone="risk" role="alert">
          {error}
        </Notice>
      )}
      {props.requests.length > 0 && (
        <ul className="lx-list mx-grid">
          {props.requests.map((r) => (
            <li key={r.id} className="mx-row">
              <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
              <span className="lx-note mx-flex-1">
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
