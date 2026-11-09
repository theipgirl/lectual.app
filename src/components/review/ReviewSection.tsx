import Link from "next/link";
import type { ReactNode } from "react";
import { BUCKET_COPY, type BucketKey, type ReviewRow } from "@/lib/review/buckets";
import { WAITING_LABEL } from "@/lib/review/waiting";
import { deadlineIsSoon, dueText, lastContactText, shortDate } from "@/lib/review/format";
import { DoneButton } from "./DoneButton";
import { openHref, type Common } from "./shared";
import "@/components/list-page/list-page.css";
import "./review.css";


export type SectionProps = Common & {
  bucket: BucketKey;
  rows: ReviewRow[];
};

export function ReviewTable({ rows, today, members, canWrite, params }: Omit<SectionProps, "bucket">) {
  const names = new Map(members.map((m) => [m.userId, m.name]));
  const who = (id: string | null) => (id ? names.get(id) ?? "Teammate" : null);
  return (
    <div style={{ overflow: "auto" }}>
      <table className="lx-tbl lx-stack">
        <thead>
          <tr>
            <th>Client</th>
            <th>Stage</th>
            <th>Assigned to</th>
            <th>Last contact</th>
            <th>Next step</th>
            <th>Waiting on</th>
            <th>USPTO deadline</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const due = r.nextStep ? dueText(r.nextStep.dueDate, today) : null;
            const stepWho = r.nextStep ? who(r.nextStep.assigneeId) : null;
            return (
              <tr key={r.key} className="lp-row">
                <td className="pri">
                  <Link href={openHref(params, r)} className="lx-rowlink" scroll={false}>
                    {r.client}
                  </Link>
                  <div className="lx-note">
                    {r.kind === "lead" ? "Lead" : "Matter"}
                    {r.mark ? ` · ${r.mark}` : ""}
                  </div>
                  {r.proposalExpiry && <span className={`lp-pill${r.proposalExpiry.expired ? " lp-pill-risk rv-deadline-soon" : ""}`}>{r.proposalExpiry.text}</span>}
                </td>
                <td data-label="Stage">
                  {r.stageLabel ? <span className="lp-pill">{r.stageLabel}</span> : <span className="lx-note">—</span>}
                  <span className="lx-note rv-sub">{r.stageDays !== null ? `${r.stageDays}d in stage` : r.stageNote ?? ""}</span>
                </td>
                <td data-label="Assigned to">{who(r.assignedTo) ?? <span className="lx-note">—</span>}</td>
                <td data-label="Last contact">{lastContactText(r, today)}</td>
                <td data-label="Next step">
                  {r.nextStep && due ? (
                    <>
                      {r.nextStep.title}
                      <span className={`lx-note rv-sub${due.overdue ? " rv-deadline-soon" : ""}`}>
                        {due.text}
                        {stepWho ? ` · ${stepWho}` : ""}
                      </span>
                    </>
                  ) : (
                    <span className="lx-note">No next step</span>
                  )}
                </td>
                <td data-label="Waiting on">
                  {r.waiting ? <span className={`lp-pill rv-chip-${r.waiting}${r.waiting === "approval" ? " lp-pill-warn" : ""}`}>{WAITING_LABEL[r.waiting]}</span> : <span className="lx-note">—</span>}
                </td>
                <td data-label="USPTO deadline" className="lx-num">
                  {r.deadline ? (
                    <span className={deadlineIsSoon(r.deadline.dueDate, today) ? "rv-deadline-soon" : undefined}>
                      {shortDate(r.deadline.dueDate, today)}
                      {r.deadline.title ? <span className="lx-note rv-sub">{r.deadline.title}</span> : null}
                    </span>
                  ) : (
                    <span className="lx-note">—</span>
                  )}
                </td>
                <td data-label="Actions">
                  <div className="rv-card-acts">
                    {canWrite && r.nextStep && <DoneButton taskId={r.nextStep.id} />}
                    <Link href={openHref(params, r)} className="lx-btn lx-btn-ghost lx-btn-sm" scroll={false}>
                      Open
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One section. The collapsed ones are a closed <details> with the count in the summary. */
export function ReviewSection({ bucket, collapsed, ...rest }: SectionProps & { collapsed?: boolean }): ReactNode {
  const copy = BUCKET_COPY[bucket];
  if (rest.rows.length === 0) return null;
  if (collapsed) {
    return (
      <details className="lx-card lx-disclosure" aria-labelledby={`rv-${bucket}`}>
        <summary id={`rv-${bucket}`}>
          {copy.label} ({rest.rows.length})
        </summary>
        <ReviewTable {...rest} />
      </details>
    );
  }
  return (
    <section className="lx-card lx-band" aria-labelledby={`rv-${bucket}`}>
      <header className="lx-band-head">
        <h2 id={`rv-${bucket}`} className="lx-h2">
          {copy.label}
        </h2>
        <span className="lx-note">
          {rest.rows.length} · {copy.hint}
        </span>
      </header>
      <ReviewTable {...rest} />
    </section>
  );
}
