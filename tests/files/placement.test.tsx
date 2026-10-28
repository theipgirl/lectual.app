import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createFakeDb, type FakeDb, type Row } from "../matters/helpers/fake-db";
import { standardSeed } from "../matters/helpers/seed";
import { FILE_ID, LEAD, ORG, STAFF_ROLES, createStorageStub, fileRow, makeWorld, pathFor, seedTables, type World } from "./helpers";

/**
 * The real lead and matter pages with the real card, the real readers and the real
 * actions, against one in-memory scoped client and a storage stub. Only what is outside
 * this sprint (session, modules, mail, meetings, other cards with hooks) is mocked.
 */

const stub = () => null;
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

const lead = {
  id: LEAD,
  first_name: "Mireille",
  last_name: "Toussaint",
  email: "mireille@example.com",
  phone: null,
  business_name: "Toussaint Studio",
  website: null,
  mark_text: "SANKOFA",
  practice_area: null,
  current_stage_id: "stage-1",
  assigned_to: null,
  referral_source: "Booth",
  referral_detail: "UGW 2026",
  last_inbound_at: null,
  last_outbound_at: null,
  ai_summary: null,
  ai_red_flags: null,
  lane: null,
};

const DAWN = [{ userId: "user-1", email: "dawn@example.com", displayName: "Dawn Reyes", role: "attorney", identified: true }];

function mockCommon(client: unknown, role: string, members: unknown[] | (() => never)) {
  vi.resetModules();
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => client) }));
  vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role })) }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => (typeof members === "function" ? members() : members)) }));
  vi.doMock("@/lib/meetings/read", () => ({ meetingsFor: vi.fn(async () => ({ status: "none" })) }));
  vi.doMock("@/components/meetings/LinkedMeetings", () => ({ LinkedMeetings: stub }));
  vi.doMock("@/components/voice/VoiceNoteRecorder", () => ({ default: stub }));
  vi.doMock("@/lib/voice/notes", async (orig) => ({ ...(await orig<typeof import("@/lib/voice/notes")>()), voiceNotePlaybackUrls: vi.fn(async () => ({})) }));
}

