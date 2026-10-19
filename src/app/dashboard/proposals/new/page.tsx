import Link from "next/link";
import { currentRole } from "@/lib/auth/current-role";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getFirmTimeZone } from "@/lib/org/profile";
import { firmCivilDate } from "@/lib/quotes/firm-time";
import { getProposalSettings } from "@/lib/proposals/store";
import { PROPOSAL_STAFF_WRITE_ROLES } from "@/lib/proposals/types";
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
 * New proposal. `?lead=<id>` pre-fills the client from the lead (read through
 * the caller's own scoped client, so a lead from another firm is simply not
 * found). The prices and included items are NOT read here: the create action
 * reads the firm's settings itself, so the form cannot carry prices.
 */
export default async function NewProposalPage({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  await requireProposalsModule();
  const { lead: leadRaw } = await searchParams;

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

  const [tz, settings] = await Promise.all([getFirmTimeZone(), getProposalSettings().catch(() => null)]);

  const defaults: NewProposalDefaults = {
    leadId: "",
    fullName: "",
    firstName: "",
    company: "",
    clientEmail: "",
    title: "Trademark Proposal",
    expiresOn: defaultExpiry(tz),
    payUrl: settings?.default_pay_url ?? "",
  };

  let leadNote: string | null = null;
  if (leadRaw) {
    if (!UUID.test(leadRaw)) leadNote = "That lead link isn't valid, so the form is blank.";
    else {
      const supabase = await getScopedClient();
      const { data: lead } = await supabase
        .from("crm_lead")
        .select("id, first_name, last_name, business_name, email")
        .eq("id", leadRaw)
        .maybeSingle();
      if (!lead) leadNote = "That lead couldn't be found, so the form is blank.";
      else {
        const person = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim();
        defaults.leadId = lead.id;
        defaults.fullName = person || lead.business_name?.trim() || "";
        defaults.firstName = lead.first_name?.trim() ?? "";
        defaults.company = person && lead.business_name ? lead.business_name.trim() : "";
        defaults.clientEmail = lead.email?.trim() ?? "";
      }
    }
  }

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
      {leadNote && (
        <p role="status" className="lx-banner lx-banner-mute" style={{ margin: 0 }}>
          {leadNote}
        </p>
      )}
      <NewProposalForm defaults={defaults} hasSettings={settings !== null} />
    </div>
  );
}
