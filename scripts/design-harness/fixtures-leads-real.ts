/**
 * RPB's real SHAPE for the Leads page (item L, step 1), with INVENTED names. Deterministic (seeded), so a re-run draws the same page.
 *
 *  - 23 stages (the firm's order), 310 leads as production stood on Nov 12 after the cleanup: Follow-Up 34, Potential New Client 141,
 *    Consultation Scheduled 1, Post Consultation Email Sent 5 (181 open), Long-Term Nurture 123, Lost 1, Signed LOE 5 (won). No enrollments.
 *  - (older description follows) Follow-Up 144, Potential New Client 156, Consultation Scheduled 1,
 *    Post Consultation Email Sent 6, Signed LOE / Deposit Received (won) 2, Lost 1. All unassigned.
 *  - 301 carry lawmatics_id (Lawmatics import), none a sheet_key. Sources as counted below. 142 created Sept 3-5 2026.
 *  - The import STAMPED last_activity_at (= created_at) on every imported lead, so "activity in the last 90 days" is true of all
 *    of them (the oldest stamp is 68 days before the harness clock). Only 26 leads have last_activity_at in the last 30 days.
 *  - ~25 leads have REAL activity (email_sent, email_received, call_logged, note, voice_note, a person's stage_changed). Every
 *    imported lead has a `lead_created` row (source lawmatics_import); that row is what the import leaves, NOT activity.
 *  - Stage-decision flags are `lead_created` payloads with lawmatics_stage_unmapped / hired_in_lawmatics and the stage the importer
 *    filed the person in; the page reads them through loadStageDecisions (open while the lead is still in that stage).
 *  - Booth scorecards (crm_booth_scorecard) on a few UGW / Event leads.
 *
 * Clock: the harness's frozen clock, 2026-11-10T14:30Z.
 */
import { ORG } from "./fixtures";

export const NOW_MS = Date.parse("2026-11-10T14:30:00Z");
const O = ORG.id;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const ago = (days: number, hour = 14) => iso(Date.UTC(2026, 10, 10, hour, 0, 0) - Math.round(days * DAY));
const day = (m: number, d: number, h = 15) => iso(Date.UTC(2026, m - 1, d, h, 0, 0));

