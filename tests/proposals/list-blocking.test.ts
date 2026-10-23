import { describe, it, expect, vi, beforeEach } from "vitest";
import { sevetri } from "./fixture";

/**
 * `listProposals` carries the first approval-blocking message for draft and
 * approved rows (the list shows "Blocked" from it), and nothing for other
 * statuses. The select now names client_email and pay_url, which the validation needs.
 */

const base = {
  family_id: "f",
  version: 1,
  client_name: "Ana",
  title: "Trademark Proposal",
  expires_on: "2026-11-10",
  source: "manual",
  lead_id: null,
  matter_id: null,
  approved_at: null,
  sent_at: null,
  accepted_at: null,
  accepted_snapshot: null,
  updated_at: "2026-10-19T12:00:00Z",
  content: sevetri(),
  client_email: "ana@example.com",
  pay_url: "https://pay.example/x",
};

async function list(rows: unknown[]) {
  const selects: string[] = [];
  const result = { data: rows, error: null };
  const q: Record<string, unknown> = {};
  q.select = (cols: string) => {
    selects.push(cols);
    return q;
  };
  for (const m of ["eq", "order", "limit"]) q[m] = () => q;
  q.then = (f: (v: unknown) => unknown) => Promise.resolve(result).then(f);
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({ from: () => q })) }));
  const { listProposals } = await import("../../src/lib/proposals/store");
  return { items: await listProposals(), selects };
}

describe("listProposals blocking_issue", () => {
  beforeEach(() => vi.resetModules());

  it("is null for a complete draft, and the first error for one missing its pay link or email", async () => {
    const { items } = await list([
      { ...base, id: "ok", status: "draft" },
      { ...base, id: "nopay", status: "draft", family_id: "f2", pay_url: null },
      { ...base, id: "noemail", status: "approved", family_id: "f3", client_email: null },
    ]);
    const by = Object.fromEntries(items.map((i) => [i.id, i.blocking_issue]));
    expect(by.ok).toBeNull();
    expect(by.nopay).toBe("Add the pay link before creating the link.");
    expect(by.noemail).toBe("Add the client's email before creating the link.");
  });

  it("is null for rows that can no longer be approved, whatever they are missing", async () => {
    const { items } = await list(
      (["sent", "accepted", "withdrawn", "superseded"] as const).map((status, i) => ({ ...base, id: status, status, family_id: `f${i}`, pay_url: null, client_email: null })),
    );
    expect(items.map((i) => i.blocking_issue)).toEqual([null, null, null, null]);
  });

  it("does not leak the validation inputs onto the item, and reads the columns they need", async () => {
    const { items, selects } = await list([{ ...base, id: "x", status: "draft" }]);
    expect(items[0]).not.toHaveProperty("pay_url");
    expect(items[0]).not.toHaveProperty("client_email");
    expect(items[0]).not.toHaveProperty("content");
    expect(selects[0]).toContain("pay_url");
    expect(selects[0]).toContain("client_email");
  });
});
