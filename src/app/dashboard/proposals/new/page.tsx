import Link from "next/link";
import type { Metadata } from "next";
import { aiConfigured } from "@/lib/ai/claude";
import { currentRole } from "@/lib/auth/current-role";
import { loadDraftBlock } from "@/lib/consult-proposal/draft-gate";
import { DRAFT_BLOCK_NOTE } from "@/lib/consult-proposal/draft-availability";
import { listMatters } from "@/lib/matters";
import { listMeetingConnections } from "@/lib/meetings/connection";
import { getFirmTimeZone } from "@/lib/org/profile";
import { listLeads } from "@/lib/pipeline";
import { connectionHeader } from "@/lib/proposals/consult-row";
import { loadConsultsStrip } from "@/lib/proposals/consults-load";
import { loadConsultForPrefill } from "@/lib/proposals/consult-prefill-load";
import { loadLeadOptions } from "@/lib/proposals/lead-options";
import {
  buildPicker,
  NEW_PROPOSAL_PATH,
  pickerKind,
  pickerWithType,
  proposalLeadRecord,
  proposalMatterRecord,
  proposalTypeOf,
  withProposalType,
  type ListRead,
  type NewProposalType,
} from "@/lib/proposals/new-picker";
import { consultPrefill, filledFromLine, USE_CONSULT_LABEL } from "@/lib/proposals/prefill";
import { readStartSubject } from "@/lib/proposals/start-subject";
import { consultDoorState, copilotHref, isStartScreen, type ConsultDoorState } from "@/lib/proposals/start-screen";
import { listProposals } from "@/lib/proposals/store";
import { PROPOSAL_STAFF_WRITE_ROLES } from "@/lib/proposals/types";
import { CAN_WRITE_LEAD } from "@/lib/pipeline/leads";
import { normalizeTerm } from "@/lib/skills/pick";
import type { RecordKind } from "@/lib/skills/catalog";
import { ConsultFillList, ConsultSkipNote, FilledFrom } from "@/components/proposal-editor/FilledFrom";
import { CreateDraftForm, StartBlankForm } from "@/components/proposal-editor/StartDraft";
import { StartDoors } from "@/components/proposal-editor/StartDoors";
import { WhoIsThisFor, type WhoChosen } from "@/components/proposal-editor/WhoIsThisFor";
import { pageTitle } from "@/lib/ui/page-title";
import { PROPOSALS_NAME, PROPOSAL_TYPE_GENERAL, PROPOSAL_TYPE_TRADEMARK } from "@/lib/ui/words";
import { requireProposalsModule } from "../gate";
import "../proposals.css";

export const metadata: Metadata = { title: pageTitle("New proposal") };

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A query value is a string, or the first of several. */
const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

type Search = {
  lead?: string | string[];
  matter?: string | string[];
  kind?: string | string[];
  q?: string | string[];
  blank?: string | string[];
  /** Which door: "scratch" is "Who is this for?". */
  door?: string | string[];
  /** Spec 9: "general" for a contract or other matter at a flat fee; anything else is the trademark proposal. */
  type?: string | string[];
};

/** A list read, in the states it can end in. A failed read is never an empty list. */
async function readRecords(kind: RecordKind): Promise<ListRead> {
  try {
    const records = kind === "lead" ? (await listLeads()).map(proposalLeadRecord) : (await listMatters()).map(proposalMatterRecord);
    return { status: "ok", records };
  } catch {
    return { status: "failed" };
  }
}

/**
 * The consult door's state: not connected (says what is needed), couldn't be read, or the rows. Never "no consults" for a failed
 * read, and never rows built on a failed read of the firm's proposals (a consult that already has a proposal would then read as
 * ready to draft): see `consultDoorState`.
 */
function readConsultDoor(now: number, tz: string): Promise<ConsultDoorState> {
  return consultDoorState({
    notConnected: async () => {
      const conns = await listMeetingConnections();
      return conns.ok && connectionHeader(conns.connections, now).status.kind === "none";
    },
    // `listProposals` throws when the read fails; it is NOT caught here, so the door says it couldn't load.
    proposals: async () => (await listProposals()).map((r) => ({ id: r.id, leadId: r.lead_id, createdAt: r.created_at, source: r.source })),
    strip: (proposals) => loadConsultsStrip({ now, tz, proposals }),
  });
}

