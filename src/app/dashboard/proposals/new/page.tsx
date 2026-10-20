import Link from "next/link";
import { currentRole } from "@/lib/auth/current-role";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getFirmTimeZone } from "@/lib/org/profile";
import { firmCivilDate } from "@/lib/quotes/firm-time";
import { getProposalSettings } from "@/lib/proposals/store";
import { PROPOSAL_STAFF_WRITE_ROLES } from "@/lib/proposals/types";
import { loadPackageChoices } from "@/lib/proposals/packages";
import { loadConsultStrip } from "@/lib/proposals/consult-strip-load";
import { ConsultStrip } from "@/components/proposal-editor/ConsultStrip";
import { NewProposalForm, type NewProposalDefaults } from "@/components/proposal-editor/NewProposalForm";
import { requireProposalsModule } from "../gate";
import "../proposals.css";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_OPEN_DAYS = 14;

/** A new proposal is open for two weeks unless the person picks another date (the firm's calendar day, not the server's). */
function defaultExpiry(tz: string): string {
  return firmCivilDate(new Date(Date.now() + DEFAULT_OPEN_DAYS * 86_400_000), tz);
}

/**
 * New proposal. `?lead=<id>` pre-fills the client from the lead, and
 * `?matter=<id>` from the matter's lead and links the matter (the matter wins
 * when both are given). Both are read through the caller's own scoped client,
 * so a lead or matter from another firm is simply not found. The prices and
 * included items are NOT read here: the create action reads the firm's settings
 * itself (and re-reads a chosen service-library package), so the form cannot
 * carry prices. A linked lead's latest consult is shown above the form.
 */
export default async function NewProposalPage({ searchParams }: { searchParams: Promise<{ lead?: string; matter?: string }> }) {
  await requireProposalsModule();
  const { lead: leadRaw, matter: matterRaw } = await searchParams;

  const role = await currentRole();
  if (!role || !PROPOSAL_STAFF_WRITE_ROLES.includes(role)) {
    return (
      <>
        <Link href="/dashboard/proposals/" className="lx-back">
          ← Client proposals
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

  const [tz, settings, packages] = await Promise.all([getFirmTimeZone(), getProposalSettings().catch(() => null), loadPackageChoices()]);

  const defaults: NewProposalDefaults = {
    leadId: "",
    matterId: "",
    fullName: "",
    firstName: "",
    company: "",
    clientEmail: "",
    title: "Trademark Proposal",
    expiresOn: defaultExpiry(tz),
    payUrl: settings?.default_pay_url ?? "",
  };

  let leadNote: string | null = null;
  if (matterRaw) {
    if (!UUID.test(matterRaw)) leadNote = "That matter link isn't valid, so the form is blank.";
    else {
      const supabase = await getScopedClient();
      const { data: matter, error } = await supabase.from("crm_matter").select("id, lead_id, owner_name").eq("id", matterRaw).maybeSingle();
      if (error) leadNote = "That matter couldn't be loaded just now, so the form is blank.";
      else if (!matter) leadNote = "That matter couldn't be found, so the form is blank.";
      else {
        defaults.matterId = matter.id;
        defaults.fullName = matter.owner_name?.trim() ?? "";
        if (matter.lead_id) {
          const result = await readLead(matter.lead_id);
          if (result.lead) applyLead(defaults, result.lead);
          else leadNote = result.note;
        }
      }
    }
  } else if (leadRaw) {
    if (!UUID.test(leadRaw)) leadNote = "That lead link isn't valid, so the form is blank.";
    else {
      const result = await readLead(leadRaw);
      if (result.lead) applyLead(defaults, result.lead);
      else leadNote = result.note;
    }
  }

  const strip = defaults.leadId ? await loadConsultStrip(defaults.leadId) : null;

  return (
    <div className="pe-page">
      <Link href="/dashboard/proposals/" className="lx-back">
        ← Client proposals
      </Link>
      <div>
        <div className="lx-label">Intake</div>
        <h1 className="lx-h1">New proposal</h1>
        <p className="lx-sub">
          Starts as a draft with your firm&apos;s standard prices and included items. You can change anything on the next page before a named approver
          approves it.
        </p>
      </div>
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
      {leadNote && (
        <p role="status" className="lx-banner lx-banner-mute" style={{ margin: 0 }}>
          {leadNote}
        </p>
      )}
      <NewProposalForm defaults={defaults} hasSettings={settings !== null} packages={packages} />
    </div>
  );
}

type LeadFields = { id: string; first_name: string | null; last_name: string | null; business_name: string | null; email: string | null };

/** A lead through the caller's scoped client: found, not found, or not readable (never confused). */
async function readLead(id: string): Promise<{ lead: LeadFields; note?: undefined } | { lead: null; note: string }> {
  const supabase = await getScopedClient();
  const { data: lead, error } = await supabase
    .from("crm_lead")
    .select("id, first_name, last_name, business_name, email")
    .eq("id", id)
    .maybeSingle();
  if (error) return { lead: null, note: "That lead couldn't be loaded just now, so the client details are blank." };
  if (!lead) return { lead: null, note: "That lead couldn't be found, so the form is blank." };
  return { lead };
}

function applyLead(defaults: NewProposalDefaults, lead: LeadFields): void {
  const person = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim();
  defaults.leadId = lead.id;
  defaults.fullName = person || lead.business_name?.trim() || defaults.fullName;
  defaults.firstName = lead.first_name?.trim() ?? "";
  defaults.company = person && lead.business_name ? lead.business_name.trim() : "";
  defaults.clientEmail = lead.email?.trim() ?? "";
}
