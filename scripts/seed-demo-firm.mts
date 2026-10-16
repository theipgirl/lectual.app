// scripts/seed-demo-firm.mts
//
// Seeds a demo firm, "Hartwell IP (demo)", into lectual-dev so every page of
// the workspace has something to click through: leads across the intake
// stages, trademark and litigation matters on the board, docketed deadlines,
// timeline activity, tasks for Today, two generated letters on Documents, a
// live public intake form with submissions and 30 days of funnel events, a
// follow-up campaign with an enrollment, and Firm brain entries and claims.
//
// WHY A SCRIPT: content is not schema. A migration replays into every
// environment, and demo leads in the migration chain once reached production
// (lectual 0028 → 0032). This runs by hand, against dev only.
//
// DEV ONLY, BY ALLOWLIST: it refuses any Supabase URL that isn't lectual-dev
// (vncamzabuhvlliscprmm). Not a denylist: a new project must not become a
// target by accident.
//
// Usage (Node 22+, no build step):
//   NEXT_PUBLIC_SUPABASE_URL=https://vncamzabuhvlliscprmm.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... pnpm seed:demo [--reset] [--member you@firm.com]
//
//   --reset          delete the demo firm (and its stored letters and voice notes) and
//                    seed it again; everything else goes with the org (on delete cascade)
//   --member <email> also make that existing or new login an owner of the demo firm,
//                    so you can sign in to it with your own magic link
//
// The slug is `hartwell-ip`, which lectual's test teardown spares. Demo logins
// use the reserved `.test` domain (never deliverable); every client name,
// address and mark is fictional.
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Document, Packer, Paragraph, TextRun } from "docx";
// Pure modules only (no "@/" imports), so the seed builds the intake config
// and decides "live" exactly as the Forms page's save does.
import { defaultIntakeConfig, validateIntakeConfig } from "../src/lib/intake-forms/config.ts";
import { checklistComplete, goLiveChecklist } from "../src/lib/intake-forms/checklist.ts";
import { slugFromFirmName } from "../src/lib/intake-forms/slug.ts";

const DEV_REF = "vncamzabuhvlliscprmm";
const SLUG = "hartwell-ip";
const NAME = "Hartwell IP (demo)";
const BUCKET = "matter-documents";
const MODULES = ["litigation", "agent-toolkit", "document-center", "mailbox", "agents"];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (lectual-dev).");
  process.exit(1);
}
if (new URL(url).hostname !== `${DEV_REF}.supabase.co`) {
  console.error(`Refusing: ${url} is not lectual-dev (${DEV_REF}). This script only ever seeds dev.`);
  process.exit(1);
}

const args = process.argv.slice(2);
const reset = args.includes("--reset");
const memberIdx = args.indexOf("--member");
const extraMember = memberIdx >= 0 ? args[memberIdx + 1]?.trim().toLowerCase() : undefined;
if (memberIdx >= 0 && !extraMember?.includes("@")) {
  console.error("--member needs an email address.");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

function ok(res: { error: { message: string } | null }, what: string): void {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
}

function must<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data == null) throw new Error(`${what}: no rows returned`);
  return res.data;
}

const DAY = 86_400_000;
const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * DAY).toISOString();
const dateIn = (d: number) => new Date(now + d * DAY).toISOString().slice(0, 10);

async function findUser(email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 1000) return null;
  }
  return null;
}

async function ensureUser(email: string, fullName: string | null): Promise<string> {
  const existing = await findUser(email);
  if (existing) return existing;
  const { data, error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : {},
  });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return data.user.id;
}

// Letters and voice notes both live at {org_id}/{record_id}/{file}.
async function removeStoredFiles(orgId: string) {
  for (const bucket of [BUCKET, "voice-notes"]) {
    const { data: folders } = await db.storage.from(bucket).list(orgId, { limit: 1000 });
    for (const folder of folders ?? []) {
      const { data: inner } = await db.storage.from(bucket).list(`${orgId}/${folder.name}`, { limit: 1000 });
      const paths = (inner ?? []).map((f) => `${orgId}/${folder.name}/${f.name}`);
      if (paths.length) await db.storage.from(bucket).remove(paths);
    }
  }
}

async function removeDemoFirm(orgId: string) {
  await removeStoredFiles(orgId);
  ok(await db.from("crm_org").delete().eq("id", orgId), "delete demo org");
}

async function letterDocx(title: string, lines: string[]): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 28 })] }),
          new Paragraph({ children: [new TextRun({ text: "DEMO DOCUMENT — fictional client, not legal advice.", italics: true })] }),
          ...lines.map((l) => new Paragraph(l)),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