function Back() {
  return (
    <Link href="/dashboard/proposals/" className="lx-back">
      ← {PROPOSALS_NAME}
    </Link>
  );
}

function Head({ sub }: { sub: string }) {
  return (
    <div>
      <div className="lx-label">Intake</div>
      <h1 className="lx-h1" data-tour="proposal-new-head">
        New proposal
      </h1>
      <p className="lx-sub">{sub}</p>
    </div>
  );
}

/** Spec 9: the "Type" choice. Two links; the trademark proposal is the default. */
function ProposalTypeSwitch({ type, hrefs }: { type: NewProposalType; hrefs: Record<NewProposalType, string> }) {
  return (
    <nav className="lx-segs pe-type" aria-label="Type">
      <a href={hrefs.trademark} aria-current={type === "trademark" ? "page" : undefined}>
        {PROPOSAL_TYPE_TRADEMARK}
      </a>
      <a href={hrefs.general} aria-current={type === "general" ? "page" : undefined}>
        {PROPOSAL_TYPE_GENERAL}
      </a>
    </nav>
  );
}

/**
 * New proposal. With no `lead`, `matter`, `blank` or `door` parameter it is the START SCREEN: three doors (From a
 * consult, Ask Copilot, Start from scratch), each drawn only when its feature is on. "Start from scratch" opens
 * "Who is this for?": choosing a lead or matter, or "Start blank" with a name, CREATES the draft in that one step
 * and the editor opens; brands, packages and the pay link are chosen there. A link from a lead or matter page
 * (`?lead=` / `?matter=`) shows who it is for and one "Create draft" button (a page load never writes).
 *
 * The page re-reads a chosen record itself through the caller's own scoped client, so another firm's id is simply
 * "not found". Reads are three-state: a failed one says so and is never drawn as empty.
 */
