/**
 * Sample data and a fake scoped Supabase client for the "mono" screens (staff Proposals, Leads, Matters pages in the
 * technician AND owner shells). The fake client answers `from(table).select().eq()...` from `tables`, so the REAL loaders
 * (listLeads, listMatters, getLead, getMatter, timeline, ...) run unchanged. Filters other than eq / in / is / neq are
 * ignored on purpose: the fixtures hold one firm and few rows. INVENTED names only.
 */
import { ORG, OWNER_ID, members } from "./fixtures";

const O = ORG.id;
const DANA = members[1].userId;
const SAM = members[2].userId;
const iso = (d: string) => `2026-${d}`;
const id = (n: number, p = "1") => `${p.repeat(8)}-${p.repeat(4)}-4${p.repeat(3)}-8${p.repeat(3)}-${String(n).padStart(12, "0")}`;

export const S = {
  newLead: id(1, "a"), scheduled: id(2, "a"), held: id(3, "a"), proposal: id(4, "a"), followUp: id(5, "a"), won: id(6, "a"), lost: id(7, "a"),
};
const stage = (sid: string, name: string, order: number, category: string, aging: number | null = null) => ({ id: sid, org_id: O, name, order_index: order, category, aging_threshold_days: aging, created_at: iso("01-02T12:00:00Z") });
export const stages = [
  stage(S.newLead, "Potential New Client", 1, "open", 3),
  stage(S.scheduled, "Consult Scheduled", 2, "open", 7),
  stage(S.held, "Consult Held", 3, "open", 7),
  stage(S.proposal, "Proposal Sent", 4, "open", 10),
  stage(S.followUp, "Follow-Up", 5, "nurture"),
  stage(S.won, "Signed LOE / Deposit Received", 6, "won"),
  stage(S.lost, "Lost", 7, "lost"),
];

export const L = { maya: id(1, "b"), jonah: id(2, "b"), sam: id(3, "b"), ines: id(4, "b"), priya: id(5, "b"), theo: id(6, "b"), lena: id(7, "b"), omar: id(8, "b") };
const lead = (lid: string, first: string, last: string, business: string, mark: string, sid: string, over: Record<string, unknown> = {}) => ({
  id: lid, org_id: O, first_name: first, last_name: last, email: `${first.toLowerCase()}@${business.toLowerCase().replace(/[^a-z]/g, "")}.example`, phone: "+1 555 0100", business_name: business, mark_text: mark,
  current_stage_id: sid, assigned_to: OWNER_ID, created_at: iso("10-20T14:00:00Z"), updated_at: iso("11-08T14:00:00Z"), stage_entered_at: iso("11-01T14:00:00Z"), last_activity_at: iso("11-08T14:00:00Z"),
  last_inbound_at: iso("11-06T14:00:00Z"), last_outbound_at: iso("11-07T14:00:00Z"), practice_area: "Trademark", referral_source: "Website", referral_detail: "UGW 2026", temperature: "warm", temperature_set_at: null, temperature_set_by: null,
  lane: null, lane_set_at: null, lane_set_by: null, lawmatics_id: null, lawmatics_synced_at: null, sheet_key: null, website: null, founder_id: null, ai_summary: null, ai_red_flags: [], ai_enriched_at: null,
  nurture_campaign: null, nurture_last_sent_at: null, qualification_score: null, urgency_band: "medium", value_band: "medium", ...over,
});
export const leads = [
  lead(L.maya, "Maya", "Chen", "CRUMB & CO.", "CRUMB & CO.", S.proposal, { temperature: "hot", last_activity_at: iso("11-09T16:00:00Z"), stage_entered_at: iso("11-05T14:00:00Z") }),
  lead(L.jonah, "Jonah", "Reyes", "Northfield Goods", "NORTHFIELD GOODS", S.held, { assigned_to: DANA, last_inbound_at: iso("11-03T14:00:00Z"), last_activity_at: iso("11-04T14:00:00Z") }),
  lead(L.sam, "Sam", "Lee", "Lumen Tea Company", "LUMEN TEA", S.scheduled, { temperature: "hot", assigned_to: SAM, last_activity_at: iso("11-10T12:00:00Z"), stage_entered_at: iso("11-09T14:00:00Z") }),
  lead(L.ines, "Ines", "Walker", "Paper Moon Studio", "PAPER MOON", S.newLead, { temperature: "cold", assigned_to: null, last_inbound_at: iso("11-09T10:00:00Z"), last_outbound_at: null, last_activity_at: iso("11-09T10:00:00Z"), stage_entered_at: iso("11-09T10:00:00Z") }),
  lead(L.priya, "Priya", "Nair", "Oat & Orchard", "OAT & ORCHARD", S.proposal, { last_activity_at: iso("10-25T14:00:00Z"), stage_entered_at: iso("10-20T14:00:00Z"), last_inbound_at: iso("10-22T14:00:00Z") }),
  lead(L.theo, "Theo", "Marsh", "Blue Heron Outfitters", "BLUE HERON", S.followUp, { temperature: "cold", assigned_to: null, last_activity_at: iso("10-02T14:00:00Z"), stage_entered_at: iso("10-02T14:00:00Z") }),
  lead(L.lena, "Lena", "Ortiz", "Halcyon Press", "HALCYON PRESS", S.scheduled, { assigned_to: DANA, last_activity_at: iso("11-07T14:00:00Z") }),
  lead(L.omar, "Omar", "Haddad", "Salt Line Supply", "SALT LINE", S.newLead, { assigned_to: null, last_activity_at: iso("11-10T08:00:00Z"), stage_entered_at: iso("11-10T08:00:00Z"), last_outbound_at: null }),
];

