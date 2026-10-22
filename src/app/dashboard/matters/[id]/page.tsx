import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import {
  activityForMatter,
  getMatter,
  listMatterDeadlines,
  listMatterStages,
  listTasks,
  loadMatterContacts,
  resolveMatterClientNameFrom,
  DEADLINE_CONFIRM_ROLES,
  DEADLINE_DELETE_ROLES,
  MATTER_WRITE_ROLES,
} from "@/lib/matters";
import { listMemberDirectory } from "@/lib/members/directory";
import { formatCivilDate, formatInternationalClasses, FILING_BASIS_LABEL } from "@/lib/matters/ip-fields";
import { CALCULATED_DEADLINE_NOTICE, daysUntil, deadlineKindLabel, deadlineSourceLabel } from "@/lib/matters/deadline-rules";
import { matterLabel } from "@/lib/matters/docket-summary";
import { matterStatusLabel } from "@/lib/matters/status";
import { BAND_COPY, bandOf, stageAge } from "@/lib/matters/worklist";
import { Timeline } from "@/components/timeline/Timeline";
import { meetingsFor } from "@/lib/meetings/read";
import { LinkedMeetings } from "@/components/meetings/LinkedMeetings";
import VoiceNoteRecorder from "@/components/voice/VoiceNoteRecorder";
import { FilingFollowUpCard, LitigationForm, WelcomeEmailCard } from "@/components/matters/MatterExtras";
import { addVoiceNoteAction } from "./actions";
import { orgHasModule } from "@/lib/org/modules";
import { loadSignedQuotesForMatter } from "@/lib/documents/loe-prefill-load";
import { getLitigationDetail } from "@/lib/matters/litigation";
import { toCourtDateTimeLocal } from "@/lib/matters/court-time";
import { voiceNotePlaybackUrls } from "@/lib/voice/notes";
import { AWAITING_REGISTRATION_STAGE_CODE, computeFollowUpStatus, type FollowUpStatus } from "@/lib/matters/filing-followup";
import { loadFollowUpQueueState, queuedMonthsLookupFor } from "@/lib/matters/filing-followup-queue";
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
import {
  ClientContactCard,
  ClosedDeadlineActions,
  DeadlineDelete,
  DeadlineEdit,
  HeaderEditForm,
  MatterNoteComposer,
  TaskControls,
} from "@/components/matters/MatterEdits";
import { IntakeRequestCard } from "@/components/matters/IntakeRequestCard";
import { DocumentsCard } from "@/components/files/DocumentsCard";
import { loadDocumentsRead } from "@/lib/files/read";
import { FILE_DELETE_ROLES, FILE_UPLOAD_ROLES } from "@/lib/files/roles";
import { AnswersCard } from "@/components/answers/AnswersCard";
import { loadMatterAnswers } from "@/lib/answers/load-answers";
import { getFirmTimeZone } from "@/lib/org/profile";
import { canSendIntakeRequest, listMatterIntakeRequests } from "@/lib/intake-forms/requests";
import { intakeOrigin } from "@/lib/intake-forms/origin";
import { PROPOSAL_STAFF_WRITE_ROLES } from "@/lib/proposals/types";
import { MatterProposalCard } from "@/components/matters/MatterProposalCard";
import { MATTER_TYPE_LABEL } from "../labels";
import { recordPageTitle } from "@/lib/ui/page-title";
import { matterDisplayTitle } from "@/lib/matters/display-title";

export const dynamic = "force-dynamic";

function countdown(days: number | null): string {
  if (days === null) return "";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "due today";
  return `in ${days}d`;
}