export default async function NewProposalPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireProposalsModule();
  const params = await searchParams;

  const role = await currentRole();
  const canWrite = !!role && PROPOSAL_STAFF_WRITE_ROLES.includes(role);
  if (!canWrite) {
    return (
      <>
        <Back />
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            Your role can&apos;t start proposals
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            You can open and read proposals, but starting or changing one is for the firm&apos;s staff roles.
          </p>
        </div>
      </>
    );
  }

  const aiOn = aiConfigured();
  const type: NewProposalType = proposalTypeOf(params.type);
  const leadRaw = first(params.lead);
  const matterRaw = first(params.matter);

  // The start screen.
  if (isStartScreen({ lead: params.lead, matter: params.matter, blank: params.blank, door: params.door, kind: params.kind, q: params.q, type: params.type })) {
    const now = new Date().getTime();
    const canDraft = CAN_WRITE_LEAD.includes(role);
    const tz = await getFirmTimeZone();
    const [consults, draftBlock, leadsRead] = await Promise.all([
      readConsultDoor(now, tz),
      canDraft ? loadDraftBlock() : Promise.resolve(null),
      canDraft ? loadLeadOptions() : Promise.resolve(null),
    ]);
    return (
      <div className="pe-page">
        <Back />
        <Head sub="Starts as a draft. You can change anything in the editor before a named approver creates the client link." />
        <StartDoors
          canWrite={canWrite}
          aiOn={aiOn}
          consults={consults}
          canDraft={canDraft}
          draftNote={draftBlock ? DRAFT_BLOCK_NOTE[draftBlock] : null}
          leads={canDraft ? (leadsRead?.status === "ok" ? leadsRead.leads : null) : undefined}
        />
      </div>
    );
  }

  // A lead or matter chosen from its own page: who it is for, one button.
  if (matterRaw || leadRaw) {
    const id = matterRaw || leadRaw;
    const read = UUID.test(id) ? await readStartSubject({ leadId: matterRaw ? null : leadRaw, matterId: matterRaw || null }) : ({ status: "not-found" } as const);
    const typeHrefs = {
      trademark: `${NEW_PROPOSAL_PATH}?${matterRaw ? "matter" : "lead"}=${encodeURIComponent(id)}`,
      general: withProposalType(`${NEW_PROPOSAL_PATH}?${matterRaw ? "matter" : "lead"}=${encodeURIComponent(id)}`, "general"),
    };
    if (read.status !== "ok") {
      return (
        <div className="pe-page">
          <Back />
          <Head sub="Starts as a draft. You can change anything in the editor before a named approver creates the client link." />
          <p role="status" className="lx-banner lx-banner-mute" style={{ margin: 0 }}>
            {read.status === "unavailable" ? "That record couldn't be loaded just now. Refresh to try again." : "That lead or matter couldn't be found."}{" "}
            <Link href={`${NEW_PROPOSAL_PATH}?door=scratch`}>Choose who it is for</Link>
          </p>
        </div>
      );
    }
    const s = read.subject;
    // Only a REVIEWED newest consult fills anything; the action re-reads it before it uses it.
    const consultRead = type === "trademark" && s.leadId ? consultPrefill(await loadConsultForPrefill(s.leadId)) : null;
    const filled = consultRead?.state === "filled" ? consultRead : null;
    const tz = await getFirmTimeZone();
    const line = filledFromLine({
      matter: s.matter ? s.label : null,
      lead: s.lead && !s.matter ? s.label : null,
      consult: filled ? { reviewedBy: filled.reviewedBy, reviewedAt: filled.reviewedAt } : null,
      packageName: null,
      droppedClasses: filled?.dropped ?? 0,
      tz,
    });
    const who: WhoChosen = { kind: "chosen", label: s.label, changeHref: withProposalType(`${NEW_PROPOSAL_PATH}?door=scratch`, type) };
    return (
      <div className="pe-page">
        <Back />
        <Head sub="Starts as a draft. You can change anything in the editor before a named approver creates the client link." />
        <ProposalTypeSwitch type={type} hrefs={typeHrefs} />
        <WhoIsThisFor view={null} chosen={who} />
        <FilledFrom line={line} />
        {consultRead && consultRead.state !== "filled" && s.leadId && <ConsultSkipNote skip={consultRead.state} leadId={s.leadId} />}
        <CreateDraftForm
          key={`${s.matterId}|${s.leadId}|${type}`}
          leadId={s.leadId ?? ""}
          matterId={s.matterId ?? ""}
          type={type}
          consult={
            filled ? (
              <div className="pe-consult-use">
                <label className="pe-check" style={{ whiteSpace: "normal" }}>
                  <input type="checkbox" name="useConsult" defaultChecked /> {USE_CONSULT_LABEL}
                </label>
                <ConsultFillList brands={filled.brands} />
              </div>
            ) : undefined
          }
        />
        {aiOn && (
          <p className="lx-note" style={{ margin: 0 }}>
            <a href={copilotHref(s.fullName || null)}>Ask Copilot to draft this one instead</a>
          </p>
        )}
      </div>
    );
  }

  // "Who is this for?" (door=scratch) or "Start blank".
  const typeHrefs = {
    trademark: `${NEW_PROPOSAL_PATH}?door=scratch${first(params.blank) === "1" ? "&blank=1" : ""}`,
    general: `${NEW_PROPOSAL_PATH}?door=scratch&type=general${first(params.blank) === "1" ? "&blank=1" : ""}`,
  };
  const blank = first(params.blank) === "1";
  let who: WhoChosen | null = null;
  let view: ReturnType<typeof buildPicker> | null = null;
  if (blank) who = { kind: "blank", chooseHref: withProposalType(`${NEW_PROPOSAL_PATH}?door=scratch`, type) };
  else {
    const [leads, matters] = await Promise.all([readRecords("lead"), readRecords("matter")]);
    view = pickerWithType(buildPicker({ kind: pickerKind(params.kind), term: normalizeTerm(params.q), leads, matters }), type);
  }
  return (
    <div className="pe-page">
      <Back />
      <Head sub="Starts as a draft. You can change anything in the editor before a named approver creates the client link." />
      <ProposalTypeSwitch type={type} hrefs={typeHrefs} />
      <WhoIsThisFor view={view} chosen={who} hidden={{ door: "scratch", ...(type === "general" ? { type: "general" } : {}) }} create={{ type }} />
      {blank && <StartBlankForm type={type} />}
    </div>
  );
}
