// scripts/seed-demo-firm.mts
//
// Seeds a demo firm, "Hartwell IP (demo)", into lectual-dev so every page of
// the workspace has something to click through: leads across the intake
// stages, trademark and litigation matters on the board, docketed deadlines,
// timeline activity, tasks for Today, and two generated letters on Documents.
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
//   --reset          delete the demo firm (and its stored letters) and seed it again
//   --member <email> also make that existing or new login an owner of the demo firm,
//                    so you can sign in to it with your own magic link
//
// The slug is `hartwell-ip`, which lectual's test teardown spares. Demo logins
// use the reserved `.test` domain (never deliverable); every client name,
// address and mark is fictional.
import { createClient } from "@supabase/supabase-js";
import { Document, Packer, Paragraph, TextRun } from "docx";

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

  const matters = must(
    await db
      .from("crm_matter")
      .insert(
        matterSeeds.map((m) => ({
          org_id: orgId,
          matter_number: `HIP-2026-${String(m.n).padStart(3, "0")}`,
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
      ...matterSeeds.map((m) => act({ matter_id: matterId(m.n), type: "matter_opened", actor_id: ids.owner, payload: { matter_number: `HIP-2026-${String(m.n).padStart(3, "0")}` }, created_at: daysAgo(m.age) })),
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

  console.log(`Seeded ${NAME} (${orgId}): ${leads.length} leads, ${matters.length} matters, 5 deadlines, 2 letters.`);
  console.log(`Owner login: avery@hartwell-ip.test${extraMember ? `, plus ${extraMember}` : ""}. Modules: ${MODULES.join(", ")}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
