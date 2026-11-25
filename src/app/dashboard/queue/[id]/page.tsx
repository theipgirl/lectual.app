import Link from "next/link";
import { shownRecipient } from "@/lib/queue/shown-recipient";
import { BackLink, PageHeader } from "@/components/ui/PageHeader";
import { Notice } from "@/components/ui/Notice";
import { Pill } from "@/components/ui/Pill";
import { notFound } from "next/navigation";
import { getQueueItem, type QueueItem } from "@/lib/queue/api";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { QUEUE_EDIT_ROLES } from "@/lib/queue/roles";
import { previewingAs, viewerQueueRole } from "@/lib/views/view-as";
import { VIEW_AS_PRIVATE_OUTLOOK } from "@/lib/ui/words";
import { QueueUnavailable } from "@/components/queue/QueueUnavailable";
import { ReviewPanel } from "@/components/queue/ReviewPanel";
import { getFirmTimeZone } from "@/lib/org/profile";
import { isDoneItem } from "@/lib/queue/done";
import { agentLabel, statusPill, fmtWhen, isUnconfiguredError, outcomeText, typeLabel } from "@/components/queue/format";
import { checkDraftStaleness, type StaleCheck } from "@/lib/queue/stale";
import { staleWarning } from "@/components/queue/stale-warning";
import { Markdown } from "@/components/markdown/Markdown";
import { LinkedProposalPanel } from "@/components/queue/LinkedProposalPanel";
import { ReviewerSummary } from "@/components/queue/ReviewerSummary";
import "@/components/queue/review.css";
import { loadLinkedPanel } from "@/lib/consult-proposal/link";
import { loadQueueViewContext } from "@/lib/queue/view-context";
import { approvalRefusal, canApproveItem, classifyQueueItem, kindLabel, memberName, ownerText } from "@/lib/queue/routing";
import { loadCardState } from "@/lib/queue/card-state";
import { currentHolder, trustedCardState, viewEventTrust } from "@/lib/queue/deck";
import { handedCantApprove } from "@/lib/queue/handed";
import { HandedToYouCard } from "@/components/queue/HandedToYouCard";
import { loadAuditContext } from "@/lib/queue/audit-context";
import type { Metadata } from "next";
import { recordPageTitle } from "@/lib/ui/page-title";
import {
  A_TEAMMATE,
  APPROVALS_NAME,
  MAKE_DRAFT_CHANGED,
  MAKE_DRAFT_CHECK_DRAFTS,
  MAKE_DRAFT_COULDNT_CHECK,
  MAKE_DRAFT_NEEDS_PERMISSION,
  MAKE_DRAFT_NO_OUTLOOK,
  MAKE_DRAFT_NOT_OUTLOOK,
  MAKE_DRAFT_OUTLOOK_UNREAD,
  PASS_NOT_SWITCHED_ON,
  QUEUE_DRAFTED_ANYWAY,
  READY_TO_DRAFT,
  SEND_BACK_DONE,
  makeDraftIntro,
} from "@/lib/ui/words";
import { approvedBy, approvedTextMatches, draftAssignment, passFailedRecorded, receiptMatchesCurrent } from "@/lib/queue/draft-handoff";
import { RetryPassCard } from "@/components/queue/RetryPassCard";
import { myOutlookDraftAccess } from "@/lib/mailbox/my-mailbox";
import { MakeDraftCard, type MakeDraftView } from "@/components/queue/MakeDraftCard";
import { INTEGRATIONS_PATH } from "@/lib/setup/routes";

/** Tab title: the item's headline, so several open approvals can be told apart; "Approval" when it can't be read. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return {
    title: await recordPageTitle(async () => {
      const key = await activeQueueOrgKey();
      if (!key) return null;
      return (await getQueueItem(key, id)).headline?.trim() || null;
    }, "Approval"),
  };
}

/** One row of the aside's detail list; nothing is drawn for a value the item doesn't have. */
function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

