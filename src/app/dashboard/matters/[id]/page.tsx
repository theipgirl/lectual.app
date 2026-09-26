import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import {
  activityForMatter,
  getMatter,
  listMatterDeadlines,
  listMatterStages,
  listTasks,
  resolveMatterClientName,
  DEADLINE_CONFIRM_ROLES,
  MATTER_WRITE_ROLES,
} from "@/lib/matters";
import { listMemberDirectory } from "@/lib/members/directory";
import { formatCivilDate, formatInternationalClasses, FILING_BASIS_LABEL } from "@/lib/matters/ip-fields";
import { CALCULATED_DEADLINE_NOTICE, daysUntil, deadlineKindLabel, deadlineSourceLabel } from "@/lib/matters/deadline-rules";
import { matterLabel } from "@/lib/matters/docket-summary";
import { matterStatusLabel } from "@/lib/matters/status";
import { BAND_COPY, bandOf, stageAge } from "@/lib/matters/worklist";
import { relativeTime } from "@/lib/relative-time";
import { describeActivity } from "@/components/leads/describe";
import {
  DeadlineActions,
  DeadlineComposer,
  FilingForm,
  NotesForm,
  OwnerSelect,
  StageSelect,
  StatusSelect,
  TaskComposer,
  TaskDone,
} from "@/components/matters/MatterForms";
import { MATTER_TYPE_LABEL } from "../labels";

export const dynamic = "force-dynamic";

function countdown(days: number | null): string {
  if (days === null) return "";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "due today";
  return `in ${days}d`;
}

