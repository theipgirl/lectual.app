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
  insertError: null as unknown,
  eventRows: null as null | Record<string, unknown>[],
  noAttemptColumn: false,
  selects: [] as string[],
  tokenFails: false,
  tokenError: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => {
    let cols = "";
    const q = {
      select: (c: string) => {
        cols = c;
        state.selects.push(c);
        return q;
      },
      eq: (col: string, v: unknown) => {
        state.filters.push([col, v]);
        return q;
      },
      in: () => q,
      order: () => q,
      limit: () => q,
      then: (resolve: (v: unknown) => void) => {
        // recordCardEvent's per-call probe for 0112's attempt column.
        if (cols === "attempt") return resolve(state.noAttemptColumn ? { data: null, error: { code: "42703", message: "column queue_card_event.attempt does not exist" } } : { data: [], error: null });
        if (state.eventRows) {
          if (state.noAttemptColumn && /\battempt\b/.test(cols)) return resolve({ data: null, error: { code: "42703", message: "column queue_card_event.attempt does not exist" } });
          return resolve({ data: state.eventRows, error: null });
        }
        return resolve({ data: state.scopedError ? null : state.rows, error: state.scopedError });
      },
    };
    const table = { ...q, insert: async () => ({ error: state.insertError }) };
    return { from: () => table, auth: { getUser: async () => ({ data: { user: { id: "user-rayn" } } }) } };
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
vi.mock("@/lib/mailbox/sync", () => ({
  freshAccessToken: vi.fn(async () => {
    if (state.tokenError) throw state.tokenError;
    if (state.tokenFails) throw Object.assign(new Error("refresh refused"), { code: "reauth" });
    return "token";
  }),
}));
vi.mock("@/lib/mailbox/drafts", () => ({ createMailboxDraft: (...a: unknown[]) => state.create(...a) }));

const { draftInMyOwnOutlook, myOutlookDraftAccess, prepareMyOutlookDraft } = await import("@/lib/mailbox/my-mailbox");
const DRAFT = { to: "ana@example.com", subject: "Published", body: "Hi" };

beforeEach(() => {
  state.rows = [{ id: "conn-rayn", org_id: "org-1", provider: "microsoft", scopes: ["Mail.Read", "Mail.ReadWrite"] }];
  state.scopedError = null;
  state.adminReads = [];
  state.filters = [];
  state.tokenFails = false;
  state.tokenError = null;
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
    // Changed on purpose (final review 1): a failure with no Graph status is "uncertain", never the provider's text.
    state.create.mockRejectedValue(Object.assign(new Error("Graph said: ana@example.com bad"), { code: "fetch-failed" }));
    expect(await draftInMyOwnOutlook({ draft: DRAFT })).toEqual({ ok: false, reason: "uncertain" });
    state.create.mockRejectedValue(Object.assign(new Error("Graph said: ana@example.com bad"), { code: "fetch-failed", httpStatus: 404 }));
    expect(await draftInMyOwnOutlook({ draft: DRAFT })).toEqual({ ok: false, reason: "refused" });
  });
});

