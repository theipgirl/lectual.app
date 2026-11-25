import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rows, members, TODAY } from "./columns-fixtures";
import { mockPage, renderPage } from "./custom-page-harness";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/dashboard/review/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/voice/notes", () => ({ voiceNotePlaybackUrls: async () => ({}) }));

const load = { status: "ok", rows, today: TODAY, timeZone: "America/New_York", members, closeStages: [], failed: [] };
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

beforeEach(() => vi.resetModules());

describe("Add a row at the bottom of the Weekly review List", () => {
  it("a role that can create a lead and open a matter gets both; the matter button is a link to the existing form", async () => {
    mockPage({ load, role: "owner" });
    const html = decode(await renderPage({ view: "sheet" }));
    expect(html).toContain("Add a lead");
    expect(html).toMatch(/<a[^>]*href="\/dashboard\/matters\/#open-matter"[^>]*>Open a matter</);
    // closed until asked: no form, no free-form row
    expect(html).not.toContain('name="firstName"');
  });
  it("a viewer is given neither, and the Board and Cards views have none", async () => {
    mockPage({ load, role: "viewer" });
    const sheet = decode(await renderPage({ view: "sheet" }));
    expect(sheet).not.toContain("Add a lead");
    expect(sheet).not.toContain("Open a matter");
    vi.resetModules();
    mockPage({ load, role: "owner" });
    expect(decode(await renderPage({ view: "board" }))).not.toContain("Open a matter");
  });
  it("the form asks for names and an email (a lead needs one), business optional, and says where the lead goes", async () => {
    const { AddLeadForm } = await import("@/components/review/AddRow");
    const html = decode(renderToStaticMarkup(<AddLeadForm onAnother={() => {}} onCancel={() => {}} />));
    for (const name of ["firstName", "lastName", "email", "businessName"]) expect(html).toContain(`name="${name}"`);
    expect(html).not.toMatch(/name="(currentStageId|assignedTo|org_id|orgId)"/);
    expect(html).toMatch(/name="email"[^>]*required|required=""[^>]*name="email"/);
    expect(html).not.toMatch(/name="businessName"[^>]*required/);
  });
});

