import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tag } from "@/lib/pipeline/tags";

// Mirrors the FakeQuery harness in tests/pipeline/tags-notes.test.ts, trimmed
// to the two calls the bulk read makes (select + in).
class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  calls: Array<[string, unknown[]]> = [];
  constructor(private result: { data: unknown; error: unknown }) {}
  select(...a: unknown[]) {
    this.calls.push(["select", a]);
    return this;
  }
  in(...a: unknown[]) {
    this.calls.push(["in", a]);
    return this;
  }
  eq(...a: unknown[]) {
    this.calls.push(["eq", a]);
    return this;
  }
  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

const state = vi.hoisted(() => ({
  resultsByTable: {} as Record<string, { data: unknown; error: unknown }>,
  queries: [] as FakeQuery[],
  tables: [] as string[],
}));

const mockFrom = vi.fn((table: string) => {
  state.tables.push(table);
  const q = new FakeQuery(state.resultsByTable[table] ?? { data: null, error: null });
  state.queries.push(q);
  return q;
});

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({ from: mockFrom })),
}));
vi.mock("@/lib/matters", () => ({
  ensureMatterForLead: vi.fn(),
  logActivity: vi.fn(),
  logActivitySafe: vi.fn(),
}));

const { groupTagsByLead, tagsForLeads } = await import("@/lib/pipeline/tags");

function tag(overrides: Partial<Tag>): Tag {
  return {
    id: "tag-1",
    org_id: "org-1",
    code: "PA-TM",
    label: "Trademark",
    dimension: "PA",
    description: null,
    color: null,
    ...overrides,
  } as Tag;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.resultsByTable = {};
  state.queries = [];
  state.tables = [];
});

describe("groupTagsByLead", () => {
  it("groups each lead's tags by lead id", () => {
    const tm = tag({ id: "tag-tm", label: "Trademark" });
    const cr = tag({ id: "tag-cr", code: "PA-CR", label: "Copyright" });

    const grouped = groupTagsByLead(
      ["lead-a", "lead-b"],
      [
        { lead_id: "lead-a", tag_id: "tag-tm" },
        { lead_id: "lead-a", tag_id: "tag-cr" },
        { lead_id: "lead-b", tag_id: "tag-cr" },
      ],
      [tm, cr],
    );

    expect(grouped["lead-a"].map((t) => t.label)).toEqual(["Trademark", "Copyright"]);
    expect(grouped["lead-b"].map((t) => t.label)).toEqual(["Copyright"]);
  });

  it("gives an untagged lead an empty array, not a missing key", () => {
    // The board does `tagsByLeadId[lead.id]` per card with no null check, so a
    // lead with no tags must still be a present key.
    const grouped = groupTagsByLead(["lead-a", "lead-b"], [{ lead_id: "lead-a", tag_id: "tag-1" }], [
      tag({ id: "tag-1" }),
    ]);

    expect(Object.keys(grouped).sort()).toEqual(["lead-a", "lead-b"]);
    expect(grouped).toHaveProperty("lead-b");
    expect(grouped["lead-b"]).toEqual([]);
  });

  it("drops links whose tag row wasn't returned instead of yielding undefined badges", () => {
    const grouped = groupTagsByLead(
      ["lead-a"],
      [
        { lead_id: "lead-a", tag_id: "tag-1" },
        { lead_id: "lead-a", tag_id: "tag-gone" },
      ],
      [tag({ id: "tag-1" })],
    );

    expect(grouped["lead-a"]).toHaveLength(1);
    expect(grouped["lead-a"].every(Boolean)).toBe(true);
  });

  it("ignores links for leads that weren't asked about, and de-duplicates", () => {
    const grouped = groupTagsByLead(
      ["lead-a"],
      [
        { lead_id: "lead-a", tag_id: "tag-1" },
        { lead_id: "lead-a", tag_id: "tag-1" },
        { lead_id: "lead-other", tag_id: "tag-1" },
      ],
      [tag({ id: "tag-1" })],
    );

    expect(Object.keys(grouped)).toEqual(["lead-a"]);
    expect(grouped["lead-a"]).toHaveLength(1);
  });
});

describe("tagsForLeads", () => {
  it("reads every lead's tags in two queries, not two per lead", async () => {
    state.resultsByTable = {
      crm_lead_tag: {
        data: [
          { lead_id: "lead-a", tag_id: "tag-1" },
          { lead_id: "lead-b", tag_id: "tag-1" },
          { lead_id: "lead-c", tag_id: "tag-2" },
        ],
        error: null,
      },
      crm_tag: { data: [tag({ id: "tag-1" }), tag({ id: "tag-2", label: "Copyright" })], error: null },
    };

    const grouped = await tagsForLeads(["lead-a", "lead-b", "lead-c"]);

    // The N+1 this replaced was 2 round trips per lead (6 here).
    expect(state.tables).toEqual(["crm_lead_tag", "crm_tag"]);
    expect(grouped["lead-a"][0].label).toBe("Trademark");
    expect(grouped["lead-c"][0].label).toBe("Copyright");
  });

  it("de-duplicates tag ids before the second query", async () => {
    state.resultsByTable = {
      crm_lead_tag: {
        data: [
          { lead_id: "lead-a", tag_id: "tag-1" },
          { lead_id: "lead-b", tag_id: "tag-1" },
        ],
        error: null,
      },
      crm_tag: { data: [tag({ id: "tag-1" })], error: null },
    };

    await tagsForLeads(["lead-a", "lead-b"]);

    const tagQuery = state.queries[1];
    expect(tagQuery.calls.find(([name]) => name === "in")?.[1]).toEqual(["id", ["tag-1"]]);
  });

  it("hits the database not at all for an empty lead list", async () => {
    expect(await tagsForLeads([])).toEqual({});
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("skips the tag lookup when no lead has tags, and still keys every lead", async () => {
    state.resultsByTable = { crm_lead_tag: { data: [], error: null } };

    const grouped = await tagsForLeads(["lead-a", "lead-b"]);

    expect(state.tables).toEqual(["crm_lead_tag"]);
    expect(grouped).toEqual({ "lead-a": [], "lead-b": [] });
  });

  it("propagates a failed read rather than reporting the leads as untagged", async () => {
    state.resultsByTable = { crm_lead_tag: { data: null, error: { message: "boom" } } };
    await expect(tagsForLeads(["lead-a"])).rejects.toBeTruthy();
  });
});