export const MS = { intake: id(1, "c"), filing: id(2, "c"), exam: id(3, "c"), usptoWait: id(4, "c"), pub: id(5, "c"), reg: id(6, "c"), clientWait: id(7, "c") };
const mstage = (sid: string, code: string, label: string, order: number, waiting: string, open = true) => ({ id: sid, org_id: O, code, label, order_index: order, waiting_on: waiting, is_open: open, created_at: iso("01-02T12:00:00Z"), updated_at: iso("01-02T12:00:00Z") });
export const matterStages = [
  mstage(MS.intake, "intake", "1. Signed LOE / Deposit Received", 1, "firm"),
  mstage(MS.filing, "filing", "2. Awaiting Filing", 2, "firm"),
  mstage(MS.exam, "exam", "3. Awaiting Examination", 3, "uspto"),
  mstage(MS.usptoWait, "oa", "4. Office Action Response", 4, "firm"),
  mstage(MS.pub, "pub", "5. Published for Opposition", 5, "uspto"),
  mstage(MS.clientWait, "cw", "5b. Waiting on Client Specimen", 5.5, "client"),
  mstage(MS.reg, "reg", "6. Registered", 6, "client", false),
];

export const M = { lumen: id(1, "d"), halcyon: id(2, "d"), north: id(3, "d"), oat: id(4, "d"), blue: id(5, "d"), salt: id(6, "d"), crumb: id(7, "d") };
const matter = (mid: string, num: string, mark: string, owner: string, sid: string, over: Record<string, unknown> = {}) => ({
  id: mid, org_id: O, matter_number: num, title: mark, mark_text: mark, owner_name: owner, type: "TM", status: "open", stage_id: sid, stage_entered_at: iso("10-28T14:00:00Z"), assigned_to: OWNER_ID,
  opened_at: iso("09-15T14:00:00Z"), created_at: iso("09-15T14:00:00Z"), updated_at: iso("11-05T14:00:00Z"), lead_id: null, package_name: "Enhanced", referral_source: "Referral", notes: null,
  international_classes: [25, 35], goods_services: "Class 25: Clothing, namely shirts and hats. Class 35: Online retail store services.", filing_basis: "1a", filing_date: iso("09-30"), serial_number: "97123456",
  registration_number: null, registration_date: null, examining_attorney: null, uspto_status: "Awaiting examination", uspto_status_as_of: iso("11-01T00:00:00Z"), lawmatics_id: null, lawmatics_synced_at: null, practice_pipeline: null, ...over,
});
export const matters = [
  matter(M.lumen, "TM-1042", "LUMEN TEA", "Sam Lee", MS.usptoWait, { assigned_to: DANA, stage_entered_at: iso("10-05T14:00:00Z"), lead_id: L.sam }),
  matter(M.halcyon, "TM-1038", "HALCYON PRESS", "Lena Ortiz", MS.filing, { stage_entered_at: iso("11-03T14:00:00Z"), lead_id: L.lena }),
  matter(M.north, "TM-0991", "NORTHFIELD GOODS", "Jonah Reyes", MS.exam, { stage_entered_at: iso("09-20T14:00:00Z"), assigned_to: SAM }),
  matter(M.oat, "TM-1020", "OAT & ORCHARD", "Priya Nair", MS.intake, { stage_entered_at: iso("11-08T14:00:00Z"), assigned_to: null }),
  matter(M.blue, "TM-0974", "BLUE HERON", "Theo Marsh", MS.pub, { stage_entered_at: iso("10-12T14:00:00Z"), serial_number: "97000111" }),
  matter(M.salt, "TM-1011", "SALT LINE", "Omar Haddad", MS.clientWait, { stage_entered_at: iso("10-30T14:00:00Z") }),
  matter(M.crumb, "TM-1049", "CRUMB & CO.", "Maya Chen", MS.intake, { stage_entered_at: iso("11-09T14:00:00Z"), assigned_to: OWNER_ID, lead_id: L.maya }),
];

