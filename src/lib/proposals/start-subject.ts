import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { clientFromLead, leadBrand, matterBrand, matterTitle, type LeadFill, type MatterFill } from "./prefill";
import { leadOptionLabel } from "./lead-label";

/**
 * Who a new proposal is for, read from the lead or matter the person chose.
 *
 * The browser sends an id, never the client's details: this reads the record itself through the caller's own
 * scoped client (RLS on org_id), so another firm's id is simply "not found". Three states, never two: found /
 * not found / couldn't be read. A matter's own lead is read too, when it has one, and is linked.
 */

export type StartSubject = {
  leadId: string | null;
  matterId: string | null;
  fullName: string;
  firstName: string;
  company: string;
  clientEmail: string;
  /** The first brand name: the record's mark, else its business name. Blank when there is none. */
  brand: string;
  /** How the picker's "For:" bar names the record. */
  label: string;
  lead: LeadFill | null;
  matter: MatterFill | null;
};

export type StartSubjectRead = { status: "ok"; subject: StartSubject } | { status: "not-found" } | { status: "unavailable" };

const LEAD_COLUMNS = "id, first_name, last_name, business_name, email, mark_text";
const MATTER_COLUMNS = "id, lead_id, owner_name, mark_text, title, matter_number";

async function readLead(id: string): Promise<{ status: "ok"; lead: LeadFill } | { status: "not-found" } | { status: "unavailable" }> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase.from("crm_lead").select(LEAD_COLUMNS).eq("id", id).maybeSingle();
    if (error) return { status: "unavailable" };
    return data ? { status: "ok", lead: data } : { status: "not-found" };
  } catch {
    return { status: "unavailable" };
  }
}

/** The matter wins when both ids are given, as the page always did. At least one id is required. */
export async function readStartSubject(input: { leadId?: string | null; matterId?: string | null }): Promise<StartSubjectRead> {
  if (input.matterId) {
    let matter: MatterFill | null;
    try {
      const supabase = await getScopedClient();
      const { data, error } = await supabase.from("crm_matter").select(MATTER_COLUMNS).eq("id", input.matterId).maybeSingle();
      if (error) return { status: "unavailable" };
      matter = data;
    } catch {
      return { status: "unavailable" };
    }
    if (!matter) return { status: "not-found" };
    let lead: LeadFill | null = null;
    if (matter.lead_id) {
      const read = await readLead(matter.lead_id);
      if (read.status === "unavailable") return read;
      if (read.status === "ok") lead = read.lead;
    }
    const fromLead = lead ? clientFromLead(lead) : null;
    const fullName = fromLead?.fullName || matter.owner_name?.trim() || "";
    return {
      status: "ok",
      subject: {
        leadId: lead?.id ?? null,
        matterId: matter.id,
        fullName,
        firstName: fromLead?.firstName ?? "",
        company: fromLead?.company ?? "",
        clientEmail: fromLead?.clientEmail ?? "",
        brand: matterBrand(matter, lead),
        label: matterTitle(matter),
        lead,
        matter,
      },
    };
  }
  if (!input.leadId) return { status: "not-found" };
  const read = await readLead(input.leadId);
  if (read.status !== "ok") return read;
  const client = clientFromLead(read.lead);
  return {
    status: "ok",
    subject: { leadId: read.lead.id, matterId: null, ...client, brand: leadBrand(read.lead), label: leadOptionLabel(read.lead), lead: read.lead, matter: null },
  };
}