async function leadPage(world: World, opts: { role?: string; members?: unknown[] | (() => never) } = {}) {
  mockCommon(world.client, opts.role ?? "attorney", opts.members ?? DAWN);
  vi.doMock("@/lib/pipeline", async (orig) => ({
    ...(await orig<typeof import("@/lib/pipeline")>()),
    getLead: vi.fn(async () => lead),
    listStages: vi.fn(async () => [{ id: "stage-1", name: "New" }]),
  }));
  vi.doMock("@/lib/pipeline/tags", () => ({ listTags: vi.fn(async () => []), tagsForLead: vi.fn(async () => []) }));
  vi.doMock("@/lib/intake/effective-temperature", () => ({ effectiveTemperature: vi.fn(() => "cold") }));
  vi.doMock("@/lib/intake/facts", () => ({ loadTemperatureFacts: vi.fn(async () => ({ status: "unavailable" })) }));
  vi.doMock("@/lib/agents/proposals", async (orig) => ({ ...(await orig<typeof import("@/lib/agents/proposals")>()), pendingProposals: vi.fn(() => []) }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
  vi.doMock("@/lib/org/profile", () => ({
    getFirmTimeZone: vi.fn(async () => "UTC"),
    getLaneLinks: vi.fn(async () => ({ links: { strategySessionUrl: null, discoveryCallUrl: null, nurtureSequenceId: null }, failed: false })),
  }));
  vi.doMock("@/lib/automation/drips", () => ({ listLeadEnrollments: vi.fn(async () => []) }));
  vi.doMock("@/lib/automation/rules", () => ({ AUTOMATION_STAFF_ROLES: ["attorney", "owner"] }));
  vi.doMock("@/lib/queue/lead-pending", () => ({ loadPendingApprovalsByLead: vi.fn(async () => ({ status: "unavailable" })) }));
  vi.doMock("@/lib/consult-proposal/draft-gate", () => ({ loadDraftBlock: vi.fn(async () => null) }));
  vi.doMock("@/lib/proposals/store", () => ({ listProposals: vi.fn(async () => []) }));
  vi.doMock("@/lib/matters/for-lead", () => ({ loadMattersForLead: vi.fn(async () => ({ status: "none" })) }));
  vi.doMock("@/lib/answers/load-answers", () => ({ loadLeadAnswers: vi.fn(async () => ({ submissions: { status: "skipped" }, booth: { status: "skipped" }, requests: { status: "skipped" } })) }));
  for (const [path, names] of Object.entries({
    "@/components/leads/LeadForms": ["AssignSelect", "EditLeadForm", "NoteComposer", "ProposalCard", "StageSelect"],
    "@/components/leads/LeadExtras": ["LeadTags", "PrepConsult"],
    "@/components/leads/ConsultOutcomeForm": ["ConsultOutcomeForm"],
    "@/components/leads/LeadProposalsCard": ["LeadProposalsCard"],
    "@/components/leads/WaitingOnRebecca": ["WaitingOnRebecca"],
    "@/components/leads/SequencesCard": ["SequencesCard"],
  })) {
    vi.doMock(path, () => Object.fromEntries(names.map((n) => [n, stub])));
  }
  // Markers so the card's position relative to its neighbours can be asserted.
  vi.doMock("@/components/leads/TemperatureCard", () => ({ TemperatureCard: () => <section data-marker="temperature-card">Temperature</section> }));
  vi.doMock("@/components/leads/ConsultDetailsSection", () => ({ ConsultDetailsSection: () => <section data-marker="consult-details">Consult details</section> }));
  vi.doMock("@/components/answers/AnswersCard", () => ({ AnswersCard: () => <section data-marker="answers">Answers</section> }));
  vi.doMock("@/app/dashboard/leads/[id]/actions", () => ({ addVoiceNoteAction: vi.fn() }));
  const { default: LeadPage } = await import("../../src/app/dashboard/leads/[id]/page");
  return text(renderToStaticMarkup(await LeadPage({ params: Promise.resolve({ id: LEAD }) })));
}

const leadWorld = (over: { role?: string; tables?: Record<string, Row[]>; objects?: Record<string, number> } = {}) =>
  makeWorld({ role: over.role ?? "attorney", objects: over.objects, tables: seedTables(over.tables ?? {}) });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("lead page placement", () => {
  it("renders the card in the main column, after the consult material and before the Sequences and Temperature cards (Sprint 33 order)", async () => {
    const html = await leadPage(leadWorld());
    const consult = html.indexOf('data-marker="consult-details"');
    const card = html.indexOf('aria-label="Documents & files"');
    const timeline = html.indexOf(">Timeline<");
    const aside = html.indexOf("<aside");
    expect(consult).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(consult);
    expect(timeline).toBeGreaterThan(-1);
    expect(timeline).toBeLessThan(consult); // the Timeline now comes before the consult material
    expect(aside).toBeGreaterThan(card); // the card is not in the aside
    expect(html.match(/aria-label="Documents & files"/g)).toHaveLength(1);
    expect(html).toContain("Toussaint Studio");
  });

  it("does not read letters for a lead", async () => {
    const world = leadWorld();
    await leadPage(world);
    expect(world.db.froms).toContain("crm_file");
    expect(world.db.froms).not.toContain("crm_document_draft");
  });

  it("shows the not-set-up sentence, not an error, when the table is missing, and keeps the rest of the page", async () => {
    const world = leadWorld();
    world.db.fail("crm_file", "select", { code: "PGRST205", message: "Could not find the table" });
    const html = await leadPage(world);
    expect(html).toContain("File storage isn't set up for this firm yet.");
    expect(html).not.toContain("Files couldn't be loaded");
    expect(html).toContain(">Timeline<");
    expect(html).toContain("Toussaint Studio");
  });

  it("names a failed read on the card and keeps the page", async () => {
    const world = leadWorld();
    world.db.fail("crm_file", "select");
    const html = await leadPage(world);
    expect(html).toContain("Files couldn't be loaded. Refresh to try again.");
    expect(html).not.toContain("Nothing here yet");
    expect(html).not.toContain("boom");
    expect(html).toContain(">Timeline<");
  });

  it("still renders when the member directory cannot be read: entries say 'A teammate'", async () => {
    const world = leadWorld({ tables: { crm_file: [fileRow()] } });
    const html = await leadPage(world, {
      members: () => {
        throw new Error("boom");
      },
    });
    // The page already treats a failed directory as an empty one.
    expect(html).toContain("Signed LOE.pdf");
    expect(html).toContain("A teammate");
  });

  it("shows the uploader's directory name", async () => {
    const html = await leadPage(leadWorld({ tables: { crm_file: [fileRow()] } }));
    expect(html).toContain("84 KB · Dawn Reyes");
  });

  describe("controls by role", () => {
    it.each(STAFF_ROLES)("%s sees the upload control; only the admin tier sees Delete", async (role) => {
      const html = await leadPage(leadWorld({ role, tables: { crm_file: [fileRow()] } }), { role });
      expect(html).toContain('type="file"');
      expect(html.includes(">Delete<")).toBe(["owner", "admin", "senior_admin"].includes(role));
    });

    it.each(["viewer", "social_media"])("%s sees the list and Download but no upload or delete", async (role) => {
      const html = await leadPage(leadWorld({ role, tables: { crm_file: [fileRow()] } }), { role });
      expect(html).toContain("Signed LOE.pdf");
      expect(html).toContain(`href="/dashboard/files/${FILE_ID}/download/"`);
      expect(html).not.toContain('type="file"');
      expect(html).not.toContain(">Delete<");
    });
  });
});

describe("a just-uploaded file, end to end (request, direct upload, confirm, list, delete)", () => {
  it("shows the file in the card and the file_uploaded row in the Timeline, then the file is gone after an admin deletes it", async () => {
    const world = leadWorld({ role: "admin" });
    vi.resetModules();
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => world.client) }));
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    const { requestUploadAction, confirmUploadAction, deleteFileAction } = await import("../../src/app/dashboard/files/actions");

    // 1. request
    const requested = await requestUploadAction({ kind: "lead", id: LEAD }, "Specimen photo.PNG", "", 2_411_724);
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    const path = pathFor("lead", requested.fileId, "png");
    expect(requested.signedUrl).toContain(path);
    expect(requested.mime).toBe("image/png");

    // 2. the browser's direct upload, simulated by adding the object to the storage stub
    world.storage.objects.set(path, 2_411_724);

    // 3. confirm
    expect(await confirmUploadAction({ kind: "lead", id: LEAD }, requested.fileId, "Specimen photo.PNG")).toEqual({ ok: true, fileId: requested.fileId });

    // 4. the real page shows both
    const html = await leadPage(world, { role: "admin" });
    const card = html.slice(html.indexOf('aria-label="Documents & files"'), html.indexOf("<aside"));
    expect(card).toContain("Specimen photo.PNG");
    expect(card).toContain("2.3 MB · Dawn Reyes");
    expect(card).toContain(`href="/dashboard/files/${requested.fileId}/download/"`);
    const timeline = html.slice(html.indexOf('class="lx-timeline"'));
    expect(timeline).toContain("File added: Specimen photo.PNG");
    expect(timeline).toContain("2.3 MB");
    expect(timeline).not.toContain(path);
    expect(timeline).not.toContain(ORG);

    // 5. delete as an admin, then the card no longer lists it
    expect(await deleteFileAction(requested.fileId)).toEqual({ ok: true });
    expect(world.storage.objects.has(path)).toBe(false);
    const after = await leadPage(world, { role: "admin" });
    const afterCard = after.slice(after.indexOf('aria-label="Documents & files"'), after.indexOf("<aside"));
    expect(afterCard).not.toContain("Specimen photo.PNG");
    expect(afterCard).toContain("Nothing here yet");
    // The timeline keeps its record (the activity table is append-only) and still names the file.
    expect(after).toContain("File added: Specimen photo.PNG");
  });
});

