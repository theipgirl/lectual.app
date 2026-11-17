import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The rename regression (Sprint 10 acceptance test 5): the card's inline name edit goes through the REAL `updateLead`
 * against an in-memory lead row, and the email, phone and website are exactly what they were. The same edit through
 * `editLeadAction` (which posts every editable field) blanks them: that is why `renameLeadAction` exists.
 */
const LEAD = "11111111-1111-4111-8111-111111111111";

const state = vi.hoisted(() => ({
  role: "paralegal" as string,
  row: {} as Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
  logged: [] as unknown[],
  follow: null as null | { status: string; id?: string },
}));

function fakeClient() {
  return {
    rpc: async (fn: string) => ({ data: fn === "current_org_role" ? state.role : null, error: null }),
    from: (table: string) => {
      let patch: Record<string, unknown> | null = null;
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "is", "in", "limit", "order"]) q[k] = () => q;
      q.update = (p: Record<string, unknown>) => {
        patch = p;
        return q;
      };
      const answer = async () => {
        if (table !== "crm_lead") return { data: null, error: null };
        if (patch) {
          state.updates.push(patch);
          Object.assign(state.row, patch);
        }
        return { data: { ...state.row }, error: null };
      };
      q.maybeSingle = answer;
      q.single = answer;
      q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => answer().then(res, rej);
      return q;
    },
  };
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => fakeClient()) }));
vi.mock("@/lib/matters", () => ({ ensureMatterForLead: vi.fn(), logActivitySafe: vi.fn(async (x: unknown) => void state.logged.push(x)) }));
vi.mock("@/lib/leads/live", async (orig) => ({ ...(await orig<typeof import("@/lib/leads/live")>()), resolveLeadId: vi.fn(async (_db: unknown, id: string) => state.follow ?? { status: "ok", id }) }));

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

const ORIGINAL = {
  id: LEAD,
  first_name: "Maya",
  last_name: "Okafor",
  email: "maya@example.com",
  phone: "+14045550100",
  business_name: "Okafor Studio",
  website: "https://okafor.example",
};

beforeEach(() => {
  state.role = "paralegal";
  state.row = { ...ORIGINAL };
  state.updates = [];
  state.logged = [];
  state.follow = null;
});

describe("renameLeadAction: only names and business change", () => {
  it("changes first, last and business; email, phone and website are unchanged", async () => {
    const { renameLeadAction } = await import("@/lib/record-card/actions");
    // A hostile post carrying blank contact fields: they are never read.
    const res = await renameLeadAction({}, fd({ leadId: LEAD, firstName: "Maya-Rose", lastName: "Okafor", businessName: "Okafor & Co", email: "", phone: "", website: "" }));
    expect(res).toEqual({ saved: true });
    expect(state.row).toMatchObject({ first_name: "Maya-Rose", last_name: "Okafor", business_name: "Okafor & Co", email: ORIGINAL.email, phone: ORIGINAL.phone, website: ORIGINAL.website });
    expect(Object.keys(state.updates[0]).sort()).toEqual(["business_name", "first_name", "last_activity_at", "last_name", "updated_at"]);
  });

  it("a business-only edit touches only the business", async () => {
    const { renameLeadAction } = await import("@/lib/record-card/actions");
    expect(await renameLeadAction({}, fd({ leadId: LEAD, businessName: "New Co" }))).toEqual({ saved: true });
    expect(Object.keys(state.updates[0]).sort()).toEqual(["business_name", "last_activity_at", "updated_at"]);
    expect(state.row).toMatchObject({ first_name: "Maya", email: ORIGINAL.email, phone: ORIGINAL.phone, website: ORIGINAL.website });
  });

  it("a blank first name is refused with the field's sentence, and nothing is written", async () => {
    const { renameLeadAction } = await import("@/lib/record-card/actions");
    const res = await renameLeadAction({}, fd({ leadId: LEAD, firstName: "  " }));
    expect(res.error).toBe("Check the highlighted fields.");
    expect(res.fieldErrors?.firstName).toBeTruthy();
    expect(state.updates).toEqual([]);
  });

  it("nothing posted is refused before any write", async () => {
    const { renameLeadAction } = await import("@/lib/record-card/actions");
    expect((await renameLeadAction({}, fd({ leadId: LEAD, email: "x@y.z" }))).error).toBe("Change the name or the business first.");
    expect(state.updates).toEqual([]);
  });

  it("viewer and social media are refused, and nothing is written", async () => {
    const { renameLeadAction } = await import("@/lib/record-card/actions");
    for (const role of ["viewer", "social_media"]) {
      state.role = role;
      expect(await renameLeadAction({}, fd({ leadId: LEAD, firstName: "X" }))).toEqual({ error: "You don't have permission to change this. Ask an attorney or an admin." });
    }
    expect(state.updates).toEqual([]);
    expect(state.row).toEqual(ORIGINAL);
  });

  it("a merged lead's id is refused with the merge sentence: the kept lead's name is never overwritten", async () => {
    const { renameLeadAction } = await import("@/lib/record-card/actions");
    state.follow = { status: "ok", id: "99999999-9999-4999-8999-999999999999" };
    expect(await renameLeadAction({}, fd({ leadId: LEAD, firstName: "Stale" }))).toEqual({ error: "This lead was merged into another lead, so it can't be changed here. Refresh and open the lead it was merged into." });
    state.follow = { status: "unavailable" };
    expect(await renameLeadAction({}, fd({ leadId: LEAD, firstName: "Stale" }))).toEqual({ error: "This lead couldn't be checked just now, so nothing was saved. Refresh and try again." });
    state.follow = { status: "not-found" };
    expect(await renameLeadAction({}, fd({ leadId: LEAD, firstName: "Stale" }))).toEqual({ error: "That record couldn't be found. It may have been removed." });
    expect(state.updates).toEqual([]);
    expect(state.row).toEqual(ORIGINAL);
  });

  it("control characters and bidi overrides are refused with a field sentence, and nothing is written", async () => {
    const { renameLeadAction } = await import("@/lib/record-card/actions");
    for (const bad of ["Maya\u0000", "Ma\nya", "Maya\u007f", "\u202eayaM", "Maya\u2066x\u2069"]) {
      const res = await renameLeadAction({}, fd({ leadId: LEAD, firstName: bad, businessName: "ok" }));
      expect(res).toEqual({ error: "Check the highlighted fields.", fieldErrors: { firstName: "Use letters, numbers and ordinary punctuation only." } });
    }
    const biz = await renameLeadAction({}, fd({ leadId: LEAD, businessName: "Okafor\u202e Co" }));
    expect(biz.fieldErrors).toEqual({ businessName: "Use letters, numbers and ordinary punctuation only." });
    expect(state.updates).toEqual([]);
    // Ordinary accents and punctuation pass.
    expect(await renameLeadAction({}, fd({ leadId: LEAD, firstName: "Zoë-Anne O'Neil" }))).toEqual({ saved: true });
  });

  it("why it exists: the same name edit through editLeadAction blanks the phone and website", async () => {
    const { editLeadAction } = await import("@/app/dashboard/leads/[id]/actions");
    // editLeadAction reads EVERY editable field; an inline edit can only post what it shows.
    await editLeadAction({}, fd({ leadId: LEAD, firstName: "Maya-Rose", lastName: "Okafor", email: ORIGINAL.email }));
    expect(state.row.phone).toBeNull();
    expect(state.row.website).toBeNull();
  });
});
