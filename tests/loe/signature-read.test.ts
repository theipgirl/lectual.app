import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readSignature } from "@/lib/loe/signature-read";

/** The signature reader: three states, named columns, never the agreement text, address, IP or user agent. */

function fakeDb(result: { data?: unknown; error?: unknown } | "throw") {
  const calls: { table: string; columns: string; filters: Array<[string, unknown]> }[] = [];
  const db = {
    from(table: string) {
      const call = { table, columns: "", filters: [] as Array<[string, unknown]> };
      calls.push(call);
      const q: Record<string, unknown> = {
        select(c: string) {
          call.columns = c;
          return q;
        },
        eq(c: string, v: unknown) {
          call.filters.push([c, v]);
          return q;
        },
        order: () => q,
        limit: () => (result === "throw" ? Promise.reject(new Error("down")) : Promise.resolve({ data: result.data ?? null, error: result.error ?? null })),
      };
      return q;
    },
  };
  return { db: db as never, calls };
}

const ROW = { id: "s1", signer_name: "Sevetri Wilson", signed_at: "2026-11-12T19:14:00+00:00", agreement_sha256: "a".repeat(64), entity_name: "Prosperall Inc.", signer_title: "Founder", template_version: 3 };

describe("readSignature", () => {
  it("ok: the newest signature of the version, read with named columns", async () => {
    const { db, calls } = fakeDb({ data: [ROW] });
    const r = await readSignature(db, "p1");
    expect(r).toEqual({ status: "ok", signature: { id: "s1", signerName: "Sevetri Wilson", signedAt: ROW.signed_at, fingerprint: "a".repeat(64), entityName: "Prosperall Inc.", signerTitle: "Founder", templateVersion: 3 } });
    expect(calls[0].table).toBe("client_proposal_signature");
    expect(calls[0].filters).toEqual([["proposal_id", "p1"]]);
    for (const never of ["agreement_text", "address", "ip", "user_agent", "*"]) expect(calls[0].columns.split(/,\s*/)).not.toContain(never);
  });

  it("none: the read worked and found no row (never an error, never ok)", async () => {
    expect(await readSignature(fakeDb({ data: [] }).db, "p1")).toEqual({ status: "none" });
  });

  it("unavailable: an error, a throw, or a row that cannot be read", async () => {
    expect(await readSignature(fakeDb({ error: { code: "XX000" } }).db, "p1")).toEqual({ status: "unavailable" });
    expect(await readSignature(fakeDb("throw").db, "p1")).toEqual({ status: "unavailable" });
    expect(await readSignature(fakeDb({ data: [{ ...ROW, agreement_sha256: null }] }).db, "p1")).toEqual({ status: "unavailable" });
  });

  it("the source never names the privileged columns", () => {
    const src = readFileSync("src/lib/loe/signature-read.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/agreement_text|user_agent|\bip\b/);
    expect(src).not.toMatch(/console\./);
  });
});
