import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { getFirmTimeZone } from "@/lib/org/profile";
import { listMemberDirectory, type MemberIdentity } from "@/lib/members/directory";
import { clientLinkOrigin, clientLinkUrl } from "@/lib/proposals/client-link-origin";
import { formatCents } from "@/lib/quotes/money";
import { formatFirmStamp, formatShortFirmDate } from "@/lib/quotes/labels";
import { ProposalError } from "@/lib/proposals/errors";
import { getProposal, getProposalSettings, isCurrentUserApprover, listProposalStepEvents, type ProposalDetail } from "@/lib/proposals/store";
import { PROPOSAL_PAID_ROLES } from "@/lib/proposals/paid";
import { buildPaidPanelView } from "@/lib/proposals/paid-view";
import { PROPOSAL_STAFF_WRITE_ROLES, isProposalEditable, type ProposalRow } from "@/lib/proposals/types";
import { validateContent } from "@/lib/proposals/validate";
import { describeProposalEvent, formatDollars } from "@/lib/proposal-editor/events";
import { FIRST_PROBLEM_ID, describeIssuePath, firstProblem, groupIssues } from "@/lib/proposal-editor/issues";
import { firstNameOf, joinOr, statusLabel, statusTone } from "@/lib/proposal-editor/labels";
import { moneyInput } from "@/lib/proposal-editor/form";
import { editorChangedCount, shouldOpenMore } from "@/lib/proposal-editor/more-options";
import { addedClassesPhrase, clientAddedClasses } from "@/lib/proposals/added-view";
import { findPackage, normalisePackages } from "@/lib/proposals/package-list";
import { loadLeadLink } from "@/lib/proposals/lead-link";
import { loadLeadOptions } from "@/lib/proposals/lead-options";
import { defaultSelection, priceForClassCount, quoteProposal } from "@/lib/proposals/pricing";
import { buildProposalCard } from "@/lib/proposals/card";
import { loadConsultStrip } from "@/lib/proposals/consult-strip-load";
import { ProposalDocument } from "@/components/client-proposal/ProposalDocument";
import { BuilderLayout } from "@/components/proposal-editor/BuilderLayout";
import { ConsultStrip } from "@/components/proposal-editor/ConsultStrip";
import { LeadLink } from "@/components/proposal-editor/LeadLink";
import { LinkLeadForm } from "@/components/proposal-editor/LinkLeadForm";
import { ProposalCard } from "@/components/proposal-editor/ProposalCard";
import { IssueList, type ShownIssue } from "@/components/proposal-editor/ActionForm";
import { Lifecycle } from "@/components/proposal-editor/Lifecycle";
import { PaidPanel } from "@/components/proposal-editor/PaidPanel";
import { ChangePayLink } from "@/components/proposal-editor/ChangePayLink";
import {
  AddNameForm,
  AdjustmentsForm,
  DetailsForm,
  DetailsMoreFields,
  IncludesForm,
  MessageForm,
  NameCard,
  NameMoreFields,
  NameRowsProvider,
  PricingForm,
  PricingMoreFields,
  type NameValues,
} from "@/components/proposal-editor/Sections";
import { GOES_LIVE_ON_APPROVAL, proposalSendBlock } from "@/lib/consult-proposal/link";
import { requireProposalsModule } from "../gate";
import "../proposals.css";
import type { Metadata } from "next";
import { recordPageTitle } from "@/lib/ui/page-title";
import { PROPOSALS_NAME } from "@/lib/ui/words";

