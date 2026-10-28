import Link from "next/link";
import { currentRole } from "@/lib/auth/current-role";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getFirmTimeZone } from "@/lib/org/profile";
import { firmCivilDate } from "@/lib/quotes/firm-time";
import { getProposalSettings } from "@/lib/proposals/store";
import { PROPOSAL_STAFF_WRITE_ROLES } from "@/lib/proposals/types";
import { normalisePackages, packageOption, type PackageOption } from "@/lib/proposals/package-list";
import type { ProposalPricing, ProposalSettingRow } from "@/lib/proposals/types";
import { loadConsultStrip } from "@/lib/proposals/consult-strip-load";
import { loadConsultForPrefill } from "@/lib/proposals/consult-prefill-load";
import { leadOptionLabel } from "@/lib/proposals/lead-label";
import { buildPicker, NEW_PROPOSAL_PATH, pickerHref, pickerKind, proposalLeadRecord, proposalMatterRecord, type ListRead } from "@/lib/proposals/new-picker";
import {
  clientFromLead,
  consultPrefill,
  filledFromLine,
  leadBrand,
  matterBrand,
  matterTitle,
  packageFromConsult,
  packageNote,
  type LeadFill,
  type MatterFill,
} from "@/lib/proposals/prefill";
import { listLeads } from "@/lib/pipeline";
import { listMatters } from "@/lib/matters";
import { normalizeTerm } from "@/lib/skills/pick";
import type { RecordKind } from "@/lib/skills/catalog";
import { ConsultStrip } from "@/components/proposal-editor/ConsultStrip";
import { ConsultFillList, ConsultSkipNote, FilledFrom } from "@/components/proposal-editor/FilledFrom";
import { NewProposalForm, type NewProposalDefaults } from "@/components/proposal-editor/NewProposalForm";
import { WhoIsThisFor, type WhoChosen } from "@/components/proposal-editor/WhoIsThisFor";
import { requireProposalsModule } from "../gate";
import "../proposals.css";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { PROPOSALS_NAME } from "@/lib/ui/words";

export const metadata: Metadata = { title: pageTitle("New proposal") };

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_OPEN_DAYS = 14;

/** A new proposal is open for two weeks unless the person picks another date (the firm's calendar day, not the server's). */
function defaultExpiry(tz: string): string {
  return firmCivilDate(new Date(Date.now() + DEFAULT_OPEN_DAYS * 86_400_000), tz);
}

/** A query value is a string, or the first of several. */
const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

type Search = { lead?: string | string[]; matter?: string | string[]; kind?: string | string[]; q?: string | string[]; blank?: string | string[] };

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
 * New proposal. At the top, "Who is this for?": a Leads | Matters picker (recent
 * first, searchable, "Start blank"). Choosing a record is a link to `?lead=<id>`
 * or `?matter=<id>`, and the page re-reads that record itself through the
 * caller's own scoped client, so the browser is never trusted and a lead or
 * matter from another firm is simply not found. The matter wins when both are
 * given. Once a record is chosen the picker collapses to "For: <label> . Change".
 *
 * What it fills: the client (name, first name, company, email) and the first
 * brand name from the lead's or matter's own fields, and, ONLY when a person has
 * reviewed the newest consult details, each mark with its classes and a package
 * that is on the firm's current list. Anything else about the consult fills
 * nothing and says why in one line. No price is read from any record: the price
 * fields are the chosen package's, which the browser fills in and the create
 * action re-reads by name from settings. A failed settings read shows a note and
 * no dropdown. A linked lead's latest consult is shown above the form.
 */