/** Tab title: the matter's display name through the scoped getter; "Matter" when the read fails or finds nothing. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return {
    title: await recordPageTitle(async () => {
      const matter = await getMatter(id);
      return matter ? matterDisplayTitle(matter).title : null;
    }, "Matter"),
  };
}

export default async function MatterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();

  // Through RLS, another firm's matter id is simply not found.
  const matter = await getMatter(id);
  if (!matter) notFound();

  // Per-firm modules (0040): litigation facts, and the agent-toolkit cards,
  // whose copy is written in one firm's voice. Each action re-checks.
  const [hasLitigation, hasAgentToolkit, hasDocumentCenter, hasProposals] = await Promise.all([
    orgHasModule("litigation"),
    orgHasModule("agent-toolkit"),
    orgHasModule("document-center"),
    // A module state that can't be read is "off": no link to New proposal.
    orgHasModule("proposals").catch(() => false),
  ]);
  const canStartProposal = hasProposals && PROPOSAL_STAFF_WRITE_ROLES.includes(session.role);

  const [stages, tasks, activity, deadlines, contactsRead, members, litigation] = await Promise.all([
    // null = could not read, which is not the same as "this firm has none".
    listMatterStages().catch(() => null),
    listTasks({ matterId: matter.id }),
    activityForMatter(matter.id),
    listMatterDeadlines(matter.id),
    // Three states (linked / none / unavailable); a failed read never takes the page down.
    loadMatterContacts(matter.id),
    // null = could not read the team list, which is not the same as "no teammates".
    listMemberDirectory().catch(() => null),
    matter.type === "LIT" && hasLitigation ? getLitigationDetail(matter.id) : Promise.resolve(null),
  ]);
  const primaryContact = contactsRead.status === "linked" ? (contactsRead.contacts.find((c) => c.role === "client") ?? null) : null;
  const client = await resolveMatterClientNameFrom(matter, primaryContact);
  const canSendIntake = canSendIntakeRequest(session.role);
  const canWrite = MATTER_WRITE_ROLES.includes(session.role);
  const [voiceUrls, intakeRequests, origin, meetings, signedQuotes, answersRead, tz, documentsRead] = await Promise.all([
    voiceNotePlaybackUrls(activity),
    // Intake questions (0079): a failed read says so on the card; it never
    // reads as "no links sent".
    listMatterIntakeRequests(matter.id),
    intakeOrigin(),
    meetingsFor({ matterId: matter.id }),
    // Only to decide whether to offer the pre-filled engagement letter, so only for someone who
    // could draft it. A failed read offers nothing extra; "Draft a letter" is still there.
    hasDocumentCenter && canWrite ? loadSignedQuotesForMatter(matter.id) : Promise.resolve(null),
    // The matter's answered intake requests, and the submissions and booth cards of the lead it came from.
    // Never throws: a failed source is named on the card.
    loadMatterAnswers(matter.id, matter.lead_id),
    getFirmTimeZone(),
    // Stored files, and the generated letters only for a firm with Document Center. Never throws:
    // each part reports its own failure on the card.
    loadDocumentsRead({ kind: "matter", id: matter.id }, { includeLetters: hasDocumentCenter }),
  ]);
  const hasSignedQuote = signedQuotes?.status === "ok" && signedQuotes.quotes.length > 0;

  // Monthly status updates: only for a mark awaiting registration, and only
  // one queue round trip for those matters.
  let followUp: FollowUpStatus | null = null;
  if (hasAgentToolkit && matter.mark_text && matter.stage?.code === AWAITING_REGISTRATION_STAGE_CODE) {
    const lookup = queuedMonthsLookupFor(await loadFollowUpQueueState());
    followUp = computeFollowUpStatus({ filingDate: matter.filing_date, monthsAlreadyQueued: lookup ? lookup.get(matter.id) ?? [] : null });
  }
  const welcome = activity.find((a) => (a.type as string) === "welcome_email");
  const welcomeQueueId = (welcome?.payload as { queueItemId?: string } | null)?.queueItemId ?? null;

  const canConfirm = (DEADLINE_CONFIRM_ROLES as readonly string[]).includes(session.role);
  const canDeleteDeadline = (DEADLINE_DELETE_ROLES as readonly string[]).includes(session.role);
  const openTasks = tasks.filter((t) => t.status === "open");
  const openDeadlines = deadlines.filter((d) => d.status === "open");
  const closedDeadlines = deadlines.filter((d) => d.status !== "open");
  const age = stageAge(matter);
  const band = BAND_COPY[bandOf(matter)];
  const memberList = (members ?? []).map((m) => ({ userId: m.userId, name: m.displayName ?? m.email ?? "Teammate" }));
  const ownerName = matter.assigned_to ? memberList.find((m) => m.userId === matter.assigned_to)?.name ?? "Teammate" : "Unassigned";
  const assigneeName = (userId: string) => memberList.find((m) => m.userId === userId)?.name ?? "a teammate";

  return (
    <>
      <Link href="/dashboard/matters/" className="lx-back">
        ← Matters
      </Link>
      <div className="lx-page-head" data-tour="matter-head">
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
              contactsRead.status === "unavailable" ? "Client contact couldn't be loaded" : "No client linked"
            )}
            {" · "}
            {band.label}
            {age.days !== null ? ` · ${age.days}d in stage` : ""}
            {matter.referral_source ? ` · Came from ${matter.referral_source}` : ""}
          </p>
          {canWrite && (
            <HeaderEditForm
              matterId={matter.id}
              values={{ title: matter.title, packageName: matter.package_name, type: matter.type, referralSource: matter.referral_source }}
            />
          )}
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
          <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }} data-tour="matter-deadlines">
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
                        >
                          <DeadlineEdit matterId={matter.id} deadlineId={d.id} title={d.title} dueDate={d.due_date} confirmed={d.attorney_confirmed} />
                          {canDeleteDeadline && !d.attorney_confirmed && (
                            <DeadlineDelete matterId={matter.id} deadlineId={d.id} label={d.title ?? deadlineKindLabel(d.kind)} dueDate={formatCivilDate(d.due_date) ?? d.due_date} />
                          )}
                        </DeadlineActions>
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
                  {closedDeadlines.map((d) => {
                    const label = d.title ?? deadlineKindLabel(d.kind);
                    const text = `${label} · ${formatCivilDate(d.due_date)} · ${d.status}`;
                    return canWrite ? (
                      <li key={d.id} className="lx-note" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                        <span>{text}</span>
                        <ClosedDeadlineActions
                          matterId={matter.id}
                          deadlineId={d.id}
                          label={label}
                          dueDate={formatCivilDate(d.due_date) ?? d.due_date}
                          canDelete={canDeleteDeadline && !d.attorney_confirmed}
                        />
                      </li>
                    ) : (
                      <li key={d.id} className="lx-note">
                        {text}
                      </li>
                    );
                  })}
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

          {matter.type === "LIT" && hasLitigation && (
            <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }}>
              <h2 className="lx-h2" style={{ fontSize: 23 }}>
                The case
              </h2>
              {canWrite ? (
                <LitigationForm
                  matterId={matter.id}
                  values={{
                    caseNumber: litigation?.case_number ?? null,
                    caseStyle: litigation?.case_style ?? null,
                    county: litigation?.county ?? null,
                    courtDivision: litigation?.court_division ?? null,
                    judge: litigation?.judge ?? null,
                    role: litigation?.role ?? null,
                    filedOn: litigation?.filed_on ?? null,
                    caseStatus: litigation?.case_status ?? null,
                    nextHearingAt: toCourtDateTimeLocal(litigation?.next_hearing_at ?? null),
                    nextHearingPurpose: litigation?.next_hearing_purpose ?? null,
                    noticeOfAppearance: litigation?.notice_of_appearance ?? null,
                    motionToDismiss: litigation?.motion_to_dismiss ?? null,
                    missedHearing: litigation?.missed_hearing ?? null,
                    defaultStatus: litigation?.default_status ?? null,
                    notes: litigation?.notes ?? null,
                  }}
                />
              ) : (
                <p className="lx-note" style={{ margin: 0 }}>
                  {litigation?.case_number ? `Case ${litigation.case_number}` : "No case details recorded yet."}
                  {litigation?.next_hearing_at ? ` · next hearing ${toCourtDateTimeLocal(litigation.next_hearing_at).replace("T", " ")}` : ""}
                </p>
              )}
            </section>
          )}

          {(followUp || (matter.type === "TM" && hasAgentToolkit)) && canWrite && (
            <section id="client-updates" className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }} data-tour="matter-updates">
              <h2 className="lx-h2" style={{ fontSize: 23 }}>
                Client updates
              </h2>
              {matter.type === "TM" && hasAgentToolkit && (
                <div style={{ display: "grid", gap: 6 }}>
                  <div className="lx-label">Welcome email</div>
                  <WelcomeEmailCard matterId={matter.id} alreadySent={!!welcome} sentQueueItemId={welcomeQueueId} />
                </div>
              )}
              {followUp && (
                <div style={{ display: "grid", gap: 6 }}>
                  <div className="lx-label">Monthly status update</div>
                  <FilingFollowUpCard matterId={matter.id} status={followUp} />
                </div>
              )}
            </section>
          )}

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

          <LinkedMeetings read={meetings} />

          <section className="lx-card" style={{ padding: 18 }}>
            <h2 className="lx-h2" style={{ fontSize: 23, marginBottom: 10 }}>
              Timeline
            </h2>
            {canWrite && (
              <div style={{ marginBottom: 14, display: "grid", gap: 14 }}>
                <MatterNoteComposer matterId={matter.id} />
                <VoiceNoteRecorder target={{ kind: "matter", id: matter.id }} action={addVoiceNoteAction} />
              </div>
            )}
            <Timeline rows={activity} mediaUrls={voiceUrls} />
          </section>
        </div>

        <aside className="lx-col lx-col-aside" data-tour="matter-aside">
          <ClientContactCard matterId={matter.id} read={contactsRead} canWrite={canWrite} />

          {canStartProposal && <MatterProposalCard matterId={matter.id} />}

          <section className="lx-card lx-aside">
            <div className="lx-label">Tasks</div>
            {openTasks.length === 0 ? (
              <p className="lx-note" style={{ margin: 0 }}>No open tasks.</p>
            ) : (
              <ul className="lx-list">
                {openTasks.map((t) => (
                  <li key={t.id} className="lx-task" style={canWrite ? { flexWrap: "wrap" } : undefined}>
                    <span>
                      {t.title}
                      {t.due_at && <span className="lx-note" style={{ display: "block" }}>Due {formatCivilDate(t.due_at.slice(0, 10))}</span>}
                      {t.assignee_id && <span className="lx-note" style={{ display: "block" }}>{`Assigned to ${assigneeName(t.assignee_id)}`}</span>}
                    </span>
                    {canWrite && <TaskDone matterId={matter.id} taskId={t.id} />}
                    {canWrite && (
                      <TaskControls
                        matterId={matter.id}
                        task={{ id: t.id, title: t.title, dueDate: t.due_at ? t.due_at.slice(0, 10) : null, assigneeId: t.assignee_id }}
                        members={members === null ? null : memberList}
                      />
                    )}
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

          {intakeRequests.status === "ok" ? (
            (canSendIntake || intakeRequests.requests.length > 0) && (
              <IntakeRequestCard
                matterId={matter.id}
                origin={origin}
                // The token IS the client's /r/ credential. Only people who may
                // copy or withdraw a link get it; everyone else sees status only.
                requests={canSendIntake ? intakeRequests.requests : intakeRequests.requests.map((r) => ({ ...r, token: "" }))}
                formReady={intakeRequests.formReady}
                canSend={canSendIntake}
              />
            )
          ) : intakeRequests.status === "unavailable" ? (
            <section className="lx-card lx-aside">
              <div className="lx-label">Intake questions</div>
              <p className="lx-note" style={{ margin: 0 }}>
                The intake links for this matter couldn&rsquo;t be loaded. This is a problem reaching the database, not an empty list.
              </p>
            </section>
          ) : null}

          <AnswersCard read={answersRead} tz={tz} />

          <DocumentsCard
            parent={{ kind: "matter", id: matter.id }}
            read={documentsRead}
            directory={members === null ? null : members.map((m) => ({ userId: m.userId, name: m.displayName ?? m.email ?? "" }))}
            canUpload={FILE_UPLOAD_ROLES.includes(session.role)}
            canDelete={FILE_DELETE_ROLES.includes(session.role)}
          />

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
            {hasDocumentCenter && canWrite && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {hasSignedQuote && (
                  <Link href={`/dashboard/documents/new/${matter.id}/loe/`} className="lx-btn lx-btn-pri lx-btn-sm">
                    Draft engagement letter
                  </Link>
                )}
                <Link href={`/dashboard/documents/new/${matter.id}/`} className="lx-btn lx-btn-sec lx-btn-sm">
                  Draft a letter
                </Link>
              </div>
            )}
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
