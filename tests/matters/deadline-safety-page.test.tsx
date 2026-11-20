import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createFakeDb, type FakeDb } from "./helpers/fake-db";
import { standardSeed } from "./helpers/seed";

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, role: "attorney", rpc: null as null | ((name: string) => unknown) }));
const stub = () => null;
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&apos;", "'").replaceAll("<!-- -->", "");

/** The fake scoped client, with lectual 0110's override function answered by `h.rpc` (absent = the fake's "unknown rpc"). */
function client() {
  const c = h.db.client();
  return {
    ...c,
    rpc: async (name: string) => {
      if (name === "crm_close_matter_with_override" && h.rpc) return h.rpc(name) as never;
      return c.rpc(name);
    },
  };
}

function seedFiled(deadlines: Record<string, unknown>[]) {
  const seed = standardSeed() as Record<string, Record<string, unknown>[]>;
  seed.crm_matter = seed.crm_matter.map((m) => (m.id === "matter-1" ? { ...m, serial_number: "97000001" } : m));
  seed.crm_matter_deadline = deadlines;
  return seed;
}

async function renderPage() {
  vi.resetModules();
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => client()) }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: h.role })) }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
  vi.doMock("@/lib/meetings/read", () => ({ meetingsFor: vi.fn(async () => ({ status: "none" })) }));
  vi.doMock("@/lib/voice/notes", async (orig) => ({ ...(await orig<typeof import("@/lib/voice/notes")>()), voiceNotePlaybackUrls: vi.fn(async () => ({})) }));
  vi.doMock("@/lib/intake-forms/requests", () => ({
    canSendIntakeRequest: () => false,
    listMatterIntakeRequests: vi.fn(async () => ({ status: "ok", requests: [], formReady: false })),
  }));
  vi.doMock("@/lib/intake-forms/origin", () => ({ intakeOrigin: vi.fn(async () => "https://app.example.test") }));
  vi.doMock("@/components/meetings/LinkedMeetings", () => ({ LinkedMeetings: stub }));
  vi.doMock("@/components/voice/VoiceNoteRecorder", () => ({ default: stub }));
  vi.doMock("@/components/matters/IntakeRequestCard", () => ({ IntakeRequestCard: stub }));
  vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
  const page = await import("../../src/app/dashboard/matters/[id]/page");
  return text(renderToStaticMarkup(await page.default({ params: Promise.resolve({ id: "matter-1" }) })));
}

const openOa = { id: "dl-open", org_id: "org-1", matter_id: "matter-1", kind: "office_action_response", title: null, due_date: "2026-12-03", status: "open", source: "manual", attorney_confirmed: false, is_extendable: false, extensions_used: 0, max_extensions: null, calculation_basis: null, notes: null };

beforeEach(() => {
  h.role = "attorney";
  h.rpc = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("AT1 (matter page): a filed TM matter with no open deadline shows 'No open deadline'", () => {
  it("flagged with no deadlines at all", async () => {
    h.db = createFakeDb({ tables: seedFiled([]) });
    expect(await renderPage()).toContain('data-flag="no-open-deadline"');
  });

  it("flagged when its only deadlines are satisfied / waived", async () => {
    h.db = createFakeDb({ tables: seedFiled([{ ...openOa, status: "satisfied" }, { ...openOa, id: "dl-w", status: "waived" }]) });
    const html = await renderPage();
    expect(html).toContain('data-flag="no-open-deadline"');
    expect(html).toContain("No open deadline");
  });

  it("not flagged with an open deadline", async () => {
    h.db = createFakeDb({ tables: seedFiled([openOa]) });
    expect(await renderPage()).not.toContain('data-flag="no-open-deadline"');
  });
});

describe("AT2 (matter page): a failed deadlines read flags nothing and says the deadlines couldn't load", () => {
  it("no flag, and the card says so (the page still renders)", async () => {
    h.db = createFakeDb({ tables: seedFiled([]) });
    h.db.fail("crm_matter_deadline", "select");
    const html = await renderPage();
    expect(html).not.toContain('data-flag="no-open-deadline"');
    expect(html).toContain("Deadlines couldn't load.");
    expect(html).not.toContain("No deadlines yet.");
  });
});

describe("AT5 (matter page): the override is offered only to the override roles", () => {
  it("an attorney (and the owner) sees 'Close with an open deadline'; a paralegal does not", async () => {
    for (const [role, shown] of [["attorney", true], ["owner", true], ["paralegal", false], ["admin", false], ["senior_admin", false], ["viewer", false]] as const) {
      h.db = createFakeDb({ tables: seedFiled([openOa]) });
      h.role = role;
      expect((await renderPage()).includes("data-close-override"), role).toBe(shown);
    }
  });

  it("not offered when no open deadline blocks the close", async () => {
    h.db = createFakeDb({ tables: seedFiled([]) });
    expect(await renderPage()).not.toContain("data-close-override");
  });
});

async function overrideAction(role: string, form: Record<string, string>) {
  vi.resetModules();
  h.db.role = role;
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => client()) }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
  vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
  vi.doMock("next/navigation", () => ({ redirect: vi.fn() }));
  const { closeMatterWithOverrideAction } = await import("../../src/app/dashboard/matters/[id]/actions");
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.set(k, v);
  return closeMatterWithOverrideAction({}, fd);
}