describe("addLeadFromReviewAction", () => {
  const h = vi.hoisted(() => ({ role: "paralegal" as string, created: [] as unknown[], fail: null as unknown, stagesFail: false }));
  beforeEach(() => {
    h.role = "paralegal";
    h.created = [];
    h.fail = null;
    h.stagesFail = false;
    vi.doUnmock("@/app/dashboard/review/actions");
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("@/lib/views/preview-safe", () => ({ previewSafe: (fn: unknown) => fn }));
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({}) }));
    // The firm's own stages, as the scoped read returns them (another firm's stage id is simply not in this list).
    vi.doMock("@/lib/pipeline/stages", () => ({
      listStages: async () => {
        if (h.stagesFail) throw new Error("down");
        return [
          { id: "s-new", name: "Potential New Client", category: "open", order_index: 1 },
          { id: "s-consult", name: "Consult Scheduled", category: "open", order_index: 2 },
          { id: "s-won", name: "Signed LOE", category: "won", order_index: 3 },
          { id: "s-lost", name: "Not a fit", category: "lost", order_index: 4 },
          { id: "s-nurture", name: "Nurture", category: "nurture", order_index: 5 },
        ];
      },
    }));
    vi.doMock("@/lib/pipeline", async () => {
      const actual = await vi.importActual<typeof import("@/lib/pipeline/leads")>("@/lib/pipeline/leads");
      return {
        CAN_WRITE_LEAD: actual.CAN_WRITE_LEAD,
        CAN_MOVE_STAGE: actual.CAN_MOVE_STAGE,
        resolveCurrentRole: async () => h.role,
        createLead: async (input: unknown) => {
          h.created.push(input);
          if (h.fail) throw h.fail;
          return { id: "11111111-1111-4111-8111-111111111111" };
        },
        addLeadNote: vi.fn(), assignLead: vi.fn(), moveLeadStage: vi.fn(),
      };
    });
  });
  const form = (over: Record<string, string> = {}) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ firstName: "Ana", lastName: "Lopez", email: "ana@example.com", businessName: "Lopez LLC", currentStageId: "forged", assignedTo: "forged", org_id: "forged", ...over })) fd.set(k, v);
    return fd;
  };

  it("creates a real lead through createLead with the four fields only (never a stage, an owner or an org from the browser)", async () => {
    const { addLeadFromReviewAction } = await import("@/app/dashboard/review/actions");
    expect(await addLeadFromReviewAction({}, form())).toEqual({ saved: true, message: "Lead added.", leadId: "11111111-1111-4111-8111-111111111111", joinsList: false });
    // no stage posted: createLead's own default (the new-enquiry stage); a forged currentStageId field is never read
    expect(h.created).toEqual([{ firstName: "Ana", lastName: "Lopez", email: "ana@example.com", businessName: "Lopez LLC", source: "dashboard" }]);
  });
  it("a role that can't create leads is refused before anything is made", async () => {
    h.role = "viewer";
    const { addLeadFromReviewAction } = await import("@/app/dashboard/review/actions");
    expect(await addLeadFromReviewAction({}, form())).toEqual({ error: "You don't have permission to add leads. Ask an attorney or an admin." });
    expect(h.created).toEqual([]);
  });
  it("bad input is the validation sentence and creates nothing", async () => {
    const { addLeadFromReviewAction } = await import("@/app/dashboard/review/actions");
    expect(await addLeadFromReviewAction({}, form({ email: "nope" }))).toEqual({ error: "Enter a valid email address, e.g. name@firm.com." });
    expect(await addLeadFromReviewAction({}, form({ firstName: "  " }))).toEqual({ error: "First name is required." });
    expect(h.created).toEqual([]);
  });
  it("a failed create is a fixed sentence, never database text", async () => {
    h.fail = new Error('relation "crm_lead" secret');
    const { addLeadFromReviewAction } = await import("@/app/dashboard/review/actions");
    expect(await addLeadFromReviewAction({}, form())).toEqual({ error: "Couldn't add this lead. Nothing was added. Try again." });
    h.fail = { code: "42501", message: "new row violates row-level security policy" };
    expect((await addLeadFromReviewAction({}, form())).error).toBe("You don't have permission to do that — ask an attorney, admin, or intake lead.");
  });

  it("an open stage of this firm is used as the lead's stage; one past first contact joins the List", async () => {
    const { addLeadFromReviewAction } = await import("@/app/dashboard/review/actions");
    expect(await addLeadFromReviewAction({}, form({ stageId: "s-consult" }))).toMatchObject({ saved: true, joinsList: true });
    expect(await addLeadFromReviewAction({}, form({ stageId: "s-new" }))).toMatchObject({ saved: true, joinsList: false });
    expect(h.created).toEqual([
      { firstName: "Ana", lastName: "Lopez", email: "ana@example.com", businessName: "Lopez LLC", currentStageId: "s-consult", source: "dashboard" },
      { firstName: "Ana", lastName: "Lopez", email: "ana@example.com", businessName: "Lopez LLC", currentStageId: "s-new", source: "dashboard" },
    ]);
  });
  it("a foreign, missing, won, lost or nurture stage is refused with a fixed sentence, and nothing is created", async () => {
    const { addLeadFromReviewAction } = await import("@/app/dashboard/review/actions");
    for (const stageId of ["someone-elses-stage", "s-won", "s-lost", "s-nurture"]) expect(await addLeadFromReviewAction({}, form({ stageId })), stageId).toEqual({ error: "That isn't an open stage of your firm. Pick one from the list." });
    expect(h.created).toEqual([]);
  });
  it("the stage list can't be read: a posted stage is refused; none posted still starts in the new-enquiry stage", async () => {
    h.stagesFail = true;
    const { addLeadFromReviewAction } = await import("@/app/dashboard/review/actions");
    expect(await addLeadFromReviewAction({}, form({ stageId: "s-consult" }))).toEqual({ error: "That isn't an open stage of your firm. Pick one from the list." });
    expect(await addLeadFromReviewAction({}, form())).toMatchObject({ saved: true });
    expect(h.created).toHaveLength(1);
    expect((h.created[0] as Record<string, unknown>).currentStageId).toBeUndefined();
  });
});

describe("the Start in picker", () => {
  beforeEach(() => {
    for (const m of ["@/lib/views/preview-safe", "next/cache", "@/lib/db/scoped-client", "@/lib/pipeline"]) vi.doUnmock(m);
  });
  it("lists the stages it is given, starts on the default, and posts only a stage id", async () => {
    const { AddLeadForm } = await import("@/components/review/AddRow");
    const html = decode(renderToStaticMarkup(<AddLeadForm onAnother={() => {}} onCancel={() => {}} stages={[{ id: "s-new", name: "Potential New Client" }, { id: "s-consult", name: "Consult Scheduled" }]} defaultStageId="s-consult" />));
    expect(html).toContain("Start in");
    expect(html).toContain('<select class="lx-input" name="stageId"');
    expect(html).toMatch(/<option value="s-consult" selected/);
    expect(html).not.toContain("start in your new-enquiry stage");
  });
  it("no stage list (it couldn't be read): no select, one quiet sentence", async () => {
    const { AddLeadForm } = await import("@/components/review/AddRow");
    const html = decode(renderToStaticMarkup(<AddLeadForm onAnother={() => {}} onCancel={() => {}} stages={null} />));
    expect(html).not.toContain('name="stageId"');
    expect(html).toContain("Couldn't load your stages, so the lead will start in your new-enquiry stage.");
  });
  it("the page offers only the open stages, the new-enquiry one first selected; a failed read gives no select", async () => {
    mockPage({ load, role: "owner" });
    const html = decode(await renderPage({ view: "sheet" }));
    expect(html).toContain("Add a lead");
    vi.resetModules();
    mockPage({ load, role: "owner", stages: null });
    expect(decode(await renderPage({ view: "sheet" }))).toContain("Add a lead");
  });
});