/* seeded PRNG */
let seed = 20261110;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const shuffle = <T,>(a: T[]): T[] => {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const uuid = (p: string, n: number) => `${p}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/* ── stages ── */
const STAGE_DEFS: Array<[string, string]> = [
  ["Follow-Up", "open"], ["Potential New Client", "open"], ["Preliminary Search", "open"], ["Consultation Scheduled", "open"],
  ["Post Consultation Email Sent", "open"], ["Undecided / Questions", "open"], ["LOE & Invoice Sent", "open"], ["Signed LOE / Deposit Received", "won"],
  ["Questionnaire Complete", "open"], ["Comprehensive Search", "open"], ["Preparing Opinion Letter", "open"], ["Opinion Letter Sent", "open"],
  ["Application Preparation", "open"], ["Consent to File Application", "open"], ["Application Ready for Filing", "open"],
  ["Send Invoice for Remaining Balance", "open"], ["Full Balance Received", "won"], ["Application Filed", "open"],
  ["Awaiting Trademark Registration", "open"], ["Publication for Opposition", "open"], ["Trademark Registered", "won"], ["Lost", "lost"], ["Long-Term Nurture", "nurture"],
];
export const stages = STAGE_DEFS.map(([name, category], i) => ({
  id: uuid("5", i + 1), org_id: O, name, order_index: i + 1, category, aging_threshold_days: category === "open" && i < 7 ? [14, 7, 7, 7, 10, 10, 10][i] : null, created_at: day(1, 2, 12),
}));
const S = (name: string) => stages.find((s) => s.name === name)!.id;
export const STAGE = { nur: S("Long-Term Nurture"), fu: S("Follow-Up"), pnc: S("Potential New Client"), sched: S("Consultation Scheduled"), post: S("Post Consultation Email Sent"), won: S("Signed LOE / Deposit Received"), lost: S("Lost") };

/* ── names ── */
const FIRST = ["Aaliyah", "Marcus", "Priya", "Tomas", "Nia", "Jordan", "Camille", "Devon", "Elena", "Hassan", "Imani", "Kofi", "Lucía", "Malik", "Noor", "Owen", "Paloma", "Quincy", "Renata", "Soren", "Tamika", "Uriel", "Valentina", "Wen", "Ximena", "Yusuf", "Zora", "Brielle", "Caleb", "Dahlia", "Emeka", "Fatima", "Gideon", "Harper", "Isaiah", "Jasmine", "Keisha", "Leandro", "Mireille", "Nikhil", "Odette", "Preston", "Rosalind", "Sade", "Terrence", "Una", "Viviana", "Winston", "Anika", "Bao"];
const LAST = ["Abara", "Brennan", "Castellanos", "Delacroix", "Easterling", "Fontaine", "Guerrero", "Holloway", "Ibekwe", "Jankowski", "Kapoor", "Lindqvist", "Montgomery", "Nakamura", "Okonkwo", "Pemberton", "Quintero", "Rousseau", "Sandoval", "Thibodeaux", "Underhill", "Vasquez", "Whitfield", "Yamamoto", "Zimmerman", "Alvarenga", "Beaumont", "Chukwu", "Dunmore", "Espinoza", "Fairweather", "Grisham", "Hartigan", "Iyer", "Joubert", "Kowalczyk", "Lamarque", "Mbeki", "Nwosu", "Oyelaran"];
const BIZ_A = ["Harbor", "Golden", "Velvet", "Copper", "Sunrise", "Evergreen", "Mosaic", "Juniper", "Lantern", "Orchid", "Saffron", "Indigo", "Maple", "Willow", "Cobalt", "Ember", "Bloom", "Tidewater", "Northstar", "Marigold", "Sparrow", "Redwood", "Meridian", "Nectar", "Kindred"];
const BIZ_B = ["Collective", "Studio", "Apothecary", "Kitchen", "Threads", "Wellness", "Coffee Roasters", "Creative", "Beauty Bar", "Consulting Group", "Botanicals", "Design Co.", "Fitness", "Publishing", "Candle Works", "Boutique", "Naturals", "Media", "Foods", "Holdings LLC", "Home & Living", "Learning Lab", "Cosmetics", "Sweets", "Apparel"];
const longNames = new Set<number>();

type Spec = { first: string; last: string; business: string | null; mark: string | null };
function makeSpec(i: number): Spec {
  const first = pick(FIRST);
  const last = pick(LAST);
  const business = rnd() < 0.12 ? null : `${pick(BIZ_A)} ${pick(BIZ_B)}`;
  const mark = rnd() < 0.3 ? null : rnd() < 0.6 && business ? business.replace(/ (LLC|Co\.)$/, "").toUpperCase() : `${pick(BIZ_A)} ${pick(BIZ_B).split(" ")[0]}`.toUpperCase();
  void i;
  return { first, last, business, mark };
}

/* ── the 310 leads: plan the stage, source, creation date, imported-or-not before drawing any detail ── */
const N = 310;
const plan = Array.from({ length: N }, (_, i) => ({
  i,
  stage: "" as string,
  source: null as string | null,
  referralDetail: null as string | null,
  created: "",
  lawmatics: true,
  bulk: false,
  active: false, // real activity beyond creation
  recent: false, // last_activity_at within 30 days
}));
const idxs = shuffle(plan.map((p) => p.i));
// 142 bulk (Sept 3-5)
const bulk = new Set(idxs.slice(0, 142));
// 25 leads with real activity, none of them from the bulk
const activeIdx = idxs.filter((i) => !bulk.has(i)).slice(0, 25);
const active = new Set(activeIdx);
// 9 leads without lawmatics_id: all of them are active leads (typed in or from the form)
activeIdx.slice(0, 9).forEach((i) => (plan[i].lawmatics = false));
for (const p of plan) {
  p.bulk = bulk.has(p.i);
  p.active = active.has(p.i);
}

// stages: 3 won/lost + 7 consult/post among the active leads; the rest of the active ones sit in Follow-Up / PNC
const activeStages = [STAGE.sched, ...Array(5).fill(STAGE.post), STAGE.won, STAGE.won, STAGE.lost, STAGE.nur, ...Array(6).fill(STAGE.pnc), ...Array(9).fill(STAGE.fu)];
activeIdx.forEach((i, k) => (plan[i].stage = activeStages[k]));
const rest = shuffle(plan.filter((p) => !p.active).map((p) => p.i));
// the other 285: 3 signed, 122 nurture, 135 PNC, 25 Follow-Up (production totals: FU 34, PNC 141, nurture 123, won 5)
const restStages = shuffle([...Array(3).fill(STAGE.won), ...Array(122).fill(STAGE.nur), ...Array(135).fill(STAGE.pnc), ...Array(25).fill(STAGE.fu)]);
rest.forEach((i, k) => (plan[i].stage = restStages[k]));

// sources: bulk = UGW 130 + Event 12; the other 168 = UGW 6, none 105, Event 16, Referral 20, Other 9, Social media 6, Assessment 3, three singles
const sources = {
  bulk: shuffle([...Array(130).fill("UGW"), ...Array(12).fill("Event")]),
  other: shuffle([...Array(6).fill("UGW"), ...Array(105).fill(null), ...Array(16).fill("Event"), ...Array(20).fill("Referral"), ...Array(9).fill("Other"), ...Array(6).fill("Social media"), ...Array(3).fill("Assessment"), "Instagram", "Inbound", "Website"]),
};
// the active leads lean on Referral / Other / Social media / Assessment / the singles, as people who actually get worked do
const activePrefer = shuffle(["Referral", "Referral", "Referral", "Referral", "Referral", "Referral", "Referral", "Referral", "Referral", "Referral", "Referral", "Referral", "Other", "Other", "Other", "Social media", "Social media", "Assessment", "Assessment", "Instagram", "Inbound", "Website", "Event", "Event", null]);
const otherPool = [...sources.other];
for (const s of activePrefer) {
  const at = otherPool.indexOf(s);
  otherPool.splice(at, 1);
}
let bi = 0;
let oi = 0;
const activeSrc = [...activePrefer];
let ai = 0;
for (const p of plan) {
  p.source = p.bulk ? sources.bulk[bi++] : p.active ? activeSrc[ai++] : otherPool[oi++];
}

// created dates: bulk Sept 3-5; the rest spread Sept 6 - Nov 9 (a re-stamped batch of 60 on Sept 21); active-but-old leads a bit earlier
const nonBulk = plan.filter((p) => !p.bulk);
nonBulk.forEach((p, k) => {
  if (k < 60 && !p.active) p.created = day(9, 21, 13);
  else p.created = ago(2 + rnd() * 60, 10 + Math.floor(rnd() * 8));
});
plan.filter((p) => p.bulk).forEach((p) => (p.created = day(9, 3 + Math.floor(rnd() * 3), 13 + Math.floor(rnd() * 3))));
// the three active leads whose activity is older than 30 days were created before it
activeIdx.slice(22).forEach((i) => (plan[i].created = ago(58 + rnd() * 4, 11)));
// 4 imports in the last 30 days that are NOT active (so 22 active-and-recent + 4 = 26 with last_activity_at in 30 days)
const freshImports = plan.filter((p) => !p.bulk && !p.active).slice(60, 64);
freshImports.forEach((p, k) => (p.created = ago(4 + k * 6, 11)));
// the old import stamps must never be inside 30 days: push any other non-active non-bulk lead's date earlier than Oct 10
for (const p of plan) {
  if (!p.bulk && !p.active && !freshImports.includes(p) && Date.parse(p.created) > Date.parse(ago(31))) p.created = day(9, 22 + Math.floor(rnd() * 8), 12);
}

/* ── detail ── */
export type LeadRow = Record<string, unknown>;
const longFirst = "Maximiliano-Alexandro"; // 21
const longLast = "Featherstonehaugh"; // 17 -> "Maximiliano-Alexandro Featherstonehaugh" would be 39; the page shows first + last, so use 26 below
const maxName: Spec = { first: "Alexandria-Marguerite", last: "Okon", business: "Okoro Heritage Textiles & Home Goods Collective", mark: "OKORO HERITAGE TEXTILES LTD." };
void longFirst;
void longLast;
void longNames;

export const leads: LeadRow[] = [];
export const activities: LeadRow[] = [];
let actN = 0;
const act = (type: string, lead_id: string, created_at: string, payload: Record<string, unknown>, over: LeadRow = {}) => {
  actN += 1;
  activities.push({ id: uuid("f", actN), org_id: O, type, lead_id, matter_id: null, created_at, actor_type: "user", actor_id: null, payload, ...over });
};

const NEW_ENQUIRY = STAGE.pnc;
const unmappedTexts = ["Consult Completed", "Proposal Sent", "Follow Up", "Consultation Scheduled", "Questionnaire Sent", "Discovery Call Scheduled", "Strategy Session Scheduled"];
let flaggedOpen = 0;
let flaggedTotal = 0;
let hiredFlags = 0;

const ACTIVE_NOTES = [
  "Wants the word mark first, logo later. Asked about timing.",
  "Left a voicemail, will try again Thursday.",
  "Spoke for 15 minutes. Needs to talk to her business partner.",
  "Sent the questionnaire. Waiting on the goods list.",
  "Asked whether a 1(b) filing makes sense before launch.",
  "Referred by a past client. Warm, wants a quote this week.",
  "Called back about price. Walked through the Enhanced package.",
  "Pausing until the new year, check back in January.",
];
const ACTIVE_EMAIL_SUBJECTS = ["Your trademark consult", "Following up on our call", "Questionnaire and next steps", "Quick question about your goods", "Your proposal from RPB Law", "Re: Your trademark consult"];
const deadActive = new Set(activeIdx.slice(22));
const bigPlan = plan.slice();
for (const p of bigPlan) {
  const id = uuid("b", p.i + 1);
  const spec = p.i === 7 ? maxName : makeSpec(p.i);
  // two more long ones: a 26-character name and a 28-character mark
  if (p.i === 41) Object.assign(spec, { first: "Bartholomew", last: "Featherstone", business: "Harborline Coastal Provisions & Trading Co.", mark: "HARBORLINE COASTAL TRADING" });
  const created = p.created;
  const imported = p.lawmatics;
  const last_activity_at = created; // the import stamps it; real activity below overwrites it
  const lead: LeadRow = {
    id, org_id: O, first_name: spec.first, last_name: spec.last,
    email: `${spec.first.toLowerCase().replace(/[^a-z]/g, "")}.${spec.last.toLowerCase().replace(/[^a-z]/g, "")}@${(spec.business ?? "mail").toLowerCase().replace(/[^a-z]/g, "").slice(0, 14)}.example`,
    phone: rnd() < 0.7 ? `+1 555 01${String(10 + (p.i % 90)).padStart(2, "0")}` : null,
    business_name: spec.business, mark_text: spec.mark,
    current_stage_id: p.stage, assigned_to: null, created_at: created, updated_at: created, stage_entered_at: created, last_activity_at,
    last_inbound_at: null, last_outbound_at: null, practice_area: rnd() < 0.8 ? "Trademark" : null,
    referral_source: p.source, referral_detail: p.source === "UGW" ? "UGW 2026" : p.source === "Event" ? "Brand Summit booth" : p.source === "Referral" ? "Past client" : null,
    temperature: null, temperature_set_at: null, temperature_set_by: null, lane: null, lane_set_at: null, lane_set_by: null,
    lawmatics_id: imported ? String(41_000_000 + p.i * 37) : null, lawmatics_synced_at: imported ? created : null, sheet_key: null, website: null, founder_id: null,
    ai_summary: null, ai_red_flags: [], ai_enriched_at: null, nurture_campaign: null, nurture_last_sent_at: null, qualification_score: null, urgency_band: null, value_band: null,
  };
  leads.push(lead);

  // what the import leaves: one lead_created row, flagged for some
  const payload: Record<string, unknown> = { source: imported ? "lawmatics_import" : p.source === "Referral" || p.source === null ? "manual" : "intake form" };
  if (imported) {
    // Lawmatics gave a stage to most people who sit in PNC (filed there by the importer); the old importer also left a few in Follow-Up
    const flagIt = (p.stage === NEW_ENQUIRY && rnd() < 0.7) || (p.stage === STAGE.fu && rnd() < 0.08);
    if (flagIt) {
      payload.lawmatics_stage_unmapped = pick(unmappedTexts);
      payload.stage_id = p.stage;
      flaggedTotal += 1;
    } else if (p.stage === STAGE.fu) {
      // a Follow-Up lead filed in PNC by the importer and since moved: the flag exists but is decided
      if (rnd() < 0.4) { payload.lawmatics_stage_unmapped = "Follow Up"; payload.stage_id = NEW_ENQUIRY; flaggedTotal += 1; }
    }
    if (p.stage === NEW_ENQUIRY && !payload.lawmatics_stage_unmapped && rnd() < 0.02) {
      payload.hired_in_lawmatics = true; payload.stage_id = p.stage; hiredFlags += 1; flaggedTotal += 1;
    }
    if (payload.stage_id === p.stage) flaggedOpen += 1;
  }
  // "payload->>source" is how loadStageDecisions filters (the fake client matches on a column of that name); real rows have no such column.
  act("lead_created", id, created, payload, { actor_type: "system", "payload->>source": payload.source });

  if (p.active) {
    const rows = 1 + Math.floor(rnd() * 5);
    const recent = k22(p);
    let latest = Date.parse(created);
    for (let r = 0; r < rows; r++) {
      const when = Math.max(recent ? NOW_MS - Math.round((0.3 + rnd() * 28) * DAY) : NOW_MS - Math.round((32 + rnd() * 24) * DAY), Date.parse(created) + DAY);
      const type = pick(["email_sent", "email_sent", "email_received", "call_logged", "note", "note", "voice_note", "stage_changed"] as const);
      const t = iso(when);
      if (type === "email_sent") act(type, id, t, { subject: pick(ACTIVE_EMAIL_SUBJECTS), direction: "outbound" });
      else if (type === "email_received") act(type, id, t, { subject: pick(ACTIVE_EMAIL_SUBJECTS), direction: "inbound" });
      else if (type === "call_logged") act(type, id, t, { summary: pick(ACTIVE_NOTES) });
      else if (type === "voice_note") act(type, id, t, { transcript: pick(ACTIVE_NOTES) });
      else if (type === "note") act(type, id, t, { note: pick(ACTIVE_NOTES) });
      else act(type, id, t, { from_stage: "Potential New Client", to_stage: "Follow-Up", actor: "user" }, { actor_type: "user" });
      latest = Math.max(latest, when);
      if (type === "email_sent" || type === "call_logged") lead.last_outbound_at = iso(Math.max(Date.parse((lead.last_outbound_at as string) ?? "0") || 0, when));
      if (type === "email_received") lead.last_inbound_at = iso(Math.max(Date.parse((lead.last_inbound_at as string) ?? "0") || 0, when));
    }
    lead.last_activity_at = iso(latest);
    lead.updated_at = iso(latest);
    lead.stage_entered_at = iso(latest - 3 * DAY > Date.parse(created) ? latest - 3 * DAY : Date.parse(created));
  }
}
function k22(p: { i: number }) {
  // 22 of the 25 active leads are recent
  return !deadActive.has(p.i);
}

// stage_entered_at of the imported untouched leads is the import time (already set); a few hot/warm/cold lanes set by a person
const laneTargets = shuffle(activeIdx).slice(0, 10);
laneTargets.forEach((i, k) => {
  const l = leads[i];
  l.lane = k < 3 ? "hot" : k < 7 ? "warm" : "cold";
  l.lane_set_at = l.last_activity_at;
});

/* ── booth scorecards on UGW / Event leads ── */
export const boothScorecards: LeadRow[] = [];
const boothLeads = leads.filter((l) => (l.referral_source === "UGW" || l.referral_source === "Event") && l.lawmatics_id).slice(0, 14);
boothLeads.forEach((l, k) => {
  boothScorecards.push({
    id: uuid("c", k + 1), org_id: O, lead_id: l.id, client_ref: `ref-${k + 1}`, ticket_code: `T${1000 + k}`, event_code: "UGW2026", answers: [], band: pick(["strong", "mixed", "weak"]),
    captured_by: null, completed_at: day(9, 4, 16), consent_at: day(9, 4, 16), consent_email: true, consent_sms: false, created_at: day(9, 4, 16), gaps: [], score: 40 + Math.floor(rnd() * 50),
    temperature: pick(["hot", "warm", "cold"]), track: "trademark", mark_name: l.mark_text, mark_goods: null, lawmatics_contact_id: null, lawmatics_synced_at: null, lawmatics_tagged_at: null,
  });
});

/* ── two possible duplicates among the OPEN leads: one shared email (different case), one shared first + last name ── */
{
  const open = leads.filter((l) => l.current_stage_id === STAGE.pnc || l.current_stage_id === STAGE.fu);
  const hasActivity = new Set(activities.filter((x) => ["email_sent", "email_received", "call_logged", "note", "voice_note"].includes(String(x.type))).map((x) => x.lead_id));
  const quiet = open.filter((l) => hasActivity.has(l.id));
  quiet[0].email = String(quiet[1].email).toUpperCase();
  quiet[2].first_name = quiet[3].first_name;
  quiet[2].last_name = quiet[3].last_name;
}

/* ── what the page reads, newest activity first (the real list is ordered by last_activity_at desc) ── */
leads.sort((a, b) => Date.parse(b.last_activity_at as string) - Date.parse(a.last_activity_at as string));
activities.sort((a, b) => Date.parse(b.created_at as string) - Date.parse(a.created_at as string));

export const fixtureSummary = () => {
  const count = (f: (l: LeadRow) => boolean) => leads.filter(f).length;
  const bySource: Record<string, number> = {};
  for (const l of leads) bySource[String(l.referral_source)] = (bySource[String(l.referral_source)] ?? 0) + 1;
  const realTypes = new Set(["email_sent", "email_received", "call_logged", "note", "voice_note", "stage_changed"]);
  const withReal = new Set(activities.filter((a) => realTypes.has(a.type as string)).map((a) => a.lead_id));
  const stageName = (id: unknown) => stages.find((s) => s.id === id)!.name;
  const byStage: Record<string, number> = {};
  for (const l of leads) byStage[stageName(l.current_stage_id)] = (byStage[stageName(l.current_stage_id)] ?? 0) + 1;
  return {
    leads: leads.length, byStage, bySource,
    withLawmaticsId: count((l) => !!l.lawmatics_id), withSheetKey: count((l) => !!l.sheet_key),
    createdSep3to5: count((l) => String(l.created_at) >= "2026-09-03" && String(l.created_at) < "2026-09-06"),
    lastActivityIn30d: count((l) => NOW_MS - Date.parse(l.last_activity_at as string) <= 30 * DAY),
    lastActivityIn90d: count((l) => NOW_MS - Date.parse(l.last_activity_at as string) <= 90 * DAY),
    withRealActivity: withReal.size, activityRows: activities.length, boothScorecards: boothScorecards.length,
    stageDecisionFlags: { total: flaggedTotal, openOnTheBoard: flaggedOpen, hired: hiredFlags },
    longest: {
      name: Math.max(...leads.map((l) => `${l.first_name} ${l.last_name}`.length)),
      business: Math.max(...leads.map((l) => String(l.business_name ?? "").length)),
      mark: Math.max(...leads.map((l) => String(l.mark_text ?? "").length)),
    },
  };
};