const matterStatus = () => h.db.rows("crm_matter").find((m) => m.id === "matter-1")!.status;
const overrideRows = () => h.db.activity().filter((a) => (a.payload as { change?: string }).change === "close_override");

describe("AT4/AT5: the close guard and the override action (scoped client, before and after 0110)", () => {
  it("AT4: a plain close with an open USPTO deadline is refused and changes nothing", async () => {
    vi.resetModules();
    h.db = createFakeDb({ tables: seedFiled([openOa]) });
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => client()) }));
    vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("next/navigation", () => ({ redirect: vi.fn() }));
    const { updateMatterStatusAction } = await import("../../src/app/dashboard/matters/[id]/actions");
    const fd = new FormData();
    fd.set("matterId", "matter-1");
    fd.set("status", "closed");
    const res = await updateMatterStatusAction({}, fd);
    expect(res.error).toBe("This matter can't be closed while it has an open USPTO deadline: Office Action response (due 2026-12-03). Close the deadline out first, or an attorney can close the matter with a reason.");
    expect(matterStatus()).toBe("open");
  });

  it("AT5: a paralegal posting the override form is refused; nothing is read or written past the role", async () => {
    h.db = createFakeDb({ tables: seedFiled([openOa]) });
    const res = await overrideAction("paralegal", { matterId: "matter-1", reason: "Because", confirm: "yes" });
    expect(res.error).toBe("Only an attorney can close a matter that still has an open USPTO deadline.");
    expect(matterStatus()).toBe("open");
    expect(overrideRows()).toHaveLength(0);
    expect(h.db.froms).not.toContain("crm_matter_deadline");
  });

  it("AT5: the reason is required", async () => {
    h.db = createFakeDb({ tables: seedFiled([openOa]) });
    const res = await overrideAction("attorney", { matterId: "matter-1", reason: "  ", confirm: "yes" });
    expect(res.error).toMatch(/Give a reason/);
    expect(matterStatus()).toBe("open");
  });

  it("AT5 before 0110 (function missing): an attorney closes it, with ONE timeline entry carrying the reason", async () => {
    h.db = createFakeDb({ tables: seedFiled([openOa]) });
    h.rpc = () => ({ data: null, error: { code: "PGRST202", message: "not found" } });
    const res = await overrideAction("attorney", { matterId: "matter-1", reason: "Client abandoned the application", confirm: "yes" });
    expect(res).toEqual({ saved: true });
    expect(matterStatus()).toBe("closed");
    const rows = overrideRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ change: "close_override", reason: "Client abandoned the application", deadline_ids: ["dl-open"], from_status: "open", recorded: "timeline" });
  });

  it("AT5 with 0110: the function closes (and writes the override row); the app adds ONE timeline entry", async () => {
    h.db = createFakeDb({ tables: seedFiled([openOa]) });
    const calls: string[] = [];
    h.rpc = (name) => {
      calls.push(name);
      const m = h.db.rows("crm_matter").find((r) => r.id === "matter-1")!;
      m.status = "closed";
      return { data: null, error: null };
    };
    const res = await overrideAction("owner", { matterId: "matter-1", reason: "Registered elsewhere", confirm: "yes" });
    expect(res).toEqual({ saved: true });
    expect(calls).toEqual(["crm_close_matter_with_override"]);
    expect(overrideRows()).toHaveLength(1);
    expect((overrideRows()[0].payload as { recorded: string }).recorded).toBe("override_row");
  });

  it("the timeline reads the override in words, with the reason", async () => {
    const { describeActivity } = await import("@/components/leads/describe");
    const d = describeActivity({ type: "matter_updated", actor_type: "user", created_at: "2026-11-20T00:00:00Z", payload: { change: "close_override", reason: "Client abandoned the application" } });
    expect(d.title).toBe("Closed with an open deadline (attorney override)");
    expect(d.detail).toBe("Reason: Client abandoned the application");
  });
});