describe("approver drafts: prepareMyOutlookDraft (the approve path's one check and token)", () => {
  it("ready: the caller's own row (scoped read, session user), a token now, then exactly ONE Graph POST with it", async () => {
    const prep = await prepareMyOutlookDraft();
    expect(prep.ok).toBe(true);
    expect(state.filters).toEqual(expect.arrayContaining([["scope", "personal"], ["status", "active"], ["user_id", "user-rayn"]]));
    expect(state.adminReads).toEqual([{ id: "conn-rayn", org: "org-1" }]);
    expect(state.create).not.toHaveBeenCalled();
    if (!prep.ok) return;
    expect(await prep.draft(DRAFT)).toEqual({ ok: true, id: "AAMk-2", webLink: "https://outlook.office.com/d/2" });
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.create).toHaveBeenCalledWith("microsoft", { accessToken: "token", draft: DRAFT });
    // A second call never makes a second draft.
    expect(await prep.draft(DRAFT)).toEqual({ ok: false, reason: "refused" });
    expect(state.create).toHaveBeenCalledTimes(1);
  });

  it("not ready: no Outlook, Gmail only, no draft permission, unreadable, or a token refresh that fails; no token read for the first four, nothing drafted", async () => {
    state.rows = [];
    expect(await prepareMyOutlookDraft()).toEqual({ ok: false, reason: "no-mailbox" });
    state.rows = [{ id: "g", org_id: "org-1", provider: "google", scopes: [] }];
    expect(await prepareMyOutlookDraft()).toEqual({ ok: false, reason: "not-outlook" });
    state.rows = [{ id: "conn-rayn", org_id: "org-1", provider: "microsoft", scopes: ["Mail.Read"] }];
    expect(await prepareMyOutlookDraft()).toEqual({ ok: false, reason: "needs-permission" });
    state.scopedError = { code: "500" };
    expect(await prepareMyOutlookDraft()).toEqual({ ok: false, reason: "unavailable" });
    expect(state.adminReads).toEqual([]);
    state.scopedError = null;
    state.rows = [{ id: "conn-rayn", org_id: "org-1", provider: "microsoft", scopes: ["Mail.ReadWrite"] }];
    state.tokenFails = true;
    expect(await prepareMyOutlookDraft()).toEqual({ ok: false, reason: "reauth" });
    expect(state.create).not.toHaveBeenCalled();
  });

  it("only a real reauth asks to reconnect: a token-endpoint 5xx, a network drop or sign-in not switched on is unavailable", async () => {
    for (const err of [
      Object.assign(new Error("x"), { code: "refresh-failed" }),
      new TypeError("fetch failed"),
      Object.assign(new Error("Microsoft sign-in isn't switched on yet."), { code: "refresh-failed" }),
    ]) {
      state.tokenError = err;
      expect(await prepareMyOutlookDraft()).toEqual({ ok: false, reason: "unavailable" });
    }
    state.tokenError = Object.assign(new Error("dead"), { code: "reauth" });
    expect(await prepareMyOutlookDraft()).toEqual({ ok: false, reason: "reauth" });
    expect(state.create).not.toHaveBeenCalled();
  });

  it("a colleague's connection is never used: only the session user's own row is asked for", async () => {
    // The scoped read is filtered on the session's own user id (RLS also hides a colleague's personal row).
    await prepareMyOutlookDraft();
    expect(state.filters).toContainEqual(["user_id", "user-rayn"]);
    expect(state.adminReads.every((r) => r.id === "conn-rayn")).toBe(true);
  });

  it("Graph failures: a 4xx or reauth is definite, a 5xx / no status is uncertain; the provider's text never comes back", async () => {
    state.create.mockRejectedValue(Object.assign(new Error("Graph said: ana@example.com bad"), { code: "fetch-failed", httpStatus: 400 }));
    let prep = await prepareMyOutlookDraft();
    expect(prep.ok && (await prep.draft(DRAFT))).toEqual({ ok: false, reason: "refused" });
    state.create.mockRejectedValue(Object.assign(new Error("x"), { code: "reauth", httpStatus: 401 }));
    prep = await prepareMyOutlookDraft();
    expect(prep.ok && (await prep.draft(DRAFT))).toEqual({ ok: false, reason: "reauth" });
    state.create.mockRejectedValue(Object.assign(new Error("x"), { code: "fetch-failed", httpStatus: 503 }));
    prep = await prepareMyOutlookDraft();
    expect(prep.ok && (await prep.draft(DRAFT))).toEqual({ ok: false, reason: "uncertain" });
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
    // Approver drafts: the only mailbox call in the approve core is the approver's own Outlook, prepared before anything and
    // drafted once; the pass branch never reaches it except before 0112.
    expect(core).not.toMatch(/draftInMyMailbox/);
    expect(core.match(/prepareMyOutlookDraft\(/g)).toHaveLength(1);
    expect(core.match(/ready\.draft\(/g)).toHaveLength(1);
    expect(core).not.toMatch(/draftInMyOwnOutlook|createMailboxDraft/);
  });

  it("every Sprint 4 caller of loadCardState folds with trust", () => {
    for (const f of ["src/lib/queue/make-draft.ts", "src/lib/queue/ready-load.ts", "src/app/dashboard/queue/[id]/page.tsx"]) expect(read(f), f).toMatch(/trustedCardState\(/);
  });
});

describe("Acceptance 10: before lectual 0112 is detected by error code, only for the new kinds", () => {
  it("N2: the code AND the quote-delimited real constraint name (queue_card_event_kind) must be there; anything else stays a failure", async () => {
    const { isKindNotSetUpError } = await import("@/lib/queue/card-state");
    const check = 'new row for relation "queue_card_event" violates check constraint "queue_card_event_kind"';
    expect(isKindNotSetUpError("draft_to", { code: "23514", message: check })).toBe(true);
    expect(isKindNotSetUpError("drafted", { code: "23514", message: check })).toBe(true);
    // Missing code or message is a failure.
    expect(isKindNotSetUpError("draft_to", { code: "23514" })).toBe(false);
    expect(isKindNotSetUpError("draft_to", { message: check })).toBe(false);
    // Unrelated constraints never match, including ones that merely start with the name.
    expect(isKindNotSetUpError("draft_to", { code: "23514", message: 'violates check constraint "queue_card_event_draft_shape_check"' })).toBe(false);
    expect(isKindNotSetUpError("draft_to", { code: "23514", message: 'violates check constraint "queue_card_event_kind_check"' })).toBe(false);
    expect(isKindNotSetUpError("draft_to", { code: "23514", message: 'violates check constraint "queue_card_event_kind_x"' })).toBe(false);
    expect(isKindNotSetUpError("draft_to", { code: "23514", message: "queue_card_event_kind without quotes" })).toBe(false);
    // The enum branch is gone (0103 uses a CHECK): a 22P02 is never "not switched on".
    expect(isKindNotSetUpError("drafted", { code: "22P02", message: 'invalid input value for enum queue_card_event_kind: "drafted"' })).toBe(false);
    expect(isKindNotSetUpError("draft_to", { code: "22P02", message: 'invalid input syntax for type uuid: "x"' })).toBe(false);
    // Other codes, and the OLD kinds, are failures.
    expect(isKindNotSetUpError("draft_to", { code: "42501", message: check })).toBe(false);
    expect(isKindNotSetUpError("handoff", { code: "23514", message: check })).toBe(false);
  });
});

describe("MUST 1: 0103's TWO constraints, with the real Postgres message strings", () => {
  const KIND = 'new row for relation "queue_card_event" violates check constraint "queue_card_event_kind"';
  const SHAPE = 'new row for relation "queue_card_event" violates check constraint "queue_card_event_shape"';

  it("(a)/(c) the kind CHECK and the shape CHECK, quote-delimited as Postgres prints them, both read as before-0112 for the new kinds only", async () => {
    const { isKindNotSetUpError } = await import("@/lib/queue/card-state");
    for (const kind of ["draft_to", "drafting", "drafted", "draft_failed", "pass_failed"] as const) {
      expect(isKindNotSetUpError(kind, { code: "23514", message: KIND }), kind).toBe(true);
      expect(isKindNotSetUpError(kind, { code: "23514", message: SHAPE }), kind).toBe(true);
    }
    for (const kind of ["handoff", "later", "returned"] as const) {
      expect(isKindNotSetUpError(kind, { code: "23514", message: SHAPE }), kind).toBe(false);
    }
    expect(isKindNotSetUpError("draft_to", { code: "23514", message: 'violates check constraint "queue_card_event_shape_v2"' })).toBe(false);
  });

  it("(d) recordCardEvent turns either refusal into not-set-up (the approve path's own-mailbox fallback), and another CHECK into failed", async () => {
    const { recordCardEvent } = await import("@/lib/queue/card-state");
    state.noAttemptColumn = true; // before 0112: the attempt column isn't there
    for (const message of [KIND, SHAPE]) {
      state.insertError = { code: "23514", message };
      expect(await recordCardEvent({ orgId: "o", queueItemId: "q1", kind: "draft_to", targetUserId: "t" })).toEqual({ ok: false, reason: "not-set-up" });
    }
    state.noAttemptColumn = false;
    state.insertError = { code: "23514", message: 'violates check constraint "queue_card_event_draft_shape"' };
    expect(await recordCardEvent({ orgId: "o", queueItemId: "q1", kind: "draft_to", targetUserId: "t" })).toEqual({ ok: false, reason: "failed" });
    state.insertError = { code: "23505", message: "duplicate key" };
    expect(await recordCardEvent({ orgId: "o", queueItemId: "q1", kind: "drafting", attempt: 1 })).toEqual({ ok: false, reason: "conflict" });
    // Before 0112 the attempt column isn't there: read as not switched on for the new kinds only.
    state.insertError = { code: "PGRST204", message: "Could not find the 'attempt' column of 'queue_card_event' in the schema cache" };
    expect(await recordCardEvent({ orgId: "o", queueItemId: "q1", kind: "drafting", attempt: 1 })).toEqual({ ok: false, reason: "not-set-up" });
    state.insertError = { code: "PGRST204", message: "Could not find the 'other' column" };
    expect(await recordCardEvent({ orgId: "o", queueItemId: "q1", kind: "drafting", attempt: 1 })).toEqual({ ok: false, reason: "failed" });
    state.insertError = null;
  });
});

describe("item 5: reading card events before and after 0112's attempt column", () => {
  const row = { queue_item_id: "q1", kind: "handoff", actor_id: "a", target_user_id: "b", until: null, note: "please check", created_at: "2026-11-20T10:00:00Z" };

  it("before 0112 (no attempt column, 42703) the read falls back to 0103's columns: hand-offs keep working, every attempt is null", async () => {
    const { loadCardState } = await import("@/lib/queue/card-state");
    state.eventRows = [row];
    state.noAttemptColumn = true;
    state.selects = [];
    const out = await loadCardState(["q1"]);
    expect(out).toEqual({ status: "ok", events: [{ queueItemId: "q1", kind: "handoff", actorId: "a", targetUserId: "b", until: null, note: "please check", attempt: null, createdAt: "2026-11-20T10:00:00Z" }] });
    expect(state.selects.some((c) => /attempt/.test(c))).toBe(true);
    expect(state.selects[state.selects.length - 1]).not.toMatch(/attempt/);
  });

  it("after 0112 the attempt column is read as a number; a note is never read for it", async () => {
    const { loadCardState } = await import("@/lib/queue/card-state");
    state.eventRows = [{ ...row, kind: "drafting", target_user_id: null, note: "attempt 9", attempt: 2 }];
    state.noAttemptColumn = false;
    const out = await loadCardState(["q1"]);
    expect(out.status === "ok" && out.events[0].attempt).toBe(2);
    state.eventRows = null;
  });
});

describe("Final review 3: after 0112 a kind / shape 23514 is a real error", () => {
  const SHAPE = 'new row for relation "queue_card_event" violates check constraint "queue_card_event_shape"';
  it("not set up only while the attempt column is missing; with the column there it is 'failed' (shows as an error)", async () => {
    const { recordCardEvent } = await import("@/lib/queue/card-state");
    state.insertError = { code: "23514", message: SHAPE };
    state.noAttemptColumn = true;
    expect(await recordCardEvent({ orgId: "o", queueItemId: "q1", kind: "drafting", attempt: 1 })).toEqual({ ok: false, reason: "not-set-up" });
    state.noAttemptColumn = false;
    expect(await recordCardEvent({ orgId: "o", queueItemId: "q1", kind: "drafting", attempt: 1 })).toEqual({ ok: false, reason: "failed" });
    expect(await recordCardEvent({ orgId: "o", queueItemId: "q1", kind: "draft_to", targetUserId: "t" })).toEqual({ ok: false, reason: "failed" });
    state.insertError = null;
  });
});

describe("Final review 1: which Graph failures definitely made no draft", () => {
  it("draftFailureKind: 401 / 403 and other 4xx are definite; 5xx, timeout, network, unreadable reply and unknown are uncertain", async () => {
    const { draftFailureKind } = await import("@/lib/mailbox/draft-outcome");
    expect(draftFailureKind({ code: "reauth", httpStatus: 401 })).toBe("definite");
    expect(draftFailureKind({ code: "reauth", httpStatus: 403 })).toBe("definite");
    for (const status of [400, 404, 413, 429]) expect(draftFailureKind({ code: "fetch-failed", httpStatus: status }), String(status)).toBe("definite");
    for (const status of [500, 502, 503, 504]) expect(draftFailureKind({ code: "fetch-failed", httpStatus: status }), String(status)).toBe("uncertain");
    expect(draftFailureKind(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe("uncertain"); // timeout
    expect(draftFailureKind(new TypeError("fetch failed"))).toBe("uncertain"); // network drop
    expect(draftFailureKind(new SyntaxError("Unexpected end of JSON input"))).toBe("uncertain"); // json() failing after a 201
    expect(draftFailureKind(null)).toBe("uncertain");
    expect(draftFailureKind("x")).toBe("uncertain");
  });

  it("draftInMyOwnOutlook maps them: refused / reauth (definite) vs uncertain", async () => {
    state.create.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "fetch-failed", httpStatus: 400 }));
    expect(await draftInMyOwnOutlook({ draft: DRAFT })).toEqual({ ok: false, reason: "refused" });
    state.create.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "reauth", httpStatus: 401 }));
    expect(await draftInMyOwnOutlook({ draft: DRAFT })).toEqual({ ok: false, reason: "reauth" });
    state.create.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "fetch-failed", httpStatus: 503 }));
    expect(await draftInMyOwnOutlook({ draft: DRAFT })).toEqual({ ok: false, reason: "uncertain" });
    state.create.mockRejectedValueOnce(new SyntaxError("bad json"));
    expect(await draftInMyOwnOutlook({ draft: DRAFT })).toEqual({ ok: false, reason: "uncertain" });
  });
});
