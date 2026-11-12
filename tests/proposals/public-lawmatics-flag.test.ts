import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: () => {} }));

import { readPublicProposal, LAWMATICS_CONNECTION_PUBLIC_COLUMNS, type PublicProposalsDb } from "@/lib/proposals/public";
import { NOW, world } from "./signing-world";
import { twoBrandPerMark } from "../loe/loe-fixtures";

/**
 * `firm.savesAddressToLawmatics`: true only for a proposal with a letter whose firm has an ACTIVE Lawmatics connection, read with
 * `status` only and fenced on the proposal's org. Anything else, a failed read included, is false and never fails the page.
 */

const active = (status = "active", org = "org-1") => ({ org_id: org, status, token_enc: "SEALED-TOKEN" });

async function read(db: PublicProposalsDb) {
  const r = await readPublicProposal("T".repeat(43), NOW, db);
  if (r.status !== "ok") throw new Error(`read was ${r.status}`);
  return r;
}

/** The fake keeps its tables in a closure, so the connection rows are served by a wrapper around `from`. */
function serve(w: ReturnType<typeof world>, rows: Array<Record<string, unknown>> | "error" | "throw") {
  const seen: Array<{ columns?: string; filters: Array<[string, unknown]> }> = [];
  const db: PublicProposalsDb = {
    ...w.db,
    rpc: w.db.rpc?.bind(w.db),
    from(table: string) {
      if (table !== "lawmatics_connection") return w.db.from(table);
      if (rows === "throw") throw new Error("connection read exploded");
      const call: { columns?: string; filters: Array<[string, unknown]> } = { filters: [] };
      seen.push(call);
      const q = {
        select(columns: string) {
          call.columns = columns;
          return q;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return q;
        },
        maybeSingle() {
          if (rows === "error") return Promise.resolve({ data: null, error: { code: "XX000", message: "refused" } });
          const hit = rows.find((r) => call.filters.every(([c, v]) => r[c] === v)) ?? null;
          return Promise.resolve({ data: hit ? { status: hit.status } : null, error: null });
        },
      };
      return q as never;
    },
  };
  return { db, seen };
}

describe("firm.savesAddressToLawmatics on the public read", () => {
  it("is true for a letter proposal whose firm has an active connection, read with `status` only and fenced on the row's org", async () => {
    const w = world();
    const { db, seen } = serve(w, [active()]);
    const r = await read(db);
    expect(r.view.firm.savesAddressToLawmatics).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].columns).toBe("status");
    expect(LAWMATICS_CONNECTION_PUBLIC_COLUMNS).toBe("status");
    expect(seen[0].columns).not.toMatch(/token|enc|secret|\*/);
    expect(seen[0].filters).toContainEqual(["org_id", "org-1"]);
    // Nothing but the boolean about the connection is in the view.
    expect(JSON.stringify(r.view)).not.toContain("SEALED-TOKEN");
  });

  it("is false with no connection, a revoked one, another firm's, a failed read, or a read that throws, and the page still reads", async () => {
    for (const rows of [[], [active("revoked")], [active("active", "org-2")], "error", "throw"] as const) {
      const w = world();
      const { db } = serve(w, rows as never);
      const r = await read(db);
      expect(r.view.firm.savesAddressToLawmatics, JSON.stringify(rows)).toBe(false);
    }
  });

  it("is false (and not even asked) for a proposal with no letter", async () => {
    const w = world({ content: twoBrandPerMark() });
    const { db, seen } = serve(w, [active()]);
    const r = await read(db);
    expect(r.view.firm.savesAddressToLawmatics).toBe(false);
    expect(seen).toHaveLength(0);
  });
});