export default async function NewProposalPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireProposalsModule();
  const params = await searchParams;
  const leadRaw = first(params.lead);
  const matterRaw = first(params.matter);

  const role = await currentRole();
  if (!role || !PROPOSAL_STAFF_WRITE_ROLES.includes(role)) {
    return (
      <>
        <Link href="/dashboard/proposals/" className="lx-back">
          ← {PROPOSALS_NAME}
        </Link>
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

  // Three states: settings read (a row or none yet) or couldn't be read. A failed read offers no package and says so.
  let settings: ProposalSettingRow | null = null;
  let packages: PackageOption[] | null;
  let packageList: ProposalPricing[] | null;
  const [tz, settingsRead] = await Promise.all([
    getFirmTimeZone(),
    getProposalSettings().then(
      (row) => ({ ok: true as const, row }),
      () => ({ ok: false as const }),
    ),
  ]);
  if (settingsRead.ok) {
    settings = settingsRead.row;
    packageList = normalisePackages(settings?.pricing ?? {});
    packages = packageList.map(packageOption);
  } else {
    packageList = null;
    packages = null;
  }

  const defaults: NewProposalDefaults = {
    leadId: "",
    matterId: "",
    fullName: "",
    firstName: "",
    company: "",
    clientEmail: "",
    brandName: "",
    title: "Trademark Proposal",
    expiresOn: defaultExpiry(tz),
    payUrl: "",
  };

  let leadNote: string | null = null;
  let matterRow: MatterFill | null = null;
  let leadRow: LeadFill | null = null;
  if (matterRaw) {
    if (!UUID.test(matterRaw)) leadNote = "That matter link isn't valid, so the form is blank.";
    else {
      const supabase = await getScopedClient();
      const { data: matter, error } = await supabase
        .from("crm_matter")
        .select("id, lead_id, owner_name, mark_text, title, matter_number")
        .eq("id", matterRaw)
        .maybeSingle();
      if (error) leadNote = "That matter couldn't be loaded just now, so the form is blank.";
      else if (!matter) leadNote = "That matter couldn't be found, so the form is blank.";
      else {
        matterRow = matter;
        defaults.matterId = matter.id;
        defaults.fullName = matter.owner_name?.trim() ?? "";
        if (matter.lead_id) {
          const result = await readLead(matter.lead_id);
          if (result.lead) leadRow = result.lead;
          else leadNote = result.note;
        }
        defaults.brandName = matterBrand(matter, leadRow);
      }
    }
  } else if (leadRaw) {
    if (!UUID.test(leadRaw)) leadNote = "That lead link isn't valid, so the form is blank.";
    else {
      const result = await readLead(leadRaw);
      if (result.lead) {
        leadRow = result.lead;
        defaults.brandName = leadBrand(leadRow);
      } else leadNote = result.note;
    }
  }
  if (leadRow) applyLead(defaults, leadRow);

  // What the picker shows: the chosen record (collapsed), or the lists.
  const term = normalizeTerm(params.q);
  const kind: RecordKind = matterRaw ? "matter" : leadRaw ? "lead" : pickerKind(params.kind);
  const chosenLabel = matterRow ? matterTitle(matterRow) : leadRow && !matterRaw ? leadOptionLabel(leadRow) : null;
  const blank = first(params.blank) === "1" && !matterRaw && !leadRaw;
  let who: WhoChosen | null = null;
  let view: ReturnType<typeof buildPicker> | null = null;
  if (chosenLabel) who = { kind: "chosen", label: chosenLabel, changeHref: pickerHref(matterRow ? "matter" : "lead", term) };
  else if (blank) who = { kind: "blank", chooseHref: NEW_PROPOSAL_PATH };
  else {
    const [leads, matters] = await Promise.all([readRecords("lead"), readRecords("matter")]);
    view = buildPicker({ kind, term, leads, matters });
  }

  // The consult: for the lead, or the matter's lead. Only a REVIEWED newest record fills anything.
  const [strip, consultRead] = defaults.leadId
    ? await Promise.all([loadConsultStrip(defaults.leadId), loadConsultForPrefill(defaults.leadId)])
    : [null, null];
  const consult = matterRow && !matterRow.lead_id ? consultPrefill(null) : consultRead ? consultPrefill(consultRead) : null;
  const filled = consult?.state === "filled" ? consult : null;
  const packageFill = filled ? packageFromConsult(filled.recommendedPackage, packageList) : null;

  const line = filledFromLine({
    matter: matterRow ? matterTitle(matterRow) : null,
    lead: leadRow ? leadOptionLabel(leadRow) : null,
    consult: filled ? { reviewedBy: filled.reviewedBy, reviewedAt: filled.reviewedAt } : null,
    packageName: packageFill?.kind === "match" ? packageFill.name : null,
    droppedClasses: filled?.dropped ?? 0,
    tz,
  });

  return (
    <div className="pe-page">
      <Link href="/dashboard/proposals/" className="lx-back">
        ← {PROPOSALS_NAME}
      </Link>
      <div>
        <div className="lx-label">Intake</div>
        <h1 className="lx-h1" data-tour="proposal-new-head">New proposal</h1>
        <p className="lx-sub">
          Starts as a draft from one of your firm&apos;s packages and its included items. You can change anything on the next page before a named approver
          creates the client link.
        </p>
      </div>
      <WhoIsThisFor view={view} chosen={who} />
      <FilledFrom line={line} />
      {defaults.leadId && (
        <p className="lx-note" style={{ margin: 0 }}>
          Linked to the lead you came from.{" "}
          <Link href={`/dashboard/leads/${defaults.leadId}/`}>Open the lead</Link>
        </p>
      )}
      {defaults.matterId && (
        <p className="lx-note" style={{ margin: 0 }}>
          Linked to the matter you came from.{" "}
          <Link href={`/dashboard/matters/${defaults.matterId}/`}>Open the matter</Link>
        </p>
      )}
      {strip && defaults.leadId && <ConsultStrip state={strip} leadId={defaults.leadId} tz={tz} />}
      {consult && consult.state !== "filled" && <ConsultSkipNote skip={consult.state} leadId={defaults.leadId} />}
      {leadNote && (
        <p role="status" className="lx-banner lx-banner-mute" style={{ margin: 0 }}>
          {leadNote}
        </p>
      )}
      {packageFill?.kind === "unlisted" && (
        <p role="status" className="lx-banner lx-banner-mute" style={{ margin: 0 }}>
          {packageNote(packageFill.asked)}
        </p>
      )}
      <NewProposalForm
        key={`${defaults.matterId}|${defaults.leadId}`}
        defaults={defaults}
        today={firmCivilDate(new Date(), tz)}
        hasSettings={settings !== null || !settingsRead.ok}
        packages={packages}
        defaultPackage={packageFill?.kind === "match" ? packageFill.name : undefined}
        consult={filled ? <ConsultFillList brands={filled.brands} /> : undefined}
      />
    </div>
  );
}

/** A lead through the caller's scoped client: found, not found, or not readable (never confused). */
async function readLead(id: string): Promise<{ lead: LeadFill; note?: undefined } | { lead: null; note: string }> {
  const supabase = await getScopedClient();
  const { data: lead, error } = await supabase
    .from("crm_lead")
    .select("id, first_name, last_name, business_name, email, mark_text")
    .eq("id", id)
    .maybeSingle();
  if (error) return { lead: null, note: "That lead couldn't be loaded just now, so the client details are blank." };
  if (!lead) return { lead: null, note: "That lead couldn't be found, so the form is blank." };
  return { lead };
}

function applyLead(defaults: NewProposalDefaults, lead: LeadFill): void {
  const client = clientFromLead(lead);
  defaults.leadId = lead.id;
  defaults.fullName = client.fullName || defaults.fullName;
  defaults.firstName = client.firstName;
  defaults.company = client.company;
  defaults.clientEmail = client.clientEmail;
}