/** Tab title: the client's name through the scoped getter; "Proposal" when the read fails or finds nothing. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: await recordPageTitle(async () => (await getProposal(id))?.proposal.client_name?.trim() || null, "Proposal") };
}

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
          ← {PROPOSALS_NAME}
        </Link>
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            This proposal couldn&apos;t be loaded
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            {err instanceof ProposalError && err.code === "unavailable"
              ? "Can't show this right now. Refresh to try again."
              : "Try again shortly."}
          </p>
        </div>
      </>
    );
  }
  if (!detail) notFound();
  const { proposal, versions, events } = detail;
  const content = proposal.content;

  const [tz, members, settings, isApprover, origin, consult, stepRead, leadLink, leadOptions] = await Promise.all([
    getFirmTimeZone(),
    listMemberDirectory().catch((): MemberIdentity[] => []),
    getProposalSettings().catch(() => null),
    isCurrentUserApprover(),
    clientLinkOrigin(proposal.org_id),
    proposal.lead_id ? loadConsultStrip(proposal.lead_id) : Promise.resolve(null),
    // Only an accepted version has a payment panel. A failed read is `{ ok: false }`, never "not paid".
    proposal.status === "accepted" ? listProposalStepEvents(proposal.id) : Promise.resolve(null),
    loadLeadLink(proposal.lead_id),
    // Only an unlinked, still-editable proposal on a writer's page needs the list to link one from.
    !proposal.lead_id && isProposalEditable(proposal.status) && canWrite ? loadLeadOptions() : Promise.resolve(null),
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
  const groups = groupIssues(issues);
  const first = firstProblem(groups);
  const shown = (list: typeof issues): ShownIssue[] =>
    list.map((i) => ({ level: i.level, message: i.message, where: describeIssuePath(i.path, content), ...(i === first ? { anchor: true } : {}) }));

  /* ── the figures the client starts from ── */
  const quote = quoteProposal(content, defaultSelection(content));
  const latest = versions[0];
  const newer = latest && latest.version > proposal.version ? latest : null;

  // A consult-agent proposal goes live by approving its email in the queue, so
  // "Turn on the link" is replaced by a note while that email is pending (or unreadable).
  const sendBlock =
    canWrite && proposal.status === "approved" && proposal.source === "agent" ? await proposalSendBlock(proposal.id) : ({ blocked: false } as const);

  // Only a live link is shown: an approved (saved) version's URL would open nothing.
  const clientUrl = proposal.status === "sent" || proposal.status === "accepted" ? clientLinkUrl(origin, proposal.public_token) : null;

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
  // What the client added on the page (accepted versions only), for staff.
  const clientAdded = clientAddedClasses(proposal.accepted_snapshot);
  const addedPhrase = addedClassesPhrase(clientAdded);

  const log = events.map((e) => {
    const line = describeProposalEvent(e, { names: nameOf, versions: versionOf });
    // The accepted line of THIS version also says what the client added.
    if (e.type === "accepted" && e.proposal_id === proposal.id && clientAdded.length > 0) {
      return {
        line: { ...line, what: `${line.what}, ${addedPhrase}`, details: [...line.details, ...clientAdded.map((a) => `Added for ${a.brand}: ${a.description}`)] },
        type: e.type,
      };
    }
    return { line, type: e.type };
  });

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

  // More options: how many of its fields differ from the firm's defaults, and whether a problem is inside it.
  const pricing = content.pricing;
  const firmPackage = (settings && pricing ? findPackage(normalisePackages(settings.pricing ?? {}), pricing.package) : null) ?? null;
  const changedCount = pricing
    ? editorChangedCount({
        pricing,
        firmPackage,
        adjustments: (content.adjustments ?? []).length,
        brandPriceOverrides: (content.names ?? []).filter((n) => n.price_override && Object.keys(n.price_override).length > 0).length,
      })
    : 0;
  const moreOpen = shouldOpenMore(issues.map((i) => i.path));
  const customLabel = `Custom package: ${formatDollars(pricing?.per_class_cents ?? 0)} less per class under the package's included classes`;
  const customHelp = pricing
    ? `Off (the default): ${pricing.package} is a flat ${formatDollars(priceForClassCount({ ...pricing, reduce_under_included: false }, 1))} for one class. On: one class is ${formatDollars(priceForClassCount({ ...pricing, reduce_under_included: true }, 1))}. Turn it on only when the firm has agreed a reduced package.`
    : "";
  const pricingValues = {
    package: content.pricing?.package ?? "",
    base: moneyInput(content.pricing?.base_cents),
    includedClasses: String(content.pricing?.included_classes ?? ""),
    perClass: moneyInput(content.pricing?.per_class_cents),
    secondMarkPct: String(content.pricing?.second_mark_discount_pct ?? ""),
    govPerClass: moneyInput(content.pricing?.gov_per_class_cents),
  };
  const detailsValues = {
    fullName: proposal.client_name,
    firstName: content.client?.first_name ?? "",
    company: content.client?.company ?? "",
    clientEmail: proposal.client_email ?? "",
    title: proposal.title,
    expiresOn: proposal.expires_on ?? "",
  };

  return (
    <div className="pe-page">
      <Link href="/dashboard/proposals/" className="lx-back">
        ← {PROPOSALS_NAME}
      </Link>

      <div className="pe-head">
        <div className="pe-head-main">
          <div className="lx-label">{PROPOSALS_NAME}</div>
          <h1 className="lx-h1">{proposal.client_name}</h1>
          <div className="pe-meta">
            <span className={`lx-pill lx-pill-${statusTone(proposal.status)}`}>{statusLabel(proposal.status)}</span>
            <span className="lx-num">
              Version {proposal.version}
              {versions.length > 1 ? ` of ${versions.length}` : ""}
            </span>
            <span>{proposal.title}</span>
            {proposal.expires_on && <span>Open until {formatShortFirmDate(`${proposal.expires_on}T12:00:00Z`, "UTC")}</span>}
            {proposal.source === "agent" && <span className="lx-note">Drafted by an assistant</span>}
          </div>
          <LeadLink
            lead={leadLink}
            matterId={proposal.matter_id}
            linker={
              leadOptions ? (
                <LinkLeadForm proposalId={proposal.id} updatedAt={proposal.updated_at} leads={leadOptions.status === "ok" ? leadOptions.leads : null} />
              ) : null
            }
          />
        </div>
      </div>

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

      {/* lectual 0100: on a live link only the pay link may change. Never for accepted, replaced or withdrawn. */}
      {canWrite && proposal.status === "sent" && (
        <ChangePayLink proposalId={proposal.id} updatedAt={proposal.updated_at} payUrl={proposal.pay_url ?? ""} />
      )}

      {paidView && <PaidPanel proposalId={proposal.id} view={paidView} />}

      <ProposalCard card={card} showFees={false} />
      {consult && proposal.lead_id && <ConsultStrip state={consult} leadId={proposal.lead_id} tz={tz} />}

      {statusEditable && (errors > 0 || warnings > 0) && (
        <div className={`lx-banner ${errors > 0 ? "lx-banner-risk" : "lx-banner-mute"}`} role="status">
          {errors > 0
            ? `${errors} ${errors === 1 ? "problem blocks" : "problems block"} creating the link${warnings > 0 ? `, and ${warnings} to check` : ""}. Each is listed in the section that can fix it.`
            : `${warnings} ${warnings === 1 ? "thing" : "things"} to check before creating the link. None blocks it.`}{" "}
          <a href={`#${FIRST_PROBLEM_ID}`}>Go to first problem</a>
        </div>
      )}
      {statusEditable && errors === 0 && warnings === 0 && (
        <div className="lx-banner lx-banner-ok" role="status">
          Nothing blocks creating the link.
        </div>
      )}

      <div className="pe-cols">
        <div className="pe-forms">
          <NameRowsProvider key={nameValues.map((n) => n.id).join("|")} names={nameValues}>
            <BuilderLayout
              changed={changedCount}
              moreOpen={moreOpen}
              who={<DetailsForm {...common} issues={shown(groups.details)} values={detailsValues} />}
              names={
                <>
                  <IssueList issues={shown(groups.general)} />
                  {nameValues.map((n, i) => (
                    <NameCard key={n.id} {...common} issues={shown(groups.names.get(i) ?? [])} value={n} packageName={content.pricing?.package ?? ""} />
                  ))}
                  <AddNameForm proposalId={proposal.id} updatedAt={proposal.updated_at} editable={editable} />
                </>
              }
              packageStep={<PricingForm {...common} issues={shown(groups.pricing)} values={pricingValues} payUrl={proposal.pay_url ?? ""} />}
              create={
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
              }
              more={
                <>
                  <DetailsMoreFields proposalId={proposal.id} editable={editable} values={detailsValues} />
                  <PricingMoreFields
                    proposalId={proposal.id}
                    editable={editable}
                    values={pricingValues}
                    reduceUnderIncluded={content.pricing?.reduce_under_included === true}
                    customLabel={customLabel}
                    customHelp={customHelp}
                  />
                  {nameValues.map((n) => (
                    <NameMoreFields key={n.id} proposalId={proposal.id} editable={editable} value={n} packageName={content.pricing?.package ?? ""} />
                  ))}
                  <MessageForm
                    {...common}
                    issues={shown(groups.message)}
                    values={{ greeting: content.greeting ?? "", recommendation: content.recommendation ?? "", officeActionNote: content.office_action_note ?? "" }}
                  />
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
                </>
              }
            />
          </NameRowsProvider>
        </div>

        <aside className="pe-side" aria-label="Figures and preview">
          <section className="lx-card pe-totals" aria-label="What the client pays">
            <div className="lx-label">What the client pays</div>
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
              {clientAdded.length > 0 && (
                <div className="pe-client-added">
                  <div className="lx-label">Classes the client added ({clientAdded.length})</div>
                  <ul>
                    {clientAdded.map((a, n) => (
                      <li key={n}>
                        <strong>{a.brand}</strong>: {a.description}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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

      <section className="lx-card pe-card" aria-label="History">
        <header className="pe-card-head">
          <h2 className="pe-h">History</h2>
          <p className="lx-note pe-hint">
            Every change after the link is live is a new version, so what the client saw is never rewritten. Times are in the firm&apos;s time zone.
          </p>
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
  if (v.status === "sent") return `Link live ${stamp(v.sent_at)}`;
  if (v.status === "superseded") return `Replaced ${stamp(v.superseded_at)}`;
  if (v.status === "withdrawn") return `Withdrawn ${stamp(v.withdrawn_at)}`;
  if (v.status === "approved") return `Saved ${stamp(v.approved_at)}`;
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
        text: `A proposal with a live link can't be edited${canWrite ? ", except its pay link (below)" : ""}. Start a new version creates version ${p.version + 1}; ${approverNames.length > 0 ? joinOr(approverNames) : "a named approver"} creates its link before the client sees it.`,
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