// ── the matter page ───────────────────────────────────────────────────────────

const MATTER_ROW = "matter-1";

function matterTables(extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    ...standardSeed(),
    crm_file: [
      fileRow({ id: "file-new", org_id: "org-1", lead_id: null, matter_id: MATTER_ROW, file_name: "Specimen.png", size_bytes: 2_411_724, created_at: "2026-10-20T10:00:00Z", storage_path: "org-1/matter/matter-1/a.png" }),
      fileRow({ id: "file-old", org_id: "org-1", lead_id: null, matter_id: MATTER_ROW, file_name: "Old scan.pdf", created_at: "2026-10-10T10:00:00Z", storage_path: "org-1/matter/matter-1/b.pdf" }),
    ],
    crm_document_draft: [
      { id: "doc-generated", org_id: "org-1", matter_id: MATTER_ROW, doc_type: "loe_general", status: "generated", file_name: "Engagement letter.docx", created_by: "user-1", generated_at: "2026-10-15T10:00:00Z", created_at: "2026-10-14T10:00:00Z" },
      { id: "doc-queued", org_id: "org-1", matter_id: MATTER_ROW, doc_type: "opinion_letter", status: "queued", file_name: "Queued opinion.docx", created_by: "user-1", generated_at: null, created_at: "2026-10-19T10:00:00Z" },
      { id: "doc-failed", org_id: "org-1", matter_id: MATTER_ROW, doc_type: "opinion_letter", status: "failed", file_name: "Failed opinion.docx", created_by: "user-1", generated_at: null, created_at: "2026-10-19T11:00:00Z" },
    ],
    ...extra,
  };
}

