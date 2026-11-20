import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Sprint 4: `draftInMyOwnOutlook` (src/lib/mailbox/my-mailbox.ts) drafts only in the clicking person's OWN Outlook, found by
 * their scoped read, never by an id from the browser. Plus the hygiene greps for the sprint's files.
 */

const state = vi.hoisted(() => ({
  rows: [] as { id: string; org_id: string; provider: string; scopes: unknown }[],
  scopedError: null as unknown,
  adminReads: [] as { id: unknown; org: unknown }[],
  create: vi.fn(),
  filters: [] as [string, unknown][],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => {
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => {
        state.filters.push([col, v]);
        return q;
      },
      order: () => q,
      then: (resolve: (v: unknown) => void) => resolve({ data: state.scopedError ? null : state.rows, error: state.scopedError }),
    };
    return { from: () => q, auth: { getUser: async () => ({ data: { user: { id: "user-rayn" } } }) } };
  }),
}));
vi.mock("@/lib/db/admin", () => ({
  getAdminClient: () => {
    const read: { id?: unknown; org?: unknown } = {};
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => {
        if (col === "id") read.id = v;
        if (col === "org_id") read.org = v;
        return q;
      },
      maybeSingle: async () => {
        state.adminReads.push({ id: read.id, org: read.org });
        return { data: { id: read.id, org_id: read.org, provider: "microsoft" } };
      },
    };
    return { from: () => q };
  },
}));
vi.mock("@/lib/mailbox/config", () => ({ rootKeyOrNull: () => Buffer.alloc(32), providerCredentials: () => null }));
vi.mock("@/lib/mailbox/sync", () => ({ freshAccessToken: vi.fn(async () => "token") }));
vi.mock("@/lib/mailbox/drafts", () => ({ createMailboxDraft: (...a: unknown[]) => state.create(...a) }));

const { draftInMyOwnOutlook, myOutlookDraftAccess } = await import("@/lib/mailbox/my-mailbox");
const DRAFT = { to: "ana@example.com", subject: "Published", body: "Hi" };

beforeEach(() => {
  state.rows = [{ id: "conn-rayn", org_id: "org-1", provider: "microsoft", scopes: ["Mail.Read", "Mail.ReadWrite"] }];
  state.scopedError = null;
  state.adminReads = [];
  state.filters = [];
  state.create.mockReset().mockResolvedValue({ id: "AAMk-2", webLink: "https://outlook.office.com/d/2" });
});

describe("Acceptance 7: the caller's own connection, from the scoped read", () => {
  it("drafts with the scoped read's own personal, active connection and the org it returned", async () => {
    expect(await draftInMyOwnOutlook({ draft: DRAFT })).toEqual({ ok: true, id: "AAMk-2", webLink: "https://outlook.office.com/d/2" });
    // N4: the session's own user id is a filter too, beside RLS.
    expect(state.filters).toEqual(expect.arrayContaining([["scope", "personal"], ["status", "active"], ["user_id", "user-rayn"]]));
    expect(state.adminReads).toEqual([{ id: "conn-rayn", org: "org-1" }]);
    expect(state.create).toHaveBeenCalledWith("microsoft", { accessToken: "token", draft: DRAFT });
  });

  it("another person's connection id is refused, never used; nothing is read or drafted", async () => {
    expect(await draftInMyOwnOutlook({ draft: DRAFT, postedConnectionId: "conn-rebecca" })).toEqual({ ok: false, reason: "not-yours" });
    expect(state.adminReads).toEqual([]);
    expect(state.create).not.toHaveBeenCalled();
  });

  it("the caller's own id posted back is fine", async () => {
    expect((await draftInMyOwnOutlook({ draft: DRAFT, postedConnectionId: "conn-rayn" })).ok).toBe(true);
  });

  it("acceptance 9: no Outlook, Gmail only, no draft permission, or an unreadable read: refused, nothing drafted", async () => {
    state.rows = [];
    expect(await draftInMyOwnOutlook({ draft: DRAFT })).toEqual({ ok: false, reason: "no-mailbox" });
    expect(await myOutlookDraftAccess()).toBe("no-mailbox");
    state.rows = [{ id: "g", org_id: "org-1", provider: "google", scopes: [] }];
    expect(await draftInMyOwnOutlook({ draft: DRAFT })).toEqual({ ok: false, reason: "not-outlook" });
    state.rows = [{ id: "conn-rayn", org_id: "org-1", provider: "microsoft", scopes: ["Mail.Read"] }];
    expect(await draftInMyOwnOutlook({ draft: DRAFT })).toEqual({ ok: false, reason: "needs-permission" });
    state.scopedError = { code: "500" };
    expect(await draftInMyOwnOutlook({ draft: DRAFT })).toEqual({ ok: false, reason: "unavailable" });
    expect(await myOutlookDraftAccess()).toBe("unavailable");
    expect(state.create).not.toHaveBeenCalled();
  });

  it("a provider failure is a reason, never the provider's text", async () => {
    state.create.mockRejectedValue(Object.assign(new Error("Graph said: ana@example.com bad"), { code: "fetch-failed" }));
    expect(await draftInMyOwnOutlook({ draft: DRAFT })).toEqual({ ok: false, reason: "failed" });
  });
});

