import type { Row } from "./fake-db";

export const ORG = "org-1";
export const OTHER_ORG = "org-2";

/** Roles allowed to write matters, and the two that are not (plus an unresolved role). */
export const WRITE_ROLES = ["owner", "admin", "senior_admin", "intake", "paralegal", "law_clerk", "attorney", "clerk"] as const;
export const READ_ONLY_ROLES = ["viewer", "social_media"] as const;

export function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** A small firm: one matter, a few contacts, deadlines, tasks. Rows of OTHER_ORG must stay invisible. */
export function standardSeed(): Record<string, Row[]> {
  return {
    crm_matter: [
      {
        id: "matter-1",
        org_id: ORG,
        type: "TM",
        matter_number: "TM-2026-0001",
        title: "Acme",
        package_name: "Basic",
        referral_source: "Booth",
        notes: null,
        lead_id: null,
        filing_basis: null,
        status: "open",
        opened_at: "2026-09-01T00:00:00Z",
        stage_id: null,
        stage_entered_at: null,
        assigned_to: null,
        owner_name: null,
        mark_text: null,
        filing_date: null,
        serial_number: null,
        registration_number: null,
        international_classes: null,
        uspto_status: null,
      },
      { id: "matter-lit", org_id: ORG, type: "LIT", matter_number: "26-CC-011354", title: "Case", package_name: null, referral_source: null, notes: null, lead_id: null, status: "open", opened_at: "2026-09-01T00:00:00Z", stage_id: null, stage_entered_at: null },
      { id: "matter-x", org_id: OTHER_ORG, type: "TM", matter_number: "TM-2026-0009", title: "Other firm", package_name: null, referral_source: null, notes: null, lead_id: null },
    ],
    crm_contact: [
      { id: "contact-1", org_id: ORG, first_name: "Ana", last_name: "Smith", business_name: null, email: "ana@example.com", phone: "555-0100", company_name: "Acme Inc", notes: null, created_at: "2026-01-01T00:00:00Z" },
      { id: "contact-2", org_id: ORG, first_name: "Bo", last_name: "Lee", business_name: null, email: "bo@example.com", phone: null, company_name: null, notes: null, created_at: "2026-01-02T00:00:00Z" },
      { id: "contact-x", org_id: OTHER_ORG, first_name: "Ana", last_name: "Other", business_name: null, email: "ana@other.example", phone: null, company_name: null, notes: null, created_at: "2026-01-03T00:00:00Z" },
    ],
    crm_matter_contact: [],
    crm_matter_deadline: [
      {
        id: "dl-open", org_id: ORG, matter_id: "matter-1", kind: "office_action_response", title: null, due_date: "2026-11-03",
        status: "open", attorney_confirmed: false, confirmed_by: null, confirmed_at: null, satisfied_at: null,
        extensions_used: 0, is_extendable: true, max_extensions: 1, source: "calculated",
      },
      {
        id: "dl-conf", org_id: ORG, matter_id: "matter-1", kind: "statement_of_use", title: "SOU", due_date: "2026-12-01",
        status: "open", attorney_confirmed: true, confirmed_by: "user-9", confirmed_at: "2026-10-01T00:00:00Z", satisfied_at: null,
        extensions_used: 0, is_extendable: false, max_extensions: null, source: "official_notice",
      },
      {
        id: "dl-closed", org_id: ORG, matter_id: "matter-1", kind: "other", title: "Closed one", due_date: "2026-09-01",
        status: "satisfied", attorney_confirmed: false, confirmed_by: null, confirmed_at: null, satisfied_at: "2026-09-02T00:00:00Z",
        extensions_used: 0, is_extendable: false, max_extensions: null, source: "manual",
      },
      {
        id: "dl-x", org_id: OTHER_ORG, matter_id: "matter-x", kind: "other", title: "Other", due_date: "2026-11-03",
        status: "open", attorney_confirmed: false, confirmed_by: null, confirmed_at: null, satisfied_at: null,
        extensions_used: 0, is_extendable: false, max_extensions: null, source: "manual",
      },
    ],
    crm_task: [
      { id: "task-1", org_id: ORG, matter_id: "matter-1", lead_id: null, title: "Call the client", due_at: "2026-10-30T00:00:00Z", assignee_id: null, status: "open", type: "custom" },
      { id: "task-x", org_id: OTHER_ORG, matter_id: "matter-x", lead_id: null, title: "Other task", due_at: null, assignee_id: null, status: "open", type: "custom" },
    ],
    crm_activity: [],
  };
}