async function matterPage(db: FakeDb, opts: { role?: string; documentCenter?: boolean; members?: unknown[] | (() => never) } = {}) {
  const client = { ...db.client(), storage: createStorageStub() };
  mockCommon(client, opts.role ?? "attorney", opts.members ?? DAWN);
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async (m: string) => m === "document-center" && (opts.documentCenter ?? true)) }));
  vi.doMock("@/lib/documents/loe-prefill-load", () => ({ loadSignedQuotesForMatter: vi.fn(async () => ({ status: "ok", quotes: [] })) }));
  vi.doMock("@/lib/intake-forms/requests", () => ({ canSendIntakeRequest: () => false, listMatterIntakeRequests: vi.fn(async () => ({ status: "ok", requests: [], formReady: false })) }));
  vi.doMock("@/lib/intake-forms/origin", () => ({ intakeOrigin: vi.fn(async () => "https://app.example.test") }));
  vi.doMock("@/lib/answers/load-answers", () => ({ loadMatterAnswers: vi.fn(async () => ({ submissions: { status: "skipped" }, booth: { status: "skipped" }, requests: { status: "skipped" } })) }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "UTC") }));
  vi.doMock("@/components/matters/IntakeRequestCard", () => ({ IntakeRequestCard: stub }));
  vi.doMock("@/components/answers/AnswersCard", () => ({ AnswersCard: () => <section data-marker="answers">Answers</section> }));
  const { default: MatterPage } = await import("../../src/app/dashboard/matters/[id]/page");
  return text(renderToStaticMarkup(await MatterPage({ params: Promise.resolve({ id: MATTER_ROW }) })));
}

const matterDb = (tables = matterTables()) => createFakeDb({ role: "attorney", orgId: "org-1", userId: "user-1", tables });

describe("matter page placement", () => {
  it("renders the card in the aside, merging a generated letter with the files by date, and omitting queued and failed letters", async () => {
    const html = await matterPage(matterDb());
    const main = html.slice(0, html.indexOf("<aside"));
    const aside = html.slice(html.indexOf("<aside"));
    expect(main).not.toContain("Documents & files");
    expect(aside).toContain('aria-label="Documents & files"');
    const card = aside.slice(aside.indexOf('aria-label="Documents & files"'), aside.indexOf(">About<"));
    expect(card).toContain("Specimen.png");
    expect(card).toContain("Engagement letter.docx");
    expect(card).toContain("Old scan.pdf");
    // Newest first: file (Oct 20), letter (Oct 15), file (Oct 10).
    expect(card.indexOf("Specimen.png")).toBeLessThan(card.indexOf("Engagement letter.docx"));
    expect(card.indexOf("Engagement letter.docx")).toBeLessThan(card.indexOf("Old scan.pdf"));
    expect(card).toContain('href="/dashboard/documents/doc-generated/download/"');
    expect(card).toContain("Generated letter");
    expect(card).not.toContain("Queued opinion");
    expect(card).not.toContain("Failed opinion");
    expect(card).not.toContain("doc-queued");
    expect(card).toContain('href="/dashboard/files/file-new/download/"');
    expect(aside.indexOf("Documents & files")).toBeLessThan(aside.indexOf(">About<"));
  });

  it("for a firm without Document Center, never reads letters and shows files only", async () => {
    const db = matterDb();
    const html = await matterPage(db, { documentCenter: false });
    expect(db.froms).not.toContain("crm_document_draft");
    expect(html).toContain("Specimen.png");
    expect(html).not.toContain("Engagement letter.docx");
    expect(html).not.toContain("Generated letter");
  });

  it("shows the letters beside a files error, and the files beside a letters error", async () => {
    const a = matterDb();
    a.fail("crm_file", "select");
    const htmlA = await matterPage(a);
    expect(htmlA).toContain("Files couldn't be loaded");
    expect(htmlA).toContain("Engagement letter.docx");
    expect(htmlA).not.toContain("Nothing here yet");

    const b = matterDb();
    b.fail("crm_document_draft", "select");
    const htmlB = await matterPage(b);
    expect(htmlB).toContain("Generated letters couldn't be loaded");
    expect(htmlB).toContain("Specimen.png");
  });

  it("says the uploader is 'A teammate' when the directory could not be read, and still renders", async () => {
    const html = await matterPage(matterDb(), { members: () => { throw new Error("boom"); } });
    expect(html).toContain("A teammate");
    expect(html).toContain("Specimen.png");
  });

  it("a viewer sees the matter's list and Download links but no upload or delete", async () => {
    const html = await matterPage(matterDb(), { role: "viewer" });
    const card = html.slice(html.indexOf('aria-label="Documents & files"'), html.indexOf(">About<"));
    expect(card).toContain("Specimen.png");
    expect(card).toContain(">Download<");
    expect(card).not.toContain('type="file"');
    expect(card).not.toContain(">Delete<");
  });

  it("an admin sees Delete on files but not on the letter", async () => {
    const html = await matterPage(matterDb(), { role: "admin" });
    const card = html.slice(html.indexOf('aria-label="Documents & files"'), html.indexOf(">About<"));
    expect(card.match(/>Delete</g)).toHaveLength(2);
  });

  it("says nothing here yet for a matter with no files and no letters", async () => {
    const html = await matterPage(matterDb(matterTables({ crm_file: [], crm_document_draft: [] })));
    expect(html).toContain("Nothing here yet");
  });
});
