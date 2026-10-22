import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { getFirmTimeZone } from "@/lib/org/profile";
import { listMemberDirectory, type MemberIdentity } from "@/lib/members/directory";
import { getSiteOrigin } from "@/lib/site-origin";
import { formatCents } from "@/lib/quotes/money";
import { formatFirmStamp, formatShortFirmDate } from "@/lib/quotes/labels";
import { ProposalError } from "@/lib/proposals/errors";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";
import { getProposal, getProposalSettings, isCurrentUserApprover, listProposalStepEvents, type ProposalDetail } from "@/lib/proposals/store";
import { PROPOSAL_PAID_ROLES } from "@/lib/proposals/paid";
import { buildPaidPanelView } from "@/lib/proposals/paid-view";
import { PROPOSAL_STAFF_WRITE_ROLES, isProposalEditable, type ProposalRow } from "@/lib/proposals/types";
import { validateContent } from "@/lib/proposals/validate";
import { describeProposalEvent } from "@/lib/proposal-editor/events";
import { describeIssuePath, groupIssues } from "@/lib/proposal-editor/issues";
import { firstNameOf, joinOr, statusLabel, statusTone } from "@/lib/proposal-editor/labels";
import { moneyInput } from "@/lib/proposal-editor/form";
import { buildProposalCard } from "@/lib/proposals/card";
import { loadConsultStrip } from "@/lib/proposals/consult-strip-load";
import { ProposalDocument } from "@/components/client-proposal/ProposalDocument";
import { ConsultStrip } from "@/components/proposal-editor/ConsultStrip";
import { ProposalCard } from "@/components/proposal-editor/ProposalCard";
import { IssueList, type ShownIssue } from "@/components/proposal-editor/ActionForm";
import { Lifecycle } from "@/components/proposal-editor/Lifecycle";
import { PaidPanel } from "@/components/proposal-editor/PaidPanel";
import {
  AddNameForm,
  AdjustmentsForm,
  DetailsForm,
  IncludesForm,
  MessageForm,
  NameCard,
  PricingForm,
  type NameValues,
} from "@/components/proposal-editor/Sections";
import { GOES_LIVE_ON_APPROVAL, proposalSendBlock } from "@/lib/consult-proposal/link";
import { requireProposalsModule } from "../gate";
import "../proposals.css";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle("Client proposal") };

export const dynamic = "force-dynamic";

/**
 * The proposal editor: one version of one client offer.
 *
 * ── GATES ───────────────────────────────────────────────────────────────────
 * The `proposals` module first (notFound when off), then the row itself: a
 * wrong id or another firm's is `notFound()` (RLS makes those the same). Anyone
 * in the firm can open it; `canWrite` (the staff roles, mirroring 0089's RLS)
 * decides whether the forms are live, and every action re-checks it.
 *
 * ── WHAT IS EDITABLE ────────────────────────────────────────────────────────
 * Only draft and approved versions. Editing an approved one sends it back to
 * draft (the database trigger does that and the action says so). A sent version
 * is read-only here: Revise starts the next one.
 *
 * ── THE PREVIEW ─────────────────────────────────────────────────────────────
 * Rendered from the SAVED content, by the same component the client's page
 * uses (mode "preview": the boxes work, Accept is disabled), so it can never
 * disagree with it. It refreshes when a section is saved.
 */
