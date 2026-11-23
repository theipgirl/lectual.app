import { describe, expect, it, vi } from "vitest";
import { loadCardCustomColumns } from "@/lib/custom-columns/card-load";

const okRead = () => vi.fn(async (...args: unknown[]) => (void args, { status: "ok" as const, fields: [], values: [], mergedInto: {} }));
const client = { tag: "scoped" };
const ACCESS = { canSeeMoney: false };
const deps = (read: ReturnType<typeof okRead>) => ({ client: async () => client, read: read as never, readMerged: vi.fn() as never });

describe("loadCardCustomColumns: one scoped read for the record the card shows", () => {
  it("a lead reads no matters and [id] leads", async () => {
    const read = okRead();
    const r = await loadCardCustomColumns({ kind: "lead", id: "l-keeper" }, ACCESS, deps(read));
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][0]).toBe(client);
    expect(read.mock.calls[0][1]).toEqual([]);
    expect(read.mock.calls[0][2]).toEqual(["l-keeper"]);
    expect(r).toEqual({ status: "ok", fields: [], values: [], mergedInto: {}, leadOfMatter: {} });
  });

  it("a matter reads [id] and [leadId], and knows its lead", async () => {
    const read = okRead();
    const r = await loadCardCustomColumns({ kind: "matter", id: "m-1", leadId: "l-1" }, ACCESS, deps(read));
    expect(read.mock.calls[0][1]).toEqual(["m-1"]);
    expect(read.mock.calls[0][2]).toEqual(["l-1"]);
    expect(r.status === "ok" && r.leadOfMatter).toEqual({ "m-1": "l-1" });
    const none = okRead();
    await loadCardCustomColumns({ kind: "matter", id: "m-2", leadId: null }, ACCESS, deps(none));
    expect(none.mock.calls[0][2]).toEqual([]);
  });

  it("not-set-up and unavailable pass through; a throw is unavailable", async () => {
    expect(await loadCardCustomColumns({ kind: "lead", id: "l" }, ACCESS, { client: async () => client, read: (async () => ({ status: "not-set-up" })) as never })).toEqual({ status: "not-set-up" });
    expect(await loadCardCustomColumns({ kind: "lead", id: "l" }, ACCESS, { client: async () => { throw new Error("no cookies"); } })).toEqual({ status: "unavailable" });
    expect(await loadCardCustomColumns({ kind: "lead", id: "l" }, ACCESS, { client: async () => client, read: (async () => { throw new Error("x"); }) as never })).toEqual({ status: "unavailable" });
  });
});