const task = (tid: string, title: string, due: string, over: Record<string, unknown>) => ({ id: tid, org_id: O, title, status: "open", type: "custom", due_at: due, assignee_id: OWNER_ID, created_at: iso("11-01T14:00:00Z"), updated_at: iso("11-01T14:00:00Z"), lead_id: null, matter_id: null, ...over });
const act = (aid: string, type: string, created: string, payload: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ id: aid, org_id: O, type, created_at: created, actor_type: "user", actor_id: OWNER_ID, lead_id: null, matter_id: null, payload, ...over });
const dl = (did: string, mid: string, title: string, due: string, kind = "office_action") => ({ id: did, org_id: O, matter_id: mid, title, due_date: due, kind, status: "open", source: "manual", attorney_confirmed: true, confirmed_at: iso("10-01T00:00:00Z"), confirmed_by: OWNER_ID, extensions_used: 0, is_extendable: true, max_extensions: 1, notes: null, anchor_date: null, anchor_event: null, calculation_basis: null, satisfied_at: null, created_at: iso("10-01T00:00:00Z"), created_by: OWNER_ID, updated_at: iso("10-01T00:00:00Z") });

export const tables: Record<string, Record<string, unknown>[]> = {
  crm_stage: stages,
  crm_lead: leads,
  crm_matter_stage: matterStages,
  crm_matter: matters,
  crm_task: [
    task(id(1, "e"), "Call about the proposal", iso("11-07T17:00:00Z"), { lead_id: L.maya }),
    task(id(2, "e"), "Send filing receipt", iso("11-12T17:00:00Z"), { matter_id: M.halcyon }),
    task(id(3, "e"), "Review examiner letter", iso("11-13T17:00:00Z"), { matter_id: M.north, assignee_id: DANA }),
    task(id(4, "e"), "Confirm the specimen", iso("11-19T17:00:00Z"), { matter_id: M.lumen, assignee_id: DANA }),
  ],
  crm_activity: [
    act(id(1, "f"), "note", iso("11-09T16:00:00Z"), { note: "Maya asked about adding a design mark. Told her we can quote it after she picks a package." }, { lead_id: L.maya }),
    act(id(2, "f"), "email_sent", iso("11-07T15:00:00Z"), { subject: "Your proposal from RPB Law", direction: "outbound" }, { lead_id: L.maya }),
    act(id(3, "f"), "stage_changed", iso("11-05T14:00:00Z"), { from_stage: "Consult Held", to_stage: "Proposal Sent" }, { lead_id: L.maya }),
    act(id(4, "f"), "call_logged", iso("11-03T15:30:00Z"), { summary: "Consult call, 40 minutes. Wants word mark first." }, { lead_id: L.maya }),
    act(id(5, "f"), "lead_created", iso("10-20T14:00:00Z"), { source: "intake form" }, { lead_id: L.maya, actor_type: "system", actor_id: null }),
    act(id(6, "f"), "note", iso("11-04T16:00:00Z"), { note: "Sam sent the specimen photos. Review before the response is filed." }, { matter_id: M.lumen }),
    act(id(7, "f"), "stage_changed", iso("10-05T14:00:00Z"), { from_stage: "Awaiting Examination", to_stage: "Office Action Response" }, { matter_id: M.lumen }),
    act(id(8, "f"), "matter_opened", iso("09-15T14:00:00Z"), { source: "signed quote" }, { matter_id: M.lumen }),
  ],
  crm_matter_deadline: [
    dl(id(1, "9"), M.lumen, "Office action response", iso("11-09")),
    dl(id(2, "9"), M.lumen, "Statement of use", iso("12-20"), "statement_of_use"),
    dl(id(3, "9"), M.north, "Registration maintenance", iso("11-17"), "maintenance"),
  ],
  crm_contact: [{ id: id(1, "8"), org_id: O, first_name: "Sam", last_name: "Lee", email: "sam@lumentea.example", phone: "+1 555 0142", business_name: "Lumen Tea Company", company_name: null, notes: null, created_at: iso("09-01T00:00:00Z"), updated_at: iso("09-01T00:00:00Z") }],
  crm_matter_contact: [{ id: id(1, "7"), org_id: O, matter_id: M.lumen, contact_id: id(1, "8"), role: "client", created_at: iso("09-15T14:00:00Z") }],
  crm_tag: [{ id: id(1, "6"), org_id: O, code: "PA-TM", label: "Trademark", dimension: "PA", color: null, description: null }],
  crm_lead_tag: [{ lead_id: L.maya, org_id: O, tag_id: id(1, "6"), applied_at: iso("10-20T14:00:00Z"), applied_by: null, confidence: 1, needs_review: false, source: "manual" }],
};

