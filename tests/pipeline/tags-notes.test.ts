import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirrors the FakeQuery harness in tests/pipeline/leads.test.ts.
class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  calls: Array<[string, unknown[]]> = [];
  constructor(private result: { data: unknown; error: unknown }) {}
  select(...a: unknown[]) {
    this.calls.push(["select", a]);
    return this;
  }
  eq(...a: unknown[]) {
    this.calls.push(["eq", a]);
    return this;
  }
  in(...a: unknown[]) {
    this.calls.push(["in", a]);
    return this;
  }
  insert(...a: unknown[]) {
    this.calls.push(["insert", a]);
    return this;
  }
  delete(...a: unknown[]) {
    this.calls.push(["delete", a]);
    return this;
  }
  single() {
    return Promise.resolve(this.result);
  }
  maybeSingle() {
    return Promise.resolve(this.result);
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
  role: "attorney" as string | null,
  resultsByTable: {} as Record<string, { data: unknown; error: unknown }>,
  fromResult: { data: null as unknown, error: null as unknown },
  queries: [] as FakeQuery[],
  tables: [] as string[],
  logActivity: vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {}),
  logActivitySafe: vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {}),
}));

const mockFrom = vi.fn((table: string) => {
  state.tables.push(table);
  const q = new FakeQuery(state.resultsByTable[table] ?? state.fromResult);
  state.queries.push(q);
  return q;
});
const mockRpc = vi.fn(() => Promise.resolve({ data: state.role, error: null as unknown }));

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({ from: mockFrom, rpc: mockRpc })),
}));
vi.mock("@/lib/matters", () => ({
  ensureMatterForLead: vi.fn(),
  logActivity: state.logActivity,
  logActivitySafe: state.logActivitySafe,
}));

const { applyTag, removeTag } = await import("@/lib/pipeline/tags");
const { addLeadNote } = await import("@/lib/pipeline/notes");

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "attorney";
  state.resultsByTable = {};
  state.fromResult = { data: null, error: null };
  state.queries = [];
  state.tables = [];
});

describe("applyTag audit", () => {
  it("records tag_applied with the human-readable label", async () => {
    state.resultsByTable = {
      crm_lead: { data: { org_id: "org-1" }, error: null },
      crm_lead_tag: { data: null, error: null },
      crm_tag: { data: { label: "Trademark", code: "PA-TM" }, error: null },
    };

    await applyTag("lead-1", "tag-1", { source: "human" });

    const [entry] = state.logActivitySafe.mock.calls[0] as unknown as [
      { type: string; leadId: string; actorType: string; payload: Record<string, unknown> },
    ];
    expect(entry.type).toBe("tag_applied");
    expect(entry.leadId).toBe("lead-1");
    expect(entry.actorType).toBe("user");
    expect(entry.payload.tag_label).toBe("Trademark");
    expect(entry.payload.source).toBe("human");
  });

  it("attributes an AI-sourced tag to the ai actor, not to a person", async () => {
    state.resultsByTable = {
      crm_lead: { data: { org_id: "org-1" }, error: null },
      crm_lead_tag: { data: null, error: null },
      crm_tag: { data: { label: "High value", code: "VAL-HIGH" }, error: null },
    };

    await applyTag("lead-1", "tag-2", { source: "ai", confidence: 0.9 });

    const [entry] = state.logActivitySafe.mock.calls[0] as unknown as [{ actorType: string }];
    expect(entry.actorType).toBe("ai");
  });

  it("does not log when the tag insert itself fails", async () => {
    state.resultsByTable = {
      crm_lead: { data: { org_id: "org-1" }, error: null },
      crm_lead_tag: { data: null, error: { message: "boom" } },
    };

    await expect(applyTag("lead-1", "tag-1")).rejects.toBeTruthy();
    expect(state.logActivitySafe).not.toHaveBeenCalled();
  });
});

describe("removeTag audit", () => {
  it("reads the label BEFORE the delete so the timeline can still name the tag", async () => {
    state.resultsByTable = {
      crm_tag: { data: { label: "Trademark", code: "PA-TM" }, error: null },
      crm_lead_tag: { data: null, error: null },
    };

    await removeTag("lead-1", "tag-1");

    expect(state.tables.indexOf("crm_tag")).toBeLessThan(state.tables.indexOf("crm_lead_tag"));
    const [entry] = state.logActivitySafe.mock.calls[0] as unknown as [
      { type: string; payload: Record<string, unknown> },
    ];
    expect(entry.type).toBe("tag_removed");
    expect(entry.payload.tag_label).toBe("Trademark");
  });

  it("does not log when the delete fails", async () => {
    state.resultsByTable = {
      crm_tag: { data: { label: "Trademark", code: "PA-TM" }, error: null },
      crm_lead_tag: { data: null, error: { message: "boom" } },
    };
    await expect(removeTag("lead-1", "tag-1")).rejects.toBeTruthy();
    expect(state.logActivitySafe).not.toHaveBeenCalled();
  });
});

describe("addLeadNote", () => {
  it("writes a strict (non-swallowed) activity row for a plain note", async () => {
    await addLeadNote("lead-1", { kind: "note", body: "  Called the founder.  " });

    expect(state.logActivitySafe).not.toHaveBeenCalled();
    const [entry] = state.logActivity.mock.calls[0] as unknown as [
      { type: string; leadId: string; actorType: string; payload: Record<string, unknown> },
    ];
    expect(entry.type).toBe("note");
    expect(entry.leadId).toBe("lead-1");
    expect(entry.actorType).toBe("user");
    expect(entry.payload.note).toBe("Called the founder.");
  });

  it("uses the payload keys the timeline's summarizer already reads per kind", async () => {
    await addLeadNote("lead-1", {
      kind: "call_logged",
      body: "15 minutes, discussed classes.",
      subject: "Discovery call",
    });
    const [call] = state.logActivity.mock.calls[0] as unknown as [{ payload: Record<string, unknown> }];
    expect(call.payload.summary).toBe("Discovery call");

    state.logActivity.mockClear();
    await addLeadNote("lead-1", { kind: "email_sent", body: "Sent the LOE.", subject: "Your LOE" });
    const [email] = state.logActivity.mock.calls[0] as unknown as [{ payload: Record<string, unknown> }];
    expect(email.payload.subject).toBe("Your LOE");
  });

  it("refuses viewer and social_media, and never writes", async () => {
    for (const role of ["viewer", "social_media"]) {
      state.role = role;
      await expect(addLeadNote("lead-1", { body: "hi" })).rejects.toThrow(/Forbidden/);
    }
    expect(state.logActivity).not.toHaveBeenCalled();
  });

  it("validates before it even resolves a role", async () => {
    state.role = "attorney";
    await expect(addLeadNote("lead-1", { body: "   " })).rejects.toThrow(/Write something/i);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(state.logActivity).not.toHaveBeenCalled();
  });

  it("lets a failed insert propagate — the note IS the mutation", async () => {
    state.role = "attorney";
    state.logActivity.mockRejectedValueOnce(new Error("insert failed"));
    await expect(addLeadNote("lead-1", { body: "hi" })).rejects.toThrow(/insert failed/);
  });
});