export default async function MatterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();

  // Through RLS, another firm's matter id is simply not found.
  const matter = await getMatter(id);
  if (!matter) notFound();

  const [stages, tasks, activity, deadlines, client, members] = await Promise.all([
    listMatterStages().catch(() => []),
    listTasks({ matterId: matter.id }),
    activityForMatter(matter.id),
    listMatterDeadlines(matter.id),
    resolveMatterClientName(matter),
    listMemberDirectory().catch(() => []),
  ]);

  const canWrite = MATTER_WRITE_ROLES.includes(session.role);
  const canConfirm = (DEADLINE_CONFIRM_ROLES as readonly string[]).includes(session.role);
  const openTasks = tasks.filter((t) => t.status === "open");
  const openDeadlines = deadlines.filter((d) => d.status === "open");
  const closedDeadlines = deadlines.filter((d) => d.status !== "open");
  const age = stageAge(matter);
  const band = BAND_COPY[bandOf(matter)];
  const memberList = members.map((m) => ({ userId: m.userId, name: m.displayName ?? m.email ?? "Teammate" }));
  const ownerName = matter.assigned_to ? memberList.find((m) => m.userId === matter.assigned_to)?.name ?? "Teammate" : "Unassigned";

  return (
    <>
      <Link href="/dashboard/matters/" className="lx-back">
        ← Matters
      </Link>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">
            {MATTER_TYPE_LABEL[matter.type]} · <span className="lx-num">{matter.matter_number}</span>
          </div>
          <h1 className="lx-h1">{matterLabel(matter)}</h1>
          <p className="lx-note" style={{ margin: "6px 0 0" }}>
            {client.name ? (
              <>
                {client.source === "lead" && matter.lead_id ? <Link href={`/dashboard/leads/${matter.lead_id}/`}>{client.name}</Link> : client.name}
                {client.source === "owner_name" ? " (from the tracker)" : ""}
              </>
            ) : (
              "No client linked"
            )}
            {" · "}
            {band.label}
            {age.days !== null ? ` · ${age.days}d in stage` : ""}
          </p>
        </div>
        {canWrite ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <StageSelect matterId={matter.id} stageId={matter.stage_id} stages={stages} />
            <StatusSelect matterId={matter.id} status={matter.status} />
            <OwnerSelect matterId={matter.id} assignedTo={matter.assigned_to} members={memberList} />
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="lx-pill lx-pill-mute">{matter.stage ? `${matter.stage.code}. ${matter.stage.label}` : "No stage"}</span>
            <span className="lx-pill lx-pill-mute">{matterStatusLabel(matter.status)}</span>
          </div>
        )}
      </div>

      {age.stale && (
        <p className="lx-banner lx-banner-warn" style={{ margin: 0 }}>
          This matter has sat in <b>{matter.stage?.label}</b> for {age.days} days, past the point the firm usually moves it.
        </p>
      )}

      <div className="lx-split">
        <div className="lx-col">
          <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <h2 className="lx-h2" style={{ fontSize: 23 }}>
                Deadlines
              </h2>
              <span className="lx-note">{openDeadlines.length} open</span>
            </div>
            {openDeadlines.length === 0 ? (
              <p className="lx-note" style={{ margin: 0 }}>
                Nothing docketed. Nothing is ever docketed automatically; add dates below.
              </p>
            ) : (
              <ul className="lx-list">
                {openDeadlines.map((d) => {
                  const days = daysUntil(d.due_date);
                  return (
                    <li key={d.id} className="lx-deadline">
                      <div className="lx-deadline-main">
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <b>{d.title ?? deadlineKindLabel(d.kind)}</b>
                          {!d.attorney_confirmed && (
                            <span className="lx-pill lx-pill-warn" title={CALCULATED_DEADLINE_NOTICE}>
                              Unconfirmed
                            </span>
                          )}
                        </div>
                        <span className="lx-note">
                          {deadlineSourceLabel(d.source)}
                          {d.calculation_basis ? ` · ${d.calculation_basis}` : ""}
                          {d.is_extendable ? ` · ${d.extensions_used} of ${d.max_extensions ?? "unlimited"} extensions used` : ""}
                        </span>
                        {d.notes && <span className="lx-note">{d.notes}</span>}
                      </div>
                      <div className="lx-deadline-due">
                        <span className="lx-num">{formatCivilDate(d.due_date)}</span>
                        <span className={`lx-pill ${days !== null && days < 0 ? "lx-pill-risk" : days !== null && days <= 14 ? "lx-pill-warn" : "lx-pill-mute"}`}>{countdown(days)}</span>
                      </div>
                      {canWrite && (
                        <DeadlineActions
                          matterId={matter.id}
                          deadlineId={d.id}
                          confirmed={d.attorney_confirmed}
                          canConfirm={canConfirm}
                          extendable={d.is_extendable && (d.max_extensions === null || d.extensions_used < d.max_extensions)}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {closedDeadlines.length > 0 && (
              <details>
                <summary className="lx-note">{closedDeadlines.length} closed out</summary>
                <ul className="lx-list" style={{ marginTop: 8 }}>
                  {closedDeadlines.map((d) => (
                    <li key={d.id} className="lx-note">
                      {d.title ?? deadlineKindLabel(d.kind)} · {formatCivilDate(d.due_date)} · {d.status}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {canWrite && (
              <details className="lx-disclosure-inline">
                <summary>Docket a deadline</summary>
                <DeadlineComposer matterId={matter.id} filingBasis={matter.filing_basis} />
              </details>
            )}
          </section>

          <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }}>
            <h2 className="lx-h2" style={{ fontSize: 23 }}>
              The filing
            </h2>
            {canWrite ? (
              <FilingForm
                matterId={matter.id}
                values={{
                  markText: matter.mark_text,
                  serialNumber: matter.serial_number,
                  registrationNumber: matter.registration_number,
                  filingBasis: matter.filing_basis,
                  filingDate: matter.filing_date,
                  registrationDate: matter.registration_date,
                  internationalClasses: formatInternationalClasses(matter.international_classes),
                  goodsServices: matter.goods_services,
                  examiningAttorney: matter.examining_attorney,
                  usptoStatus: matter.uspto_status,
                  usptoStatusAsOf: matter.uspto_status_as_of,
                }}
              />
            ) : (
              <div className="lx-facts" style={{ padding: 0 }}>
                {[
                  ["Serial no.", matter.serial_number],
                  ["Filed", formatCivilDate(matter.filing_date)],
                  ["Basis", matter.filing_basis ? FILING_BASIS_LABEL[matter.filing_basis] : null],
                  ["Classes", formatInternationalClasses(matter.international_classes) || null],
                  ["Registration no.", matter.registration_number],
                  ["USPTO status", matter.uspto_status],
                ].map(([k, v]) => (
                  <div key={k} className="lx-meta">
                    <span>{k}</span>
                    <span>{v ?? "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="lx-card" style={{ padding: 18 }}>
            <h2 className="lx-h2" style={{ fontSize: 23, marginBottom: 10 }}>
              Timeline
            </h2>
            {activity.length === 0 ? (
              <p className="lx-note">Nothing yet.</p>
            ) : (
              <ol className="lx-timeline">
                {activity.slice(0, 100).map((r) => {
                  const d = describeActivity(r);
                  return (
                    <li key={r.id} data-tone={d.tone}>
                      <div className="lx-timeline-head">
                        <span>{d.title}</span>
                        <span className="lx-note">{relativeTime(r.created_at)}</span>
                      </div>
                      {d.detail && <p>{d.detail}</p>}
                      {d.link && (
                        <a href={d.link} target="_blank" rel="noreferrer noopener" className="lx-note">
                          Open in mail
                        </a>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        <aside className="lx-col lx-col-aside">
          <section className="lx-card lx-aside">
            <div className="lx-label">Tasks</div>
            {openTasks.length === 0 ? (
              <p className="lx-note" style={{ margin: 0 }}>No open tasks.</p>
            ) : (
              <ul className="lx-list">
                {openTasks.map((t) => (
                  <li key={t.id} className="lx-task">
                    <span>
                      {t.title}
                      {t.due_at && <span className="lx-note" style={{ display: "block" }}>Due {formatCivilDate(t.due_at.slice(0, 10))}</span>}
                    </span>
                    {canWrite && <TaskDone matterId={matter.id} taskId={t.id} />}
                  </li>
                ))}
              </ul>
            )}
            {canWrite && <TaskComposer matterId={matter.id} />}
          </section>

          <section className="lx-card lx-aside">
            <div className="lx-label">Notes</div>
            {canWrite ? <NotesForm matterId={matter.id} notes={matter.notes} /> : <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{matter.notes ?? "—"}</p>}
          </section>

          <section className="lx-card lx-aside">
            <div className="lx-label">About</div>
            <div className="lx-meta">
              <span>Owner</span>
              <span>{ownerName}</span>
            </div>
            <div className="lx-meta">
              <span>Opened</span>
              <span>{formatCivilDate(matter.opened_at.slice(0, 10))}</span>
            </div>
            <div className="lx-meta">
              <span>Package</span>
              <span>{matter.package_name ?? "—"}</span>
            </div>
            <div className="lx-meta">
              <span>Came from</span>
              <span>{matter.referral_source ?? "—"}</span>
            </div>
            {!canWrite && <p className="lx-note">Your role can view this matter but not change it.</p>}
          </section>
        </aside>
      </div>
    </>
  );
}