/* ─────────────── hygiene ─────────────── */

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}
const read = (f: string) => readFileSync(f, "utf8");
const SPRINT_FILES = [
  "src/lib/queue/draft-handoff.ts",
  "src/lib/queue/make-draft.ts",
  "src/lib/queue/ready-load.ts",
  "src/lib/queue/drafter-outlook.ts",
  "src/components/queue/MakeDraftCard.tsx",
  "src/components/queue/RetryPassCard.tsx",
];

describe("Acceptance 9 and the sprint's hygiene greps", () => {
  it("outlook-send.ts stays the only file with a send call; no sprint file has a Graph send path", () => {
    const SEND = new RegExp(["send", "Mail"].join("") + "|" + ["Mail", "\\.", "Send"].join("") + "|" + ["/", "send", "\\b"].join("") + "|" + ["\\.", "send", "\\("].join(""), "i");
    for (const f of walk("src")) if (f !== path.join("src/lib/mailbox/outlook-send.ts")) expect(read(f), f).not.toMatch(SEND);
    for (const f of SPRINT_FILES) expect(read(f), f).not.toMatch(/sendCheckedDraft|sendFromMyOutlook|outlook-send/);
  });

  it("no service role in the sprint's files, the Approvals pages or Settings -> Approvals: the only admin read stays inside my-mailbox's token opener", () => {
    for (const f of [...SPRINT_FILES, ...walk("src/app/dashboard/queue"), ...walk("src/app/dashboard/settings/approvals")]) expect(read(f), f).not.toMatch(/getAdminClient|@\/lib\/db\/admin|SERVICE_ROLE/);
    expect(read("src/lib/queue/review-core.ts")).not.toMatch(/getAdminClient|@\/lib\/db\/admin/);
  });

  it("the drafter path writes to no mailbox but the caller's own: make-draft calls only draftInMyOwnOutlook, review-core's pass branch no mailbox at all", () => {
    const make = read("src/lib/queue/make-draft.ts");
    expect(make).toMatch(/draftInMyOwnOutlook\(/);
    expect(make).not.toMatch(/draftInMyMailbox|createMailboxDraft/);
    const core = read("src/lib/queue/review-core.ts");
    // The only mailbox call in the approve core is the approver's own mailbox, and the pass branch never reaches it except before 0112.
    expect(core.match(/draftInMyMailbox\(/g)).toHaveLength(1);
    expect(core).not.toMatch(/draftInMyOwnOutlook|createMailboxDraft/);
  });

  it("every Sprint 4 caller of loadCardState folds with trust", () => {
    for (const f of ["src/lib/queue/make-draft.ts", "src/lib/queue/ready-load.ts", "src/app/dashboard/queue/[id]/page.tsx"]) expect(read(f), f).toMatch(/trustedCardState\(/);
  });
});

describe("Acceptance 10: before lectual 0112 is detected by error code, only for the new kinds", () => {
  it("N2: the code AND the message must name the kind CHECK (23514) or the enum value (22P02); anything else stays a failure", async () => {
    const { isKindNotSetUpError } = await import("@/lib/queue/card-state");
    const check = 'new row for relation "queue_card_event" violates check constraint "queue_card_event_kind_check"';
    expect(isKindNotSetUpError("draft_to", { code: "23514", message: check })).toBe(true);
    expect(isKindNotSetUpError("drafted", { code: "22P02", message: 'invalid input value for enum queue_card_event_kind: "drafted"' })).toBe(true);
    // Code alone is not enough.
    expect(isKindNotSetUpError("draft_to", { code: "23514" })).toBe(false);
    expect(isKindNotSetUpError("drafted", { code: "22P02" })).toBe(false);
    // Another CHECK (0112's own shape check) is a failure, not "not switched on".
    expect(isKindNotSetUpError("draft_to", { code: "23514", message: 'violates check constraint "queue_card_event_draft_shape_check"' })).toBe(false);
    // A 22P02 from a bad uuid is a failure.
    expect(isKindNotSetUpError("draft_to", { code: "22P02", message: 'invalid input syntax for type uuid: "x"' })).toBe(false);
    // The enum message naming the OTHER new kind doesn't count for this one.
    expect(isKindNotSetUpError("draft_to", { code: "22P02", message: 'invalid input value for enum k: "drafted"' })).toBe(false);
    expect(isKindNotSetUpError("draft_to", { code: "42501", message: check })).toBe(false);
    expect(isKindNotSetUpError("handoff", { code: "23514", message: check })).toBe(false);
    expect(isKindNotSetUpError("draft_to", { message: check })).toBe(false);
  });
});
