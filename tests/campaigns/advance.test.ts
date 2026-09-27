import { describe, it, expect, vi, beforeEach } from "vitest";

// An in-memory stand-in for the three tables advanceEnrollment touches, just
// faithful enough to the supabase-js builder for the calls it makes: select /
// eq / maybeSingle for reads, and update(...).eq(...).select() as a
// compare-and-set (only rows matching EVERY eq are updated and returned).
type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
}));

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Array<[string, unknown]> = [];
  private patch: Row | null = null;
  private insertRow: Row | null = null;
  private single = false;
  constructor(private table: string) {}
  select() {
    return this;
  }
  update(patch: Row) {
    this.patch = patch;
    return this;
  }
  insert(row: Row) {
    this.insertRow = row;
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push([col, value]);
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  private run(): { data: unknown; error: unknown } {
    const rows = (db.tables[this.table] ??= []);
    if (this.insertRow) {
      rows.push(this.insertRow);
      return { data: null, error: null };
    }
    const matched = rows.filter((r) => this.filters.every(([c, v]) => r[c] === v));
    if (this.patch) for (const r of matched) Object.assign(r, this.patch);
    if (this.single) return { data: matched[0] ?? null, error: null };
    return { data: matched.map((r) => ({ ...r })), error: null };
  }
  then<T1 = { data: unknown; error: unknown }, T2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    // Yield a tick first so two concurrent runs genuinely interleave.
    return new Promise<{ data: unknown; error: unknown }>((resolve) => setTimeout(() => resolve(this.run()), 0)).then(
      onfulfilled,
      onrejected,
    );
  }
}

const createDraft = vi.fn(async () => ({ id: "queue-1" }));

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({ from: (t: string) => new FakeQuery(t) })),
}));
vi.mock("@/lib/automation/rules", () => ({
  requireAutomationStaffRole: vi.fn(async () => undefined),
  currentOrgId: vi.fn(async () => "org-1"),
}));
vi.mock("@/lib/automation/drips", () => ({
  listSteps: vi.fn(async () => db.tables.crm_drip_step ?? []),
}));
vi.mock("@/lib/queue/org", () => ({ activeQueueOrgKey: vi.fn(async () => "org-key") }));
vi.mock("@/lib/queue/api", () => ({ createDraft: (...args: unknown[]) => createDraft(...(args as [])) }));

const { advanceEnrollment } = await import("@/lib/campaigns/advance");

function enrollment(): Row {
  return db.tables.crm_drip_enrollment[0];
}

beforeEach(() => {
  createDraft.mockReset();
  createDraft.mockImplementation(async () => ({ id: "queue-1" }));
  db.tables = {
    crm_drip_sequence: [{ id: "seq-1", active: true }],
    crm_drip_step: [
      { id: "step-1", sequence_id: "seq-1", order_index: 0, type: "email", delay_hours: 0, template_id: "tpl-1", config: {} },
      { id: "step-2", sequence_id: "seq-1", order_index: 1, type: "wait", delay_hours: 48, template_id: null, config: {} },
    ],
    crm_drip_enrollment: [
      { id: "enr-1", sequence_id: "seq-1", lead_id: "lead-1", current_step: 0, status: "active", next_step_at: null, completed_at: null },
    ],
    crm_lead: [{ id: "lead-1", first_name: "Dana", last_name: "Reyes", business_name: null, email: "dana@example.com" }],
    crm_email_template: [{ id: "tpl-1", subject: "Hi {{first_name}}", body_html: "Hello {{first_name}}", body_text: "" }],
    crm_activity: [],
    crm_task: [],
  };
});

describe("advanceEnrollment", () => {
  it("drafts an email step into the queue and moves to the next step", async () => {
    const result = await advanceEnrollment("enr-1");
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(createDraft.mock.calls[0]).toEqual([
      expect.objectContaining({ agent: "campaign", type: "CLIENT_EMAIL", recipient: "dana@example.com", subject: "Hi Dana" }),
    ]);
    expect(result).toEqual({ queueItemId: "queue-1", completed: false, stepType: "email" });
    expect(enrollment().current_step).toBe(1);
  });

  it("runs a step once when two runs race — the second is refused, not a duplicate draft", async () => {
    const results = await Promise.allSettled([advanceEnrollment("enr-1"), advanceEnrollment("enr-1")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(enrollment().current_step).toBe(1);
  });

  it("refuses to run anything while the campaign is paused", async () => {
    db.tables.crm_drip_sequence[0].active = false;
    await expect(advanceEnrollment("enr-1")).rejects.toThrow(/paused/);
    expect(createDraft).not.toHaveBeenCalled();
    expect(enrollment().current_step).toBe(0);
  });

  it("hands the step back when drafting fails, so it can be run again", async () => {
    createDraft.mockImplementation(async () => {
      throw new Error("queue down");
    });
    await expect(advanceEnrollment("enr-1")).rejects.toThrow("queue down");
    expect(enrollment()).toMatchObject({ current_step: 0, status: "active" });
  });

  it("refuses a lead with no email without advancing past the step", async () => {
    db.tables.crm_lead[0].email = "";
    await expect(advanceEnrollment("enr-1")).rejects.toThrow(/no email address/);
    expect(createDraft).not.toHaveBeenCalled();
    expect(enrollment().current_step).toBe(0);
  });

  it("completes the enrollment after its last step", async () => {
    enrollment().current_step = 1;
    const result = await advanceEnrollment("enr-1");
    expect(result.completed).toBe(true);
    expect(enrollment()).toMatchObject({ status: "completed", current_step: 2, next_step_at: null });
  });

  it("closes out an active enrollment whose sequence has no steps left", async () => {
    db.tables.crm_drip_step = [];
    const result = await advanceEnrollment("enr-1");
    expect(result.completed).toBe(true);
    expect(enrollment().status).toBe("completed");
  });
});