export default async function ProposalEditorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProposalsModule();
  const { id } = await params;
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();
  const canWrite = PROPOSAL_STAFF_WRITE_ROLES.includes(session.role);

  let detail: ProposalDetail | null;
  try {
    detail = await getProposal(id);
  } catch (err) {
    return (
      <>
        <Link href="/dashboard/proposals/" className="lx-back">
          ← Client proposals
        </Link>
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            This proposal couldn&apos;t be loaded
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            {err instanceof ProposalError && err.code === "unavailable"
              ? "This is a problem reaching the database, not a missing proposal. Try again shortly."
              : "Try again shortly."}
          </p>
        </div>
      </>
    );
  }
  if (!detail) notFound();
  const { proposal, versions, events } = detail;
  const content = proposal.content;

  const [tz, members, settings, isApprover, origin, consult, stepRead] = await Promise.all([
    getFirmTimeZone(),
    listMemberDirectory().catch((): MemberIdentity[] => []),
    getProposalSettings().catch(() => null),
    isCurrentUserApprover(),
    getSiteOrigin(),
    proposal.lead_id ? loadConsultStrip(proposal.lead_id) : Promise.resolve(null),
    // Only an accepted version has a payment panel. A failed read is `{ ok: false }`, never "not paid".
    proposal.status === "accepted" ? listProposalStepEvents(proposal.id) : Promise.resolve(null),
  ]);
  // The family's events are already loaded, so the card needs no extra read.
  const card = buildProposalCard(proposal, events);

  const nameOf = new Map<string, string>();
  for (const m of members) nameOf.set(m.userId, firstNameOf(m.displayName) ?? firstNameOf(m.email) ?? "A teammate");
  const approverNames = (settings?.approver_user_ids ?? []).map((uid) => nameOf.get(uid)).filter((n): n is string => !!n);

  const statusEditable = isProposalEditable(proposal.status);
  const editable = statusEditable && canWrite;

  /* ── validation, shown beside the form that can fix it ── */
  const issues = statusEditable
    ? validateContent(content, {
        forApproval: true,
        title: proposal.title,
        expires_on: proposal.expires_on,
        pay_url: proposal.pay_url,
        client_email: proposal.client_email,
      })
    : [];
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.length - errors;
  const shown = (list: typeof issues): ShownIssue[] =>
    list.map((i) => ({ level: i.level, message: i.message, where: describeIssuePath(i.path, content) }));
  const groups = groupIssues(issues);

  /* ── the figures at the firm's own pre-ticked offer ── */
  const quote = quoteProposal(content, defaultSelection(content));
  const latest = versions[0];
  const newer = latest && latest.version > proposal.version ? latest : null;

  // A consult-agent proposal goes live by approving its email in the queue, so
  // "Mark as sent" is replaced by a note while that email is pending (or unreadable).
  const sendBlock =
    canWrite && proposal.status === "approved" && proposal.source === "agent" ? await proposalSendBlock(proposal.id) : ({ blocked: false } as const);

  const clientUrl = proposal.status === "approved" || proposal.status === "sent" ? `${origin}/p/${proposal.public_token}/` : null;

  const readOnlyNote = readOnlyText(proposal, canWrite, approverNames);

  const paidView = stepRead
    ? buildPaidPanelView({
        proposalId: proposal.id,
        matterId: proposal.matter_id,
        events: stepRead.ok ? stepRead.events : null,
        // Real names only: a teammate we can't name is left out of "marked by", not shown as "A teammate".
        names: new Map(members.flatMap((m): Array<[string, string]> => {
          const n = firstNameOf(m.displayName) ?? firstNameOf(m.email);
          return n ? [[m.userId, n]] : [];
        })),
        tz,
        canAct: PROPOSAL_PAID_ROLES.includes(session.role),
      })
    : null;

  const versionOf = new Map(versions.map((v) => [v.id, v.version]));
  const log = events.map((e) => ({ line: describeProposalEvent(e, { names: nameOf, versions: versionOf }), type: e.type }));

  const nameValues = (content.names ?? []).map(
    (n): NameValues => ({
      id: n.id,
      name: n.name,
      what: n.what ?? "",
      note: n.note ?? "",
      overrideBase: moneyInput(n.price_override?.base_cents),
      overridePerClass: moneyInput(n.price_override?.per_class_cents),
      marks: (n.marks ?? []).map((m) => ({ id: m.id, kind: m.kind, desc: m.desc, preselected: m.preselected })),
      classes: (n.classes ?? []).map((c) => ({ id: c.id, label: c.label, preselected: c.preselected })),
    }),
  );

  const common = { proposalId: proposal.id, updatedAt: proposal.updated_at, editable };

  return (
    <div className="pe-page">
      <Link href="/dashboard/proposals/" className="lx-back">
        ← Client proposals
      </Link>

      <div className="pe-head">
        <div className="pe-head-main">
          <div className="lx-label">Client proposal</div>
          <h1 className="lx-h1">{proposal.client_name}</h1>
          <div className="pe-meta">
            <span className={`lx-pill lx-pill-${statusTone(proposal.status)}`}>{statusLabel(proposal.status)}</span>
            <span className="lx-num">
              Version {proposal.version}
              {versions.length > 1 ? ` of ${versions.length}` : ""}
            </span>
            <span>{proposal.title}</span>
            {proposal.expires_on && <span>Open until {formatShortFirmDate(`${proposal.expires_on}T12:00:00Z`, "UTC")}</span>}
            {proposal.lead_id && <Link href={`/dashboard/leads/${proposal.lead_id}/`}>Lead</Link>}
            {proposal.matter_id && <Link href={`/dashboard/matters/${proposal.matter_id}/`}>Matter</Link>}
            {proposal.source === "agent" && <span className="lx-note">Drafted by the agent</span>}
          </div>
        </div>
      </div>

      <Lifecycle
        proposalId={proposal.id}
        status={proposal.status}
        version={proposal.version}
        canWrite={canWrite}
        isApprover={isApprover}
        blockingErrors={errors}
        approverNames={approverNames}
        clientUrl={clientUrl}
        queueNote={sendBlock.blocked ? { text: GOES_LIVE_ON_APPROVAL, queueId: sendBlock.queueId } : null}
      />

      {readOnlyNote && (
        <div className="pe-readonly" role="note">
          {readOnlyNote.text}
          {newer && (
            <>
              {" "}
              <Link href={`/dashboard/proposals/${newer.id}/`}>Open version {newer.version}</Link>.
            </>
          )}
        </div>
      )}

      {paidView && <PaidPanel proposalId={proposal.id} view={paidView} />}

      <ProposalCard card={card} />
      {consult && proposal.lead_id && <ConsultStrip state={consult} leadId={proposal.lead_id} tz={tz} />}

      {statusEditable && (errors > 0 || warnings > 0) && (
        <div className={`lx-banner ${errors > 0 ? "lx-banner-risk" : "lx-banner-mute"}`} role="status">
          {errors > 0
            ? `${errors} ${errors === 1 ? "problem blocks" : "problems block"} approval${warnings > 0 ? `, and ${warnings} to check` : ""}. Each is listed in the section that can fix it.`
            : `${warnings} ${warnings === 1 ? "thing" : "things"} to check before approving. None blocks approval.`}
        </div>
      )}
      {statusEditable && errors === 0 && warnings === 0 && (
        <div className="lx-banner lx-banner-ok" role="status">
          Nothing blocks approval.
        </div>
      )}

      <div className="pe-cols">
        <div className="pe-forms">
          <DetailsForm
            {...common}
            issues={shown(groups.details)}
            values={{
              fullName: proposal.client_name,
              firstName: content.client?.first_name ?? "",
              company: content.client?.company ?? "",
              clientEmail: proposal.client_email ?? "",
              title: proposal.title,
              expiresOn: proposal.expires_on ?? "",
              payUrl: proposal.pay_url ?? "",
            }}
          />
          <MessageForm
            {...common}
            issues={shown(groups.message)}
            values={{ greeting: content.greeting ?? "", recommendation: content.recommendation ?? "", officeActionNote: content.office_action_note ?? "" }}
          />
          <PricingForm
            {...common}
            issues={shown(groups.pricing)}
            values={{
              package: content.pricing?.package ?? "",
              base: moneyInput(content.pricing?.base_cents),
              includedClasses: String(content.pricing?.included_classes ?? ""),
              perClass: moneyInput(content.pricing?.per_class_cents),
              secondMarkPct: String(content.pricing?.second_mark_discount_pct ?? ""),
              govPerClass: moneyInput(content.pricing?.gov_per_class_cents),
            }}
          />

          <h2 className="lx-label" style={{ margin: "6px 0 -4px" }}>
            Brand names
          </h2>
          <IssueList issues={shown(groups.general)} />
          {nameValues.map((n, i) => (
            <NameCard
              key={n.id}
              {...common}
              issues={shown(groups.names.get(i) ?? [])}
              value={n}
              packageName={content.pricing?.package ?? ""}
            />
          ))}
          <AddNameForm proposalId={proposal.id} updatedAt={proposal.updated_at} editable={editable} />

          <AdjustmentsForm
            {...common}
            issues={shown(groups.adjustments)}
            value={(content.adjustments ?? []).map((a) => ({
              id: a.id,
              label: a.label,
              kind: a.kind,
              value: a.kind === "percent" ? String(a.value) : moneyInput(a.value),
            }))}
          />
          <IncludesForm {...common} issues={shown(groups.includes)} initial={content.includes ?? []} />
        </div>

        <aside className="pe-side" aria-label="Figures and preview">
          <section className="lx-card pe-totals" aria-label="What the client pays at the pre-ticked offer">
            <div className="lx-label">At the pre-ticked offer</div>
            <dl>
              {quote.names.map((n) => (
                <div key={n.id} className="pe-line">
                  <dt>{n.name}</dt>
                  <dd>{n.included ? formatCents(n.legal_cents) : "none ticked"}</dd>
                </div>
              ))}
              {quote.adjustments
                .filter((a) => a.discount_cents > 0)
                .map((a) => (
                  <div key={a.id} className="pe-line pe-line-mute">
                    <dt>{a.label || "Adjustment"}</dt>
                    <dd>−{formatCents(a.discount_cents)}</dd>
                  </div>
                ))}
              <div className="pe-line pe-line-total">
                <dt>Legal fee, due when accepted</dt>
                <dd>{formatCents(quote.legal_total_cents)}</dd>
              </div>
              <div className="pe-line pe-line-mute">
                <dt>
                  USPTO fees, due at filing
                  {quote.gov_class_count > 0 ? ` (${quote.gov_class_count} ${quote.gov_class_count === 1 ? "filing" : "filings"})` : ""}
                </dt>
                <dd>{formatCents(quote.gov_total_cents)}</dd>
              </div>
            </dl>
            <p className="lx-note" style={{ margin: 0 }}>
              Worked out from the saved prices. The client can untick marks and classes; their total follows.
            </p>
          </section>

          {proposal.status === "accepted" && proposal.accepted_snapshot?.quote && (
            <section className="lx-card pe-totals" aria-label="What the client accepted">
              <div className="lx-label">Accepted{proposal.accepted_at ? ` ${formatFirmStamp(proposal.accepted_at, tz)}` : ""}</div>
              <dl>
                <div className="pe-line pe-line-total">
                  <dt>Legal fee accepted</dt>
                  <dd>{formatCents(proposal.accepted_snapshot.quote.legal_total_cents)}</dd>
                </div>
                <div className="pe-line pe-line-mute">
                  <dt>USPTO fees, due at filing</dt>
                  <dd>{formatCents(proposal.accepted_snapshot.quote.gov_total_cents)}</dd>
                </div>
              </dl>
            </section>
          )}

          <section className="lx-card pe-preview" aria-label="Preview of the client page">
            <div className="pe-preview-head">
              <span className="lx-label">What the client sees</span>
              <span className="lx-note">Updates when you save a section</span>
            </div>
            <div className="pe-preview-body">
              <ProposalDocument
                content={content}
                title={proposal.title}
                clientName={proposal.client_name}
                expiresOn={proposal.expires_on}
                firm={{ name: session.org.name, slug: session.org.slug }}
                mode="preview"
              />
            </div>
          </section>
        </aside>
      </div>

      <section className="lx-card pe-card" aria-label="Versions">
        <header className="pe-card-head">
          <h2 className="pe-h">Versions</h2>
          <p className="lx-note pe-hint">Every change after a proposal is sent is a new version, so what the client saw is never rewritten.</p>
        </header>
        <ul className="pe-versions">
          {versions.map((v) => (
            <li key={v.id}>
              <span className="lx-num">v{v.version}</span>
              <span className={`lx-pill lx-pill-${statusTone(v.status)}`}>{statusLabel(v.status)}</span>
              {v.id === proposal.id ? <span className="lx-note">You are here</span> : <Link href={`/dashboard/proposals/${v.id}/`}>Open</Link>}
              <span className="lx-note">
                {v.source === "revision" ? "Revision · " : ""}
                {versionWhen(v, tz)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="lx-card pe-card" aria-label="Activity">
        <header className="pe-card-head">
          <h2 className="pe-h">Activity</h2>
          <p className="lx-note pe-hint">Every version of this offer, newest first. Times are in the firm&apos;s time zone.</p>
        </header>
        {log.length === 0 ? (
          <p className="lx-note" style={{ margin: 0 }}>
            No activity yet.
          </p>
        ) : (
          <ol className="pe-log">
            {log.map(({ line, type }) => (
              <li key={line.id} data-kind={type}>
                <div className="pe-log-line">
                  {line.version && versions.length > 1 && <span className="pe-log-v">v{line.version}</span>}
                  <strong>{line.who}</strong> {line.what} <span className="pe-log-when">· {formatFirmStamp(line.at, tz)}</span>
                </div>
                {line.details.length > 0 && (
                  <details>
                    <summary>Details</summary>
                    <ul>
                      {line.details.map((d, n) => (
                        <li key={n}>{d}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function versionWhen(v: ProposalDetail["versions"][number], tz: string): string {
  const stamp = (iso: string | null) => (iso ? formatFirmStamp(iso, tz) : "");
  if (v.status === "accepted") return `Accepted ${stamp(v.accepted_at)}`;
  if (v.status === "sent") return `Sent ${stamp(v.sent_at)}`;
  if (v.status === "superseded") return `Replaced ${stamp(v.superseded_at)}`;
  if (v.status === "withdrawn") return `Withdrawn ${stamp(v.withdrawn_at)}`;
  if (v.status === "approved") return `Approved ${stamp(v.approved_at)}`;
  return `Started ${stamp(v.created_at)}`;
}

/** Why the forms are read-only, in the firm's words. Null when they are live. */
function readOnlyText(
  p: ProposalRow,
  canWrite: boolean,
  approverNames: string[],
): { text: string } | null {
  switch (p.status) {
    case "sent":
      return {
        text: `Sent proposals can't be edited. Revise creates version ${p.version + 1}, which ${approverNames.length > 0 ? joinOr(approverNames) : "a named approver"} approves before the client sees it.`,
      };
    case "accepted":
      return { text: "The client accepted this version, so it is the record of what they agreed to and can't be changed. Anything new is a separate proposal." };
    case "superseded":
      return { text: `Version ${p.version} was replaced by a newer version and can't be edited.` };
    case "withdrawn":
      return { text: "This version was withdrawn and can't be edited. The client's link no longer opens it." };
    default:
      return canWrite ? null : { text: "Your role can view proposals but not change them." };
  }
}