async function main() {
  const lookup = await db.from("crm_org").select("id").eq("slug", SLUG).maybeSingle();
  if (lookup.error) throw new Error(`look up demo org: ${lookup.error.message}`);
  const existing = lookup.data;
  if (existing && !reset) {
    console.log(`${NAME} already exists (${existing.id}). Re-run with --reset to seed it again.`);
    if (extraMember) {
      const uid = await ensureUser(extraMember, null);
      ok(await db.from("crm_org_member").upsert({ org_id: existing.id, user_id: uid, role: "owner" }, { onConflict: "org_id,user_id" }), "add member");
      console.log(`Added ${extraMember} as an owner.`);
    }
    return;
  }
  if (existing) {
    await removeDemoFirm(existing.id);
    console.log("Removed the previous demo firm.");
  }

  // ── Firm, people, modules, profile ─────────────────────────────────────────
  const ownerId = await ensureUser("avery@hartwell-ip.test", "Avery Hartwell");
  const orgId = must(
    await db.rpc("provision_org_for_owner", { p_name: NAME, p_slug: SLUG, p_owner_user_id: ownerId }),
    "provision_org_for_owner",
  ) as unknown as string;
  const team: Array<[string, string, string]> = [
    ["sam@hartwell-ip.test", "Sam Okafor", "attorney"],
    ["jordan@hartwell-ip.test", "Jordan Reyes", "paralegal"],
    ["priya@hartwell-ip.test", "Priya Nand", "intake"],
  ];
  const ids: Record<string, string> = { owner: ownerId };
  for (const [email, fullName, role] of team) {
    const uid = await ensureUser(email, fullName);
    ids[role] = uid;
    ok(await db.from("crm_org_member").insert({ org_id: orgId, user_id: uid, role }), `member ${email}`);
  }
  if (extraMember) {
    const uid = await ensureUser(extraMember, null);
    ok(await db.from("crm_org_member").insert({ org_id: orgId, user_id: uid, role: "owner" }), "add --member");
  }
  ok(await db.from("crm_org").update({ modules: MODULES }).eq("id", orgId), "set modules");
  ok(
    await db.from("crm_org_profile").upsert({
      org_id: orgId,
      display_name: "Hartwell IP",
      time_zone: "America/Chicago",
      email_signature: "Warmly,\nAvery Hartwell\nHartwell IP (demo firm)",
      updated_by: ownerId,
    }),
    "profile",
  );

  // ── Intake stages and tags (created by provisioning) ───────────────────────
  const stages = must(await db.from("crm_stage").select("id, name, order_index, category").eq("org_id", orgId).order("order_index"), "stages");
  const stage = (i: number) => stages[Math.min(i, stages.length - 1)]!.id;
  const tags = must(await db.from("crm_tag").select("id, code, dimension").eq("org_id", orgId), "tags");

  // ── Leads ──────────────────────────────────────────────────────────────────
  type LeadSeed = {
    first: string; last: string; business: string | null; mark: string | null; area: string;
    stage: number; temp: "hot" | "warm" | "cold"; urgency: string; value: string; age: number;
    summary: string; source: string;
  };
  const leadSeeds: LeadSeed[] = [
    { first: "Maya", last: "Lindqvist", business: "Fjord & Fern Candle Co.", mark: "FJORD & FERN", area: "trademark", stage: 0, temp: "hot", urgency: "3d", value: "MID", age: 1, summary: "Candle brand launching in two retail chains next month; wants to file before the launch.", source: "Website assessment" },
    { first: "Diego", last: "Marchetti", business: "Brasa Bros. Food Truck", mark: "BRASA BROS", area: "trademark", stage: 0, temp: "warm", urgency: "7d", value: "LOW", age: 2, summary: "Food truck expanding to a second city; saw a similar name on Instagram.", source: "Referral" },
    { first: "Keisha", last: "Adeyemi", business: "Northlight Analytics", mark: "NORTHLIGHT", area: "trademark", stage: 1, temp: "hot", urgency: "5d", value: "HIGH", age: 4, summary: "B2B SaaS rebrand; three classes likely (9, 35, 42). Board wants clearance first.", source: "Website assessment" },
    { first: "Tomás", last: "Varga", business: "Varga Ceramics", mark: null, area: "copyright", stage: 1, temp: "warm", urgency: "14d", value: "LOW", age: 6, summary: "Sculptor asking about registering a series of glaze designs.", source: "Workshop" },
    { first: "Hannah", last: "Brooks", business: "Little Tern Books", mark: "LITTLE TERN", area: "trademark", stage: 2, temp: "warm", urgency: "7d", value: "MID", age: 9, summary: "Children's publisher; imprint name plus a character name.", source: "Referral" },
    { first: "Omar", last: "Haddad", business: "Cedar Line Logistics", mark: "CEDAR LINE", area: "trademark", stage: 2, temp: "cold", urgency: "none", value: "MID", age: 15, summary: "Freight broker; paused while they finalize the name.", source: "Website assessment" },
    { first: "Grace", last: "Whitfield", business: "Whitfield Botanicals", mark: "HEDGEROW", area: "trademark", stage: 3, temp: "hot", urgency: "2d", value: "HIGH", age: 11, summary: "Skincare line got a cease-and-desist over HEDGEROW; consult booked.", source: "Referral" },
    { first: "Ravi", last: "Menon", business: "Pocket Orbit Games", mark: "POCKET ORBIT", area: "trademark", stage: 3, temp: "warm", urgency: "7d", value: "MID", age: 13, summary: "Indie game studio; app store listing going live in six weeks.", source: "Conference" },
    { first: "Lena", last: "Schultz", business: null, mark: null, area: "copyright", stage: 5, temp: "cold", urgency: "none", value: "UNKNOWN", age: 30, summary: "Photographer; decided to wait until next year.", source: "Website assessment" },
    { first: "Marcus", last: "Bell", business: "Bellwether Coffee", mark: "BELLWETHER", area: "trademark", stage: 4, temp: "warm", urgency: "none", value: "MID", age: 21, summary: "Signed engagement; matter opened.", source: "Referral" },
  ];
  const leads = must(
    await db
      .from("crm_lead")
      .insert(
        leadSeeds.map((l) => ({
          org_id: orgId,
          first_name: l.first,
          last_name: l.last,
          email: `${l.first}.${l.last}`.toLowerCase().replace(/[^a-z.]/g, "") + "@example.com",
          business_name: l.business,
          mark_text: l.mark,
          practice_area: l.area,
          current_stage_id: stage(l.stage),
          stage_entered_at: daysAgo(Math.max(0, l.age - 1)),
          temperature: l.temp,
          urgency_band: l.urgency,
          value_band: l.value,
          ai_summary: l.summary,
          ai_red_flags: l.first === "Grace" ? ["Cease-and-desist received"] : [],
          referral_source: l.source,
          assigned_to: l.stage >= 3 ? ids.attorney : ids.intake,
          created_at: daysAgo(l.age),
          last_activity_at: daysAgo(Math.max(0, l.age - 2)),
        })),
      )
      .select("id, first_name, last_name"),
    "leads",
  );
  const leadId = (first: string) => leads.find((l) => l.first_name === first)!.id;

  const tagFor = (dim: string) => tags.find((t) => t.dimension === dim)?.id;
  const leadTags = [
    ["Maya", tagFor("PA")], ["Keisha", tagFor("PA")], ["Keisha", tagFor("VAL")],
    ["Grace", tagFor("URG")], ["Grace", tagFor("PA")], ["Ravi", tagFor("SRC")],
  ].filter((t): t is [string, string] => Boolean(t[1]));
  if (leadTags.length) {
    ok(
      await db.from("crm_lead_tag").insert(
        leadTags.map(([first, tagId]) => ({ org_id: orgId, lead_id: leadId(first), tag_id: tagId, source: "human", applied_by: ids.intake })),
      ),
      "lead tags",
    );
  }

  // ── Docket stages ──────────────────────────────────────────────────────────
  const docket = [
    { code: "INTAKE", label: "Engagement signed", order_index: 10, phase: "pipeline", waiting_on: "firm" },
    { code: "SEARCH", label: "Clearance search", order_index: 20, phase: "pre_filing", waiting_on: "firm" },
    { code: "CLIENT", label: "Waiting on client info", order_index: 30, phase: "pre_filing", waiting_on: "client" },
    { code: "FILED", label: "Filed — awaiting examination", order_index: 40, phase: "post_filing", waiting_on: "uspto" },
    { code: "OA", label: "Office action response", order_index: 50, phase: "post_filing", waiting_on: "firm" },
    { code: "PUB", label: "Published for opposition", order_index: 60, phase: "post_filing", waiting_on: "uspto" },
    { code: "REG", label: "Registered", order_index: 70, phase: "maintenance", waiting_on: "uspto" },
    { code: "LIT", label: "Active case", order_index: 80, phase: "post_filing", waiting_on: "court" },
    { code: "CLOSED", label: "Closed", order_index: 90, phase: "inactive", waiting_on: "firm", is_open: false },
  ];
  const docketRows = must(
    await db.from("crm_matter_stage").insert(docket.map((d) => ({ is_open: true, ...d, org_id: orgId }))).select("id, code"),
    "matter stages",
  );
  const docketId = (code: string) => docketRows.find((d) => d.code === code)!.id;

  // ── Contacts and matters ───────────────────────────────────────────────────
  type MatterSeed = {
    n: number; title: string; type: "TM" | "LIT"; mark?: string; stageCode: string; client: [string, string, string];
    serial?: string; filed?: number; basis?: string; classes?: number[]; goods?: string; uspto?: string; age: number; lead?: string;
  };
  const matterSeeds: MatterSeed[] = [
    { n: 1, title: "BELLWETHER — word mark", type: "TM", mark: "BELLWETHER", stageCode: "SEARCH", client: ["Marcus", "Bell", "Bellwether Coffee"], classes: [30, 43], goods: "Coffee; coffee beans; café services", age: 18, lead: "Marcus" },
    { n: 2, title: "SALT & SPARROW — word mark", type: "TM", mark: "SALT & SPARROW", stageCode: "CLIENT", client: ["Ines", "Moreau", "Salt & Sparrow Bakery"], classes: [30], goods: "Bread; pastries; cakes", age: 40 },
    { n: 3, title: "QUIETWAVE — word mark", type: "TM", mark: "QUIETWAVE", stageCode: "FILED", client: ["Arjun", "Patel", "Quietwave Audio LLC"], serial: "99412871", filed: 70, basis: "1b", classes: [9], goods: "Noise-cancelling headphones; earbuds", uspto: "New application — awaiting examination", age: 80 },
    { n: 4, title: "TIDEPOOL KIDS — word mark", type: "TM", mark: "TIDEPOOL KIDS", stageCode: "OA", client: ["Beth", "Nakamura", "Tidepool Kids Inc."], serial: "99187342", filed: 190, basis: "1a", classes: [25, 28], goods: "Children's clothing; toys", uspto: "Non-final office action issued", age: 200 },
    { n: 5, title: "IRONLEAF — word mark", type: "TM", mark: "IRONLEAF", stageCode: "PUB", client: ["Victor", "Olsen", "Ironleaf Outdoor Co."], serial: "98876105", filed: 260, basis: "1a", classes: [18, 25], goods: "Backpacks; outdoor apparel", uspto: "Published for opposition", age: 280 },
    { n: 6, title: "LUMEN & LOOM — word mark", type: "TM", mark: "LUMEN & LOOM", stageCode: "REG", client: ["Clara", "Duarte", "Lumen & Loom Studio"], serial: "98123456", filed: 420, basis: "1a", classes: [24], goods: "Textiles; throws; table linens", uspto: "Registered", age: 450 },
    { n: 7, title: "BRIGHTPATH — statement of use", type: "TM", mark: "BRIGHTPATH", stageCode: "PUB", client: ["Noah", "Fischer", "Brightpath Tutoring"], serial: "98654321", filed: 330, basis: "1b", classes: [41], goods: "Tutoring services", uspto: "Notice of allowance issued", age: 340 },
    { n: 8, title: "Kessler Supply v. Fern Hollow Goods", type: "LIT", stageCode: "LIT", client: ["Dana", "Kessler", "Kessler Supply Co."], age: 60 },
  ];

  const contacts = must(
    await db
      .from("crm_contact")
      .insert(
        matterSeeds.map((m) => ({
          org_id: orgId,
          first_name: m.client[0],
          last_name: m.client[1],
          business_name: m.client[2],
          email: `${m.client[0]}.${m.client[1]}`.toLowerCase() + "@example.com",
        })),
      )
      .select("id, first_name"),
    "contacts",
  );

  // The app's own scheme (src/lib/matters/numbering.ts): TYPE-YEAR-NNNN, one
  // sequence per type, so a matter the firm opens next continues the demo's.
  const seqByType = new Map<string, number>();
  const matterNo = new Map<number, string>();
  for (const m of matterSeeds) {
    const next = (seqByType.get(m.type) ?? 0) + 1;
    seqByType.set(m.type, next);
    matterNo.set(m.n, `${m.type}-2026-${String(next).padStart(4, "0")}`);
  }

  const matters = must(
    await db
      .from("crm_matter")
      .insert(
        matterSeeds.map((m) => ({
          org_id: orgId,
          matter_number: matterNo.get(m.n)!,
          title: m.title,
          type: m.type,
          status: "open",
          mark_text: m.mark ?? null,
          serial_number: m.serial ?? null,
          filing_basis: m.basis ?? null,
          filing_date: m.filed ? dateIn(-m.filed) : null,
          international_classes: m.classes ?? null,
          goods_services: m.goods ?? null,
          uspto_status: m.uspto ?? null,
          uspto_status_as_of: m.uspto ? dateIn(-3) : null,
          registration_number: m.stageCode === "REG" ? "7412098" : null,
          registration_date: m.stageCode === "REG" ? dateIn(-30) : null,
          owner_name: m.client[2],
          stage_id: docketId(m.stageCode),
          stage_entered_at: daysAgo(Math.min(m.age, 2 + m.n * 5)),
          assigned_to: m.type === "LIT" ? ids.attorney : m.n % 2 ? ids.attorney : ids.paralegal,
          lead_id: m.lead ? leadId(m.lead) : null,
          opened_at: daysAgo(m.age),
          created_at: daysAgo(m.age),
        })),
      )
      .select("id, matter_number"),
    "matters",
  );
  const matterId = (n: number) => matters.find((m) => m.matter_number.endsWith(String(n).padStart(3, "0")))!.id;

  ok(
    await db.from("crm_matter_contact").insert(
      matterSeeds.map((m, i) => ({ org_id: orgId, matter_id: matterId(m.n), contact_id: contacts[i]!.id, role: "client" })),
    ),
    "matter contacts",
  );

  ok(
    await db.from("crm_litigation_detail").insert({
      org_id: orgId,
      matter_id: matterId(8),
      case_number: "2026-CA-004417",
      case_style: "Kessler Supply Co. v. Fern Hollow Goods LLC",
      county: "Travis",
      court_division: "Civil — Division 3",
      judge: "Hon. R. Alvarez",
      role: "Plaintiff",
      filed_on: dateIn(-55),
      case_status: "Discovery",
      next_hearing_at: new Date(now + 9 * DAY).toISOString().slice(0, 10) + "T15:30:00Z",
      next_hearing_purpose: "Case management conference",
      notice_of_appearance: "Filed",
      notes: "Trade dress dispute over packaging. Demo data.",
    }),
    "litigation detail",
  );

  ok(
    await db.from("crm_matter_deadline").insert(
      [
      { org_id: orgId, matter_id: matterId(4), kind: "office_action_response", title: "Respond to non-final office action", due_date: dateIn(12), anchor_event: "Office action issued", anchor_date: dateIn(-78), source: "calculated", created_by: ids.paralegal },
      { org_id: orgId, matter_id: matterId(7), kind: "statement_of_use", title: "File statement of use", due_date: dateIn(38), anchor_event: "Notice of allowance", anchor_date: dateIn(-142), source: "calculated", is_extendable: true, max_extensions: 5, extensions_used: 0, created_by: ids.paralegal },
      { org_id: orgId, matter_id: matterId(5), kind: "opposition_window", title: "Opposition period closes", due_date: dateIn(4), source: "official_notice", created_by: ids.paralegal },
      { org_id: orgId, matter_id: matterId(8), kind: "hearing", title: "Case management conference", due_date: dateIn(9), source: "manual", created_by: ids.attorney },
      { org_id: orgId, matter_id: matterId(6), kind: "section_8_declaration", title: "Section 8 declaration window opens", due_date: dateIn(1795), source: "calculated", created_by: ids.paralegal },
      ].map((d) => ({ is_extendable: false, extensions_used: 0, max_extensions: 0, ...d })),
    ),
    "deadlines",
  );

  // ── Timeline ───────────────────────────────────────────────────────────────
  const act = (row: Record<string, unknown>) => ({ org_id: orgId, actor_type: "user", ...row });
  ok(
    await db.from("crm_activity").insert([
      ...leads.map((l, i) => act({ lead_id: l.id, type: "lead_created", actor_type: "system", payload: { source: leadSeeds[i]!.source }, created_at: daysAgo(leadSeeds[i]!.age) })),
      act({ lead_id: leadId("Grace"), type: "email_received", actor_type: "system", payload: { from: "grace.whitfield@example.com", subject: "Re: the cease-and-desist letter" }, created_at: daysAgo(1) }),
      act({ lead_id: leadId("Grace"), type: "note", actor_id: ids.attorney, payload: { note: "Letter claims likelihood of confusion with HEDGEROW FARMS (Cl. 3). Their reg covers soap only; worth a coexistence approach." }, created_at: daysAgo(2) }),
      act({ lead_id: leadId("Keisha"), type: "call_logged", actor_id: ids.intake, payload: { summary: "Discovery call: rebrand ships in Q1; needs clearance across 9/35/42." }, created_at: daysAgo(3) }),
      act({ lead_id: leadId("Maya"), type: "email_received", actor_type: "system", payload: { from: "maya.lindqvist@example.com", subject: "Retail launch dates" }, created_at: daysAgo(0.2) }),
      act({ lead_id: leadId("Ravi"), type: "ai_insight", actor_type: "ai", payload: { source: "intake-triage", lane: "consult", reason: "Clear mark, launch date set, budget confirmed." }, created_at: daysAgo(12) }),
      ...matterSeeds.map((m) => act({ matter_id: matterId(m.n), type: "matter_opened", actor_id: ids.owner, payload: { matter_number: matterNo.get(m.n)! }, created_at: daysAgo(m.age) })),
      act({ matter_id: matterId(4), type: "note", actor_id: ids.paralegal, payload: { note: "Examiner cites a 2(d) refusal against TIDE POOL (Cl. 25). Drafted arguments; client reviewing specimen." }, created_at: daysAgo(5) }),
      act({ matter_id: matterId(4), type: "matter_updated", actor_id: ids.paralegal, payload: { change: "deadline_docketed", kind: "office_action_response", due_date: dateIn(12) }, created_at: daysAgo(70) }),
      act({ matter_id: matterId(2), type: "email_sent", actor_id: ids.paralegal, payload: { subject: "Questionnaire: a few details before we file" }, created_at: daysAgo(6) }),
      act({ matter_id: matterId(8), type: "matter_updated", actor_id: ids.attorney, payload: { change: "litigation_detail", fields: ["case_status", "next_hearing_at"] }, created_at: daysAgo(4) }),
    ]),
    "activity",
  );

  ok(
    await db.from("crm_task").insert([
      { org_id: orgId, matter_id: matterId(4), assignee_id: ids.attorney, type: "review", title: "Review office action response draft", due_at: daysAgo(-1), status: "open" },
      { org_id: orgId, lead_id: leadId("Grace"), assignee_id: ids.attorney, type: "call", title: "Consult: Whitfield cease-and-desist", due_at: daysAgo(-0.3), status: "open" },
      { org_id: orgId, matter_id: matterId(2), assignee_id: ids.paralegal, type: "email", title: "Chase Salt & Sparrow questionnaire", due_at: daysAgo(1), status: "open" },
      { org_id: orgId, lead_id: leadId("Maya"), assignee_id: ids.intake, type: "call", title: "Book discovery call with Maya Lindqvist", due_at: daysAgo(-0.5), status: "open" },
    ]),
    "tasks",
  );

  // ── Consults and meetings (crm_calendar_event, normally synced from Lawmatics)
  const at = (days: number, hourUtc: number, minute = 0) => {
    const d = new Date(now + days * DAY);
    d.setUTCHours(hourUtc, minute, 0, 0);
    return d.toISOString();
  };
  ok(
    await db.from("crm_calendar_event").insert([
      { org_id: orgId, title: "Strategy session — Grace Whitfield", starts_at: at(1, 15), ends_at: at(1, 16), event_type: "Strategy Session", contact_name: "Grace Whitfield", location: "Zoom" },
      { org_id: orgId, title: "Discovery call — Keisha Adeyemi", starts_at: at(2, 19, 30), ends_at: at(2, 20), event_type: "Discovery Call", contact_name: "Keisha Adeyemi" },
      { org_id: orgId, title: "Discovery call — Maya Lindqvist", starts_at: at(0, 21), ends_at: at(0, 21, 30), event_type: "Discovery Call", contact_name: "Maya Lindqvist" },
      { org_id: orgId, title: "Client check-in — Tidepool Kids", starts_at: at(5, 16), ends_at: at(5, 16, 30), event_type: "Meeting", contact_name: "Beth Nakamura", matter_id: matterId(4) },
      { org_id: orgId, title: "Team docket review", starts_at: at(-3, 14), ends_at: at(-3, 15), event_type: "Internal" },
    ].map((e, i) => ({ all_day: false, location: null, matter_id: null, lawmatics_id: `demo-event-${i + 1}`, synced_at: new Date(now).toISOString(), ...e }))),
    "calendar events",
  );

  // ── Documents: two approved letters with real .docx files ──────────────────
  const letters = [
    { n: 1, type: "loe_trademark_current", file: "Bellwether Coffee — Engagement Letter.docx", title: "Engagement letter — BELLWETHER", body: ["Scope: federal trademark clearance and application for BELLWETHER in Classes 30 and 43.", "Flat fee as quoted. Government filing fees billed at cost."] },
    { n: 4, type: "opinion_letter", file: "Tidepool Kids — Office Action Opinion.docx", title: "Opinion letter — TIDEPOOL KIDS", body: ["Summary of the Section 2(d) refusal and recommended arguments.", "Prepared for attorney review."] },
  ];
  for (const l of letters) {
    const draft = must(
      await db
        .from("crm_document_draft")
        .insert({ org_id: orgId, matter_id: matterId(l.n), doc_type: l.type, status: "failed", error_message: "seeding", payload: { demo: true }, created_by: ids.paralegal })
        .select("id")
        .single(),
      "document draft",
    );
    const path = `${orgId}/${matterId(l.n)}/${draft.id}.docx`;
    const up = await db.storage
      .from(BUCKET)
      .upload(path, await letterDocx(l.title, l.body), { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", upsert: true });
    if (up.error) throw new Error(`upload ${path}: ${up.error.message}`);
    ok(
      await db
        .from("crm_document_draft")
        .update({ status: "generated", error_message: null, storage_path: path, file_name: l.file, generated_at: daysAgo(2) })
        .eq("id", draft.id),
      "mark document generated",
    );
  }

  // ── Public intake form (lectual 0079; dev only until it reaches prod) ─────
  // Built from the Forms page's own defaults and saved "live" only because the
  // same go-live checklist passes, as saveIntakeForm decides it.
  const intakeConfig = defaultIntakeConfig([]);
  intakeConfig.firmName = "Hartwell IP";
  intakeConfig.feesOn = false;
  intakeConfig.knows = "Demo firm. Trademark clearance and filing for small consumer brands; flat fees quoted after a discovery call.";
  intakeConfig.fitText = "US businesses launching or rebranding a consumer product or service who need clearance and a federal filing. Not a fit: patents, disputes outside the US.";
  const checkedIntake = validateIntakeConfig(intakeConfig);
  if (!checkedIntake.ok) throw new Error(`intake config: ${checkedIntake.errors.join(" ")}`);
  const intakeLive = checklistComplete(goLiveChecklist(checkedIntake.config, { receivesReferrals: false, agreementSigned: false }));
  const intakeSlug = slugFromFirmName(NAME);
  const form = must(
    await db
      .from("crm_intake_form")
      .insert({
        org_id: orgId,
        slug: intakeSlug,
        status: intakeLive ? "live" : "draft",
        config: checkedIntake.config,
        allowed_domains: ["www.hartwell-ip.test"],
        published_at: intakeLive ? daysAgo(31) : null,
        created_by: ownerId,
        updated_by: ownerId,
        created_at: daysAgo(31),
      })
      .select("id")
      .single(),
    "intake form",
  );
  const q = checkedIntake.config.questions;

  // Submissions, each filed the way submitPublicIntake files one: the
  // submission row, then a lead in the first open intake stage with
  // referral_source "Intake form", a lead_created and an answers note.
  type SubmissionSeed = {
    name: string; email: string; phone: string; company: string; mode: "form" | "conversation"; age: number;
    answers: string[]; fit: "fit" | "non_fit" | "unscored"; note: string | null;
    status: "new" | "referred" | "consult_booked" | "engaged" | "rejected" | "stopped"; host: string | null;
  };
  const submissionSeeds: SubmissionSeed[] = [
    { name: "Priya Castellanos", email: "priya.castellanos@example.com", phone: "512-555-0142", company: "Juniper Row Tea", mode: "conversation", age: 0.3, answers: ["JUNIPER ROW", "Not yet; launching at a farmers market in March.", "Loose-leaf tea and tea subscriptions"], fit: "fit", note: "US consumer brand, pre-launch, wants a federal filing: matches the firm's stated criteria.", status: "new", host: "www.hartwell-ip.test" },
    { name: "Ben Oduya", email: "ben.oduya@example.com", phone: "", company: "Tallgrass Cycles", mode: "form", age: 3, answers: ["TALLGRASS", "Yes, on our shop sign and website since 2024.", "Bicycle repair and custom frames"], fit: "fit", note: "Trademark, US, existing use in commerce; within the firm's criteria.", status: "consult_booked", host: null },
    { name: "Sofia Lindgren", email: "sofia.lindgren@example.com", phone: "", company: "", mode: "form", age: 6, answers: ["A method for recycling carbon fibre", "Shown at a trade fair last month.", "Industrial recycling"], fit: "non_fit", note: "Describes a process invention (patent), which the firm's criteria list as not a fit.", status: "referred", host: "www.hartwell-ip.test" },
    { name: "Marcus Webb", email: "marcus.webb@example.com", phone: "303-555-0199", company: "Webb & Daughters Hot Sauce", mode: "conversation", age: 12, answers: ["WEBB & DAUGHTERS", "Yes, at local markets.", "Hot sauce and spice rubs"], fit: "fit", note: "US consumer food brand seeking clearance and filing.", status: "engaged", host: null },
    { name: "Ada Nwosu", email: "ada.nwosu@example.com", phone: "", company: "", mode: "conversation", age: 19, answers: ["Something for my podcast, not sure yet", "", ""], fit: "unscored", note: null, status: "stopped", host: null },
  ];
  const intakeStage = stages.filter((s) => s.category === "open").sort((a, b) => a.order_index - b.order_index)[0]?.id ?? null;
  const markQuestion = q[0]!;
  for (const sub of submissionSeeds) {
    const answered = sub.answers
      .map((answer, i) => ({ id: q[i]!.id, question: q[i]!.text, answer }))
      .filter((a) => a.answer);
    const at = daysAgo(sub.age);
    const contact = { name: sub.name, email: sub.email, phone: sub.phone, company: sub.company };
    const row = must(
      await db
        .from("crm_intake_submission")
        .insert({
          org_id: orgId, form_id: form.id, mode: sub.mode, contact, answers: answered, fit: sub.fit,
          screening_note: sub.note, status: sub.status, source_host: sub.host,
          started_at: new Date(Date.parse(at) - 4 * 60_000).toISOString(), submitted_at: at, last_active_at: at, created_at: at,
        })
        .select("id")
        .single(),
      "intake submission",
    );
    if (!intakeStage) continue;
    const [first, ...rest] = sub.name.split(" ");
    const how = sub.mode === "conversation" ? "Chat" : "Form";
    const mark = answered.find((a) => a.id === markQuestion.id)?.answer ?? null;
    const lead = must(
      await db
        .from("crm_lead")
        .insert({
          org_id: orgId, first_name: first!, last_name: rest.join(" "), email: sub.email, phone: sub.phone || null,
          business_name: sub.company || null, practice_area: "Trademark", mark_text: mark,
          referral_source: "Intake form", referral_detail: sub.host ? `${how} on ${sub.host}` : how,
          current_stage_id: intakeStage, stage_entered_at: at, last_activity_at: at, last_inbound_at: at, created_at: at,
        })
        .select("id")
        .single(),
      "intake lead",
    );
    ok(await db.from("crm_intake_submission").update({ lead_id: lead.id }).eq("id", row.id).eq("org_id", orgId), "link intake lead");
    const note = [`Intake form (${how.toLowerCase()}${sub.host ? ` on ${sub.host}` : ""})`, [sub.name, sub.email, sub.phone, sub.company].filter(Boolean).join(" · ")];
    for (const a of answered) note.push("", `Q: ${a.question}`, `A: ${a.answer}`);
    ok(
      await db.from("crm_activity").insert([
        { org_id: orgId, lead_id: lead.id, type: "lead_created", actor_type: "system", payload: { summary: sub.name, email: sub.email, stage_id: intakeStage, source: "Intake form", mode: sub.mode }, created_at: at },
        { org_id: orgId, lead_id: lead.id, type: "note", actor_type: "system", payload: { note: note.join("\n"), source: "intake-form" }, created_at: at },
      ]),
      "intake lead activity",
    );
  }

  // Funnel events for the last 30 days: a few sessions a day that visit and
  // mostly start (chat or form) without finishing, plus one visit → start →
  // complete session per submission above, so "Completed" matches the table.
  // Hashes stand in for the salted session hash (64 hex chars, as 0079
  // allows); no identities.
  const events: Array<{ org_id: string; form_id: string; kind: string; session_hash: string; occurred_at: string }> = [];
  let session = 0;
  const sessionEvents = (t0: number, kinds: string[]) => {
    session++;
    const hash = createHash("sha256").update(`hartwell-demo-session-${session}`).digest("hex");
    kinds.forEach((kind, i) => events.push({ org_id: orgId, form_id: form.id, kind, session_hash: hash, occurred_at: new Date(t0 + i * 3 * 60_000).toISOString() }));
  };
  for (let d = 29; d >= 0; d--) {
    const perDay = 2 + (d % 3);
    for (let i = 0; i < perDay; i++) {
      const t0 = now - d * DAY - (i * 3 + 1) * 3_600_000;
      sessionEvents(t0, (session + 1) % 3 === 0 ? ["visit"] : ["visit", session % 2 ? "start_conversation" : "start_form"]);
    }
  }
  for (const sub of submissionSeeds) {
    sessionEvents(Date.parse(daysAgo(sub.age)) - 6 * 60_000, ["visit", sub.mode === "conversation" ? "start_conversation" : "start_form", "complete"]);
  }
  ok(await db.from("crm_intake_event").insert(events), "intake events");

  // ── Campaign: templates, a sequence with steps, enrollments ───────────────
  // A task step first, so "Run next step" works on a firm with no approval
  // queue connected; the email steps draft into the queue when one is.
  const templates = must(
    await db
      .from("crm_email_template")
      .insert([
        { org_id: orgId, name: "Inquiry follow-up", subject: "Following up on {{business_name}}", body_text: "Hi {{first_name}},\n\nThanks for getting in touch with Hartwell IP. When would suit you for a short discovery call?\n\nHartwell IP (demo firm)", body_html: "", created_by: ownerId },
        { org_id: orgId, name: "Still interested?", subject: "Checking in", body_text: "Hi {{first_name}},\n\nJust checking whether you'd still like to talk. Reply to this email and we'll find a time.\n\nHartwell IP (demo firm)", body_html: "", created_by: ownerId },
      ])
      .select("id, name"),
    "email templates",
  );
  const templateId = (name: string) => templates.find((t) => t.name === name)!.id;
  const sequence = must(
    await db
      .from("crm_drip_sequence")
      .insert({ org_id: orgId, name: "New inquiry follow-up", description: "For intake leads who haven't booked a discovery call.", active: true, created_by: ownerId, created_at: daysAgo(20) })
      .select("id")
      .single(),
    "campaign sequence",
  );
  ok(
    await db.from("crm_drip_step").insert([
      { org_id: orgId, sequence_id: sequence.id, order_index: 0, type: "task", delay_hours: 0, config: { title: "Call to confirm the intake details" } },
      { org_id: orgId, sequence_id: sequence.id, order_index: 1, type: "email", delay_hours: 24, template_id: templateId("Inquiry follow-up"), config: {} },
      { org_id: orgId, sequence_id: sequence.id, order_index: 2, type: "wait", delay_hours: 72, config: {} },
      { org_id: orgId, sequence_id: sequence.id, order_index: 3, type: "email", delay_hours: 0, template_id: templateId("Still interested?"), config: {} },
    ]),
    "campaign steps",
  );
  ok(
    await db.from("crm_drip_enrollment").insert([
      { org_id: orgId, sequence_id: sequence.id, lead_id: leadId("Diego"), status: "active", current_step: 0, enrolled_at: daysAgo(1) },
      { org_id: orgId, sequence_id: sequence.id, lead_id: leadId("Omar"), status: "paused", current_step: 0, enrolled_at: daysAgo(8) },
    ]),
    "campaign enrollments",
  );

  // ── Firm brain: entries, and claims through propose → review ──────────────
  ok(
    await db.from("crm_firm_brain_entry").insert([
      { org_id: orgId, category: "identity", key: "firm-summary", title: "Who we are", body: "Hartwell IP is a (fictional) two-attorney trademark practice for small consumer brands.", created_by: ownerId },
      { org_id: orgId, category: "voice", key: "tone", title: "How we write to clients", body: "Plain English, short paragraphs, no jargon. Sign off with the attorney's first name.", created_by: ownerId },
      { org_id: orgId, category: "pricing", key: "flat-fees", title: "Flat fees only", body: "Every engagement is quoted as a flat fee from the service library. Government fees are billed at cost.", created_by: ownerId },
      { org_id: orgId, category: "engagement_norms", key: "reply-time", title: "Reply time", body: "Every inquiry gets a reply within one business day, even when we're not the right fit.", created_by: ownerId },
    ]),
    "brain entries",
  );
  const claims = must(
    await db
      .from("crm_claim_library")
      .insert([
        { org_id: orgId, claim: "We reply to every inquiry within one business day.", context: "Website and intake closing message", created_by: ids.intake, status: "proposed" },
        { org_id: orgId, claim: "Flat-fee pricing, quoted before any work starts.", context: "Proposals", created_by: ids.intake, status: "proposed" },
        { org_id: orgId, claim: "We guarantee your trademark will be registered.", context: "Suggested for ads", created_by: ids.intake, status: "proposed" },
        { org_id: orgId, claim: "Our attorneys have filed hundreds of applications.", context: "Website draft", created_by: ids.intake, status: "proposed" },
      ])
      .select("id, claim"),
    "brain claims",
  );
  const reviews: Array<[number, "approved" | "forbidden", string]> = [
    [0, "approved", ""],
    [1, "approved", ""],
    [2, "forbidden", "No outcome guarantees, ever."],
  ];
  for (const [i, status, notes] of reviews) {
    const reviewedAt = daysAgo(5 - i);
    ok(
      await db.from("crm_claim_library").update({ status, notes, reviewed_by: ids.attorney, reviewed_at: reviewedAt, updated_at: reviewedAt }).eq("id", claims[i]!.id),
      "review claim",
    );
    ok(
      await db.from("crm_claim_review_log").insert({ org_id: orgId, claim_id: claims[i]!.id, status, notes, reviewed_by: ids.attorney, reviewed_at: reviewedAt }),
      "claim review log",
    );
  }

  console.log(
    `Seeded ${NAME} (${orgId}): ${leads.length} leads, ${matters.length} matters, 5 deadlines, 2 letters, ` +
      `intake /i/${intakeSlug} (${intakeLive ? "live" : "draft"}) with ${submissionSeeds.length} submissions and ${events.length} events, ` +
      `1 campaign, 4 brain entries, ${claims.length} claims.`,
  );
  console.log(`Owner login: avery@hartwell-ip.test${extraMember ? `, plus ${extraMember}` : ""}. Modules: ${MODULES.join(", ")}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
