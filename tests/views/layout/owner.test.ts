import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { isOwner, ownerState } from "@/lib/views/layout/owner";

/** A fake of the scoped client that records the membership read. */
function fakeDb(answer: { data?: unknown; error?: unknown } | (() => never)) {
  const calls: { table: string; select: string; eq: [string, unknown][] }[] = [];
  const db = {
    from(table: string) {
      return {
        select(select: string) {
          const call = { table, select, eq: [] as [string, unknown][] };
          calls.push(call);
          const b = {
            eq: (c: string, v: unknown) => (call.eq.push([c, v]), b),
            maybeSingle: async () => (typeof answer === "function" ? answer() : { data: answer.data ?? null, error: answer.error ?? null }),
          };
          return b;
        },
      };
    },
  };
  return { db, calls };
}
const who = { userId: "u1", orgId: "o1", actingAsStaff: false };

describe("ownerState: the membership ROW, three states", () => {
  it("owner: the caller's own row in the active firm says owner", async () => {
    const { db, calls } = fakeDb({ data: { role: "owner" } });
    expect(await ownerState({ db, ...who })).toBe("owner");
    expect(calls).toEqual([{ table: "crm_org_member", select: "role", eq: [["user_id", "u1"], ["org_id", "o1"]] }]);
  });

  it("not-owner: any other role, or no row at all", async () => {
    for (const role of ["admin", "senior_admin", "attorney", "intake", "paralegal", "law_clerk", "clerk", "viewer", "social_media", "Owner", "", null, 5]) {
      expect(await ownerState({ db: fakeDb({ data: { role } }).db, ...who }), String(role)).toBe("not-owner");
    }
    expect(await ownerState({ db: fakeDb({ data: null }).db, ...who })).toBe("not-owner");
  });

  it("unreadable: an errored read, a throw, or an answer that isn't a row; and unreadable is not owner", async () => {
    expect(await ownerState({ db: fakeDb({ error: { code: "57014" } }).db, ...who })).toBe("unreadable");
    expect(await ownerState({ db: fakeDb(() => { throw new Error("network"); }).db, ...who })).toBe("unreadable");
    expect(await ownerState({ db: fakeDb({ data: [{ role: "owner" }] }).db, ...who })).toBe("unreadable");
    expect(isOwner("unreadable")).toBe(false);
    expect(isOwner("not-owner")).toBe(false);
    expect(isOwner("owner")).toBe(true);
  });

  it("Lectual staff acting inside a firm are never owners, and their membership is not even read (whatever their token claims)", async () => {
    for (const acting of [true, undefined, null, "false", 0] as unknown[]) {
      const { db, calls } = fakeDb({ data: { role: "owner" } });
      expect(await ownerState({ db, ...who, actingAsStaff: acting as boolean }), String(acting)).toBe("not-owner");
      expect(calls).toEqual([]);
    }
  });

  it("no user or no firm: not an owner, nothing read", async () => {
    const { db, calls } = fakeDb({ data: { role: "owner" } });
    expect(await ownerState({ db, userId: null, orgId: "o1", actingAsStaff: false })).toBe("not-owner");
    expect(await ownerState({ db, userId: "u1", orgId: undefined, actingAsStaff: false })).toBe("not-owner");
    expect(calls).toEqual([]);
  });
});

describe("loadIsOwner: the page's call", () => {
  it("reads the session once and the membership through the scoped client; staff and a non-ok session are not owners", async () => {
    vi.resetModules();
    const db = fakeDb({ data: { role: "owner" } });
    vi.doMock("server-only", () => ({}));
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => db.db }));
    const core = { current: { kind: "ok", user: { id: "u1" }, org: { id: "o1" }, actingAsStaff: false } as unknown };
    vi.doMock("@/lib/firm/session", () => ({ loadFirmSessionCore: async () => core.current }));
    const { loadOwnerState } = await import("@/lib/views/layout/owner-load");
    expect(await loadOwnerState()).toBe("owner");
    core.current = { kind: "ok", user: { id: "u1" }, org: { id: "o1" }, actingAsStaff: true };
    expect(await loadOwnerState()).toBe("not-owner");
    core.current = { kind: "signed-out" };
    expect(await loadOwnerState()).toBe("not-owner");
    core.current = { kind: "no-access" };
    expect(await loadOwnerState()).toBe("not-owner");
    vi.doUnmock("@/lib/firm/session");
    vi.doMock("@/lib/firm/session", () => ({ loadFirmSessionCore: async () => { throw new Error("x"); } }));
    vi.resetModules();
    expect(await (await import("@/lib/views/layout/owner-load")).loadOwnerState()).toBe("unreadable");
  });

  it("source: never the role claim, never the service role", () => {
    for (const f of ["owner.ts", "owner-load.ts"]) {
      const src = readFileSync(`src/lib/views/layout/${f}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/db\/admin|getAdminClient|SERVICE_ROLE|active_org_role|app_metadata|\.role\b.*claim/);
    }
  });
});