type Filter = (r: Record<string, unknown>) => boolean;

class Query {
  private filters: Filter[] = [];
  private mode: "rows" | "single" | "maybe" | "count" = "rows";
  private writing = false;
  constructor(private table: string) {}
  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.head) this.mode = "count";
    return this;
  }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  is(c: string, v: unknown) { this.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
  not(c: string, op: string, v: unknown) { if (op === "is") this.filters.push((r) => (v === null ? r[c] != null : r[c] !== v)); return this; }
  gte() { return this; } gt() { return this; } lte() { return this; } lt() { return this; } like() { return this; } ilike() { return this; } or() { return this; }
  contains() { return this; } order() { return this; } limit() { return this; } range() { return this; } match() { return this; } filter() { return this; } textSearch() { return this; } overlaps() { return this; }
  insert() { this.writing = true; return this; } update() { this.writing = true; return this; } upsert() { this.writing = true; return this; } delete() { this.writing = true; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
    const rows = this.writing ? [] : (tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    let out: unknown;
    if (this.mode === "single" || this.mode === "maybe") out = { data: rows[0] ?? null, error: null };
    else if (this.mode === "count") out = { data: null, error: null, count: rows.length };
    else out = { data: rows, error: null, count: rows.length };
    return Promise.resolve(out).then(res, rej);
  }
}

export function fakeClient() {
  return {
    from: (t: string) => new Query(t),
    rpc: async (name: string) => ({ data: name === "current_org_role" ? "owner" : null, error: null }),
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }), createSignedUrls: async () => ({ data: [], error: null }) }) },
  };
}