export default async function QueueItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ resolved?: string; send?: string; returned?: string; pass?: string }>;
}) {
  const { id } = await params;
  const { resolved: justResolved, send, returned, pass } = await searchParams;

  // Outside the try on purpose: notFound() throws a control-flow error that a
  // catch would turn into "couldn't reach the queue" (a lesson from lectual).
  const qKey = await activeQueueOrgKey();
  if (!qKey) notFound();

  let item: QueueItem | null = null;
  let loadError: unknown = null;
  try {
    item = await getQueueItem(qKey, id);
  } catch (err) {
    loadError = err;
  }

  // Drawn for the VIEWER (View as: the teammate's role while previewing); the actions re-check with the session.
  const [editRole, tz, view] = await Promise.all([
    viewerQueueRole(QUEUE_EDIT_ROLES),
    getFirmTimeZone(),
    loadQueueViewContext(),
  ]);

  if (loadError) {
    return (
      <>
        <BackLink href="/dashboard/queue/" label={APPROVALS_NAME} />
        <QueueUnavailable status={isUnconfiguredError(loadError) ? "unconfigured" : "unavailable"} reason="env" />
      </>
    );
  }
  if (!item) notFound();

  // The routing rule decides who may approve THIS item; the action decides again on submit.
  const routeArgs = { role: editRole, userId: view.viewer?.userId, item, routing: view.routing, members: view.members ?? [] };
  const mayApprove = canApproveItem(routeArgs);
  const refusal = approvalRefusal(routeArgs);
  const drafterMember = view.drafter ? (view.members ?? []).find((m) => m.userId === view.drafter) : undefined;
  const outcome = outcomeText(justResolved, send, isDoneItem(item), drafterMember ? memberName(drafterMember) : null);
  const resolved = item.status !== "pending";

  // Handed to the viewer right now? Additive: read only while pending, shown only when the events were READ and the
  // current hand-off target is this person. A failed or missing read draws nothing and changes nothing else.
  let handedCard: { byName: string; when: string; note: string | null; cantApprove: string | null } | null = null;
  if (!resolved && view.viewer) {
    // Forged hand-offs (any staff member can insert one) are left out: the deck's own rule.
    const events = trustedCardState(await loadCardState([item.id]), [item], viewEventTrust(view));
    const holder = events.status === "ok" ? currentHolder(events.events, item.id) : null;
    if (holder && holder.userId === view.viewer.userId) {
      const by = (view.members ?? []).find((m) => m.userId === holder.by);
      handedCard = {
        byName: by ? memberName(by) : A_TEAMMATE,
        when: fmtWhen(holder.at, tz),
        note: holder.note,
        cantApprove: handedCantApprove({ canApprove: mayApprove, item, routing: view.routing, members: view.members ?? [] }),
      };
    }
  }

  // Sprint 4: an approved client email passed to THIS viewer for their own "Make the draft" click. Only the current
  // draft_to target (trusted events only) sees the card; a failed read is "couldn't check" for the configured drafter.
  // Read only while the firm has a drafter set, so a firm without one renders exactly as before.
  let makeDraft: { intro: string; view: MakeDraftView } | null = null;
  let retryPass: { drafterName: string } | null = null;
  const previewing = await previewingAs();
  if (view.drafter && resolved && item.status === "approved" && item.type === "CLIENT_EMAIL" && view.viewer && editRole) {
    const trust = viewEventTrust(view);
    const events = trustedCardState(await loadCardState([item.id]), [item], trust);
    if (events.status === "ok" && trust.status === "known") {
      const a = draftAssignment(events.events, item.id);
      const me = (view.members ?? []).find((m) => m.userId === view.viewer?.userId);
      // S3: the approver may pass it again ONLY when the outcome recorded at approval was a failed pass (a trusted
      // `pass_failed` marker), no trusted draft_to exists, and the receipt still names the text. The action checks it all again.
      if (!a && passFailedRecorded(events.events, item.id) && view.drafter !== view.viewer.userId && approvedBy(item, me?.email) && receiptMatchesCurrent(item) && drafterMember) {
        retryPass = { drafterName: memberName(drafterMember) };
      }
      if (a && a.target === view.viewer.userId) {
        const by = (view.members ?? []).find((m) => m.userId === a.by);
        const intro = makeDraftIntro(by ? memberName(by) : A_TEAMMATE);
        // "Drafted" only when confirmed. A claimed attempt with no outcome says to check Drafts and shows the approved text.
        if (a.progress.kind === "drafted") makeDraft = { intro, view: { kind: "drafted" } };
        else if (a.progress.kind === "drafting") makeDraft = { intro, view: { kind: "check-drafts", sentence: MAKE_DRAFT_CHECK_DRAFTS, text: item.final_body ?? item.draft_body } };
        else if (!approvedTextMatches(item, a.sha)) makeDraft = { intro, view: { kind: "blocked", sentence: MAKE_DRAFT_CHANGED, connect: null } };
        else if (previewing) {
          // View as: the teammate's own Outlook isn't checked (the owner's own connection would answer).
          makeDraft = { intro, view: { kind: "blocked", sentence: VIEW_AS_PRIVATE_OUTLOOK(previewing.name), connect: null } };
        } else {
          const access = await myOutlookDraftAccess();
          const blocked: Record<Exclude<typeof access, "ready">, MakeDraftView> = {
            "no-mailbox": { kind: "blocked", sentence: MAKE_DRAFT_NO_OUTLOOK, connect: INTEGRATIONS_PATH },
            "not-outlook": { kind: "blocked", sentence: MAKE_DRAFT_NOT_OUTLOOK, connect: INTEGRATIONS_PATH },
            "needs-permission": { kind: "blocked", sentence: MAKE_DRAFT_NEEDS_PERMISSION, connect: INTEGRATIONS_PATH },
            unavailable: { kind: "blocked", sentence: MAKE_DRAFT_OUTLOOK_UNREAD, connect: null },
            "not-yours": { kind: "blocked", sentence: MAKE_DRAFT_OUTLOOK_UNREAD, connect: null },
          };
          makeDraft = { intro, view: access === "ready" ? { kind: "ready" } : blocked[access] };
        }
      }
    } else if (events.status !== "not-set-up" && view.drafter && view.drafter === view.viewer.userId) {
      makeDraft = { intro: READY_TO_DRAFT, view: { kind: "blocked", sentence: MAKE_DRAFT_COULDNT_CHECK, connect: null } };
    }
  }

  // SOP §2.5: has this client signed, paid or become a client since the
  // draft was queued? Never auto-rejects — a person decides, with the fact in
  // front of them, and the action re-checks before it approves.
  const stale = resolved ? ({ status: "not_applicable" } as StaleCheck) : await checkDraftStaleness(item);
  const warning = staleWarning(stale, tz);
  // The proposal the consult agent drafted with this email, if any.
  const linkedProposal = await loadLinkedPanel(item.id);
  // Who signed it, and what is still left in it, is only worth checking while it can still be approved.
  const auditContext = resolved ? null : await loadAuditContext();

  return (
    <>
      <PageHeader back={{ href: "/dashboard/queue/", label: APPROVALS_NAME }} title={item.headline} details={`${typeLabel(item.type)} · ${agentLabel(item.agent)}`} />
      <div className="lx-split lx-qi">
        <div className="lx-col">
          {outcome && (
            <Notice role="status" tone={outcome.tone === "ok" ? "ok" : outcome.tone === "risk" ? "risk" : "mute"}>
              {outcome.text}
            </Notice>
          )}
          {justResolved === "approve" && (pass === "off" || pass === "queue") && (
            <Notice role="status" tone="warn">
              {pass === "off" ? PASS_NOT_SWITCHED_ON : QUEUE_DRAFTED_ANYWAY}
            </Notice>
          )}
          {makeDraft && <MakeDraftCard id={item.id} intro={makeDraft.intro} view={makeDraft.view} />}
          {retryPass && <RetryPassCard id={item.id} drafterName={retryPass.drafterName} />}
          {returned === "1" && (
            <Notice role="status" tone="ok">
              {SEND_BACK_DONE}
            </Notice>
          )}
          {warning && (
            <Notice
              role="alert"
              tone={stale.status === "stale" ? "risk" : "warn"}
              title={warning.headline}
              action={
                stale.status !== "unavailable" && "leadIds" in stale && stale.leadIds[0] ? (
                  <Link href={`/dashboard/leads/${stale.leadIds[0]}/`}>Open {stale.leadName ?? "the lead"}</Link>
                ) : undefined
              }
            >
              <span>{warning.detail}</span>
            </Notice>
          )}
          {stale.status === "unlinked" && (
            <p className="lx-note">
              This draft isn&apos;t linked to a lead, so Lectual couldn&apos;t check whether the client has signed or paid since it
              was queued. Check before approving.
            </p>
          )}
          {handedCard && <HandedToYouCard id={item.id} byName={handedCard.byName} when={handedCard.when} note={handedCard.note} cantApprove={handedCard.cantApprove} />}
          <section className="lx-card lx-qi-card lx-pad">
            {resolved ? (
              <>
                <div className="lx-label lx-qi-draft-label">
                  {item.final_body && item.final_body !== item.draft_body ? "Final, as approved" : "Draft"}
                </div>
                <Markdown text={item.final_body ?? item.draft_body} />
              </>
            ) : (
              <>
              {!mayApprove && editRole !== null && refusal && !handedCard && (
                <p role="status" className="lx-note lx-qi-refusal" data-queue-refusal>
                  {refusal}
                </p>
              )}
              <ReviewPanel
                id={item.id}
                initialBody={item.final_body ?? item.draft_body}
                canApprove={mayApprove}
                canEdit={editRole !== null}
                confirmStale={warning ? warning.confirm : null}
                audit={auditContext ? { type: item.type, ...auditContext } : undefined}
              />
              </>
            )}
          </section>
        </div>
        <aside className="lx-card lx-aside lx-qi-aside">
          <span className="lx-qi-status">
            <Pill tone={statusPill(item).tone}>{statusPill(item).label}</Pill>
          </span>
          <p className="lx-note lx-qi-owner" data-queue-owner>
            {kindLabel(classifyQueueItem(item))} · {ownerText(item, view.routing, view.members ?? [])}
          </p>
          {/* Client, To, Subject, Send at and Queued as one compact definition list. */}
          <dl className="lx-dl lx-qi-facts" data-queue-details>
            <Meta label="Client" value={item.client_name} />
            <Meta label="To" value={shownRecipient(item)} />
            <Meta label="Subject" value={item.subject} />
            <Meta label="Send at" value={item.proposed_send_at ? fmtWhen(item.proposed_send_at, tz) : null} />
            <Meta label="Attachments" value={item.attachments?.length ? item.attachments.map((a) => a.name).join(", ") : null} />
            <Meta label="Queued" value={fmtWhen(item.created_at, tz)} />
            {resolved && (
              <>
                <Meta label="Resolved" value={fmtWhen(item.resolved_at, tz)} />
                <Meta label="By" value={item.resolved_by} />
                <Meta label="Note" value={item.resolution_note} />
              </>
            )}
          </dl>
          <LinkedProposalPanel panel={linkedProposal} pending={!resolved} />
          <ReviewerSummary summary={item.summary} />
        </aside>
      </div>
    </>
  );
}
