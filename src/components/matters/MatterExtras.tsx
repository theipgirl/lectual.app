"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  queueMonthlyStatusUpdateAction,
  sendWelcomeEmailAction,
  updateLitigationAction,
  type ActionState,
  type FollowUpActionState,
  type WelcomeEmailState,
} from "@/app/dashboard/matters/[id]/actions";
import { Field as UiField, Notice } from "@/components/ui";
import { SAVING } from "@/lib/ui/words";
import "./matter-page.css";
import type { FollowUpStatus } from "@/lib/matters/filing-followup";

/** Litigation facts as the form edits them (court-local datetime already formatted). */
export type LitigationValues = {
  caseNumber: string | null;
  caseStyle: string | null;
  county: string | null;
  courtDivision: string | null;
  judge: string | null;
  role: string | null;
  filedOn: string | null;
  caseStatus: string | null;
  nextHearingAt: string; // datetime-local in court time, "" when unset
  nextHearingPurpose: string | null;
  noticeOfAppearance: string | null;
  motionToDismiss: string | null;
  missedHearing: string | null;
  defaultStatus: string | null;
  notes: string | null;
};

function Field(props: { name: string; label: string; value: string | null; type?: string; wide?: boolean }) {
  return (
    <div className={props.wide ? "mx-span" : undefined}>
      <UiField label={props.label}>
        <input className="lx-input" name={props.name} type={props.type ?? "text"} defaultValue={props.value ?? ""} />
      </UiField>
    </div>
  );
}

export function LitigationForm({ matterId, values: v }: { matterId: string; values: LitigationValues }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateLitigationAction, {});
  return (
    <form action={action} className="lx-form-grid">
      <input type="hidden" name="matterId" value={matterId} />
      <Field name="caseNumber" label="Case number" value={v.caseNumber} />
      <Field name="caseStyle" label="Case style" value={v.caseStyle} />
      <Field name="county" label="County" value={v.county} />
      <Field name="courtDivision" label="Court division" value={v.courtDivision} />
      <Field name="judge" label="Judge" value={v.judge} />
      <Field name="role" label="We represent" value={v.role} />
      <Field name="filedOn" label="Filed" type="date" value={v.filedOn} />
      <Field name="caseStatus" label="Case status" value={v.caseStatus} />
      <Field name="nextHearingAt" label="Next hearing (court time)" type="datetime-local" value={v.nextHearingAt} />
      <Field name="nextHearingPurpose" label="Hearing for" value={v.nextHearingPurpose} />
      <Field name="noticeOfAppearance" label="Notice of appearance" value={v.noticeOfAppearance} />
      <Field name="motionToDismiss" label="Motion to dismiss" value={v.motionToDismiss} />
      <Field name="missedHearing" label="Missed hearing" value={v.missedHearing} />
      <Field name="defaultStatus" label="Default" value={v.defaultStatus} />
      <div className="mx-span">
        <UiField label="Case notes">
          <textarea className="lx-input" name="notes" rows={3} defaultValue={v.notes ?? ""} />
        </UiField>
      </div>
      <div className="mx-actions">
        <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
          {pending ? SAVING : "Save case details"}
        </button>
        {state.error && (
          <Notice tone="risk" role="alert">
            {state.error}
          </Notice>
        )}
      </div>
    </form>
  );
}

function Queued({ id, label }: { id: string; label: string }) {
  return (
    <Notice tone="ok">
      {label} <Link href={`/dashboard/queue/${id}/`}>Review it in the queue →</Link>
    </Notice>
  );
}

/** The welcome-client email: drafted once per trademark matter, into the approval queue. */
export function WelcomeEmailCard({ matterId, sentQueueItemId, alreadySent }: { matterId: string; sentQueueItemId: string | null; alreadySent: boolean }) {
  const [state, action, pending] = useActionState<WelcomeEmailState, FormData>(sendWelcomeEmailAction, {});
  if (state.queueItemId) return <Queued id={state.queueItemId} label="Welcome email drafted." />;
  if (alreadySent) {
    return sentQueueItemId ? (
      <Queued id={sentQueueItemId} label="A welcome email was already drafted for this matter." />
    ) : (
      <p className="lx-note">A welcome email was already drafted for this matter.</p>
    );
  }
  return (
    <form action={action} className="mx-grid">
      <input type="hidden" name="matterId" value={matterId} />
      <p className="lx-note">
        Drafts the client welcome email with the trademark questionnaire. It waits in the approval queue; nothing is sent.
      </p>
      <div>
        <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
          {pending ? SAVING : "Draft welcome email"}
        </button>
      </div>
      {state.error && (
          <Notice tone="risk" role="alert">
            {state.error}
          </Notice>
        )}
    </form>
  );
}

const FOLLOW_UP_COPY: Record<FollowUpStatus["kind"], string> = {
  due: "",
  not_due: "The first monthly update is due one month after filing.",
  already_queued: "This month's update is already in the queue.",
  stale: "It's been more than five months since filing. Check the USPTO status rather than sending another monthly update.",
  no_filing_date: "Add the filing date above to work out which monthly update is due.",
  queue_unknown: "The approval queue can't be reached, so we can't tell whether this month's update was already drafted.",
};

/** Monthly status updates while a mark awaits registration (stage 18). */
export function FilingFollowUpCard({ matterId, status }: { matterId: string; status: FollowUpStatus }) {
  const [state, action, pending] = useActionState<FollowUpActionState, FormData>(queueMonthlyStatusUpdateAction, {});
  if (state.queueItemId) return <Queued id={state.queueItemId} label="Status update drafted." />;
  if (status.kind !== "due") {
    return <p className={`lx-note${status.kind === "queue_unknown" || status.kind === "stale" ? " lx-warn-text" : ""}`}>{FOLLOW_UP_COPY[status.kind]}</p>;
  }
  return (
    <form action={action} className="mx-grid">
      <input type="hidden" name="matterId" value={matterId} />
      <p className="lx-note">
        Month {status.monthNumber} update is due. It drafts into the approval queue; nothing is sent.
      </p>
      <div>
        <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
          {pending ? SAVING : `Draft month ${status.monthNumber} update`}
        </button>
      </div>
      {state.error && (
          <Notice tone="risk" role="alert">
            {state.error}
          </Notice>
        )}
    </form>
  );
}
