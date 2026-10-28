import { describe, it, expect, vi, beforeEach } from "vitest";

// An in-memory stand-in for the three tables advanceEnrollment touches, just
// faithful enough to the supabase-js builder for the calls it makes: select /
// eq / maybeSingle for reads, and update(...).eq(...).select() as a
// compare-and-set (only rows matching EVERY eq are updated and returned).
type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  failTable: null as string | null,
}));

type Filter = (r: Row) => boolean;

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Filter[] = [];
  private patch: Row | null = null;
  private insertRows: Row[] | null = null;
  private single = false;
  constructor(private table: string) {}
  select() {
    return this;
  }
  update(patch: Row) {
    this.patch = patch;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  in(col: string, values: readonly unknown[]) {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }
  lt(col: string, value: string) {
    this.filters.push((r) => typeof r[col] === "string" && Date.parse(r[col] as string) < Date.parse(value));
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  private run(): { data: unknown; error: unknown } {
    if (db.failTable === this.table) return { data: null, error: { code: "08006", message: "connection failure" } };
    const rows = (db.tables[this.table] ??= []);
    if (this.insertRows) {
      rows.push(...this.insertRows);
      return { data: null, error: null };
    }
    const matched = rows.filter((r) => this.filters.every((f) => f(r)));
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
  db.failTable = null;
  createDraft.mockReset();
  createDraft.mockImplementation(async () => ({ id: "queue-1" }));
  db.tables = {
    crm_drip_sequence: [{ id: "seq-1", org_id: "org-1", name: "UGW nurture", active: true }],
    crm_drip_step: [
      { id: "step-1", sequence_id: "seq-1", order_index: 0, type: "email", delay_hours: 0, template_id: "tpl-1", config: {} },
      { id: "step-2", sequence_id: "seq-1", order_index: 1, type: "wait", delay_hours: 48, template_id: null, config: {} },
    ],
    crm_drip_enrollment: [
      {
        id: "enr-1",
        org_id: "org-1",
        sequence_id: "seq-1",
        lead_id: "lead-1",
        current_step: 0,
        status: "active",
        next_step_at: null,
        completed_at: null,
        enrolled_at: "2026-10-01T12:00:00Z",
      },
    ],
    crm_lead: [
      {
        id: "lead-1",
        org_id: "org-1",
        first_name: "Dana",
        last_name: "Reyes",
        business_name: null,
        email: "dana@example.com",
        current_stage_id: "stage-open",
        stage_entered_at: "2026-09-30T12:00:00Z",
        last_inbound_at: null,
      },
    ],
    crm_stage: [
      { id: "stage-open", org_id: "org-1", category: "open" },
      { id: "stage-won", org_id: "org-1", category: "won" },
    ],
    crm_quote: [],
    crm_payment: [],
    crm_matter: [],
    crm_meeting: [],
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

// ── Why a non-active enrollment won't run: "resume it first" is only true of paused ──
describe("advanceEnrollment on an enrollment that isn't active", () => {
  async function refusal(patch: Row): Promise<string> {
    Object.assign(enrollment(), patch);
    const err = await advanceEnrollment("enr-1").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    // Whatever the message says, the refusal itself is unchanged: nothing ran, nothing moved.
    expect(createDraft).not.toHaveBeenCalled();
    expect(enrollment().current_step).toBe(0);
    return (err as Error).message;
  }

  it("a paused enrollment keeps the resume hint", async () => {
    const message = await refusal({ status: "paused" });
    expect(message).toMatch(/paused/);
    expect(message).toMatch(/resume it first/);
  });

  it("a stopped enrollment says it was stopped and can't be restarted, naming the reason", async () => {
    const message = await refusal({ status: "stopped", stop_reason: "signed" });
    expect(message).toBe("This campaign was stopped (signed quote) and can't be restarted.");
    expect(message).not.toMatch(/resume/i);
  });

  it("a stopped enrollment with no recorded reason (or one we don't know) still says so, without inventing one", async () => {
    expect(await refusal({ status: "stopped", stop_reason: null })).toBe("This campaign was stopped and can't be restarted.");
    expect(await refusal({ status: "stopped", stop_reason: "something-new" })).toBe("This campaign was stopped and can't be restarted.");
  });

  it("a completed enrollment says it's completed, with no resume hint", async () => {
    const message = await refusal({ status: "completed" });
    expect(message).toMatch(/completed/);
    expect(message).not.toMatch(/resume/i);
  });

  it("a cancelled enrollment says it was cancelled, with no resume hint", async () => {
    const message = await refusal({ status: "cancelled" });
    expect(message).toMatch(/cancelled/);
    expect(message).not.toMatch(/resume/i);
  });
});

// ── The guard (intake SOP §2.5: "check payment state before sending") ────────
describe("advanceEnrollment's stop guard", () => {
  function stopActivity() {
    return (db.tables.crm_activity ?? []).filter((a) => a.type === "drip_stopped");
  }

  it("stops instead of drafting when the lead has signed a quote, and records why", async () => {
    db.tables.crm_quote.push({ id: "q-1", org_id: "org-1", lead_id: "lead-1", status: "accepted", accepted_at: "2026-10-03T21:10:00Z" });
    const result = await advanceEnrollment("enr-1");
    expect(createDraft).not.toHaveBeenCalled();
    expect(result.stopped).toEqual({ reason: "signed", at: "2026-10-03T21:10:00Z" });
    expect(result.queueItemId).toBeNull();
    expect(enrollment()).toMatchObject({ status: "stopped", stop_reason: "signed", current_step: 0 });
    expect(stopActivity()).toHaveLength(1);
    expect(stopActivity()[0]).toMatchObject({
      org_id: "org-1",
      lead_id: "lead-1",
      payload: expect.objectContaining({ reason: "signed", sequence_name: "UGW nurture", detected_by: "advance_guard" }),
    });
  });

  it("stops on a recorded payment (paid at night, nudged in the morning — the incident)", async () => {
    db.tables.crm_quote.push({ id: "q-1", org_id: "org-1", lead_id: "lead-1", status: "sent", accepted_at: null });
    db.tables.crm_payment.push({ id: "p-1", org_id: "org-1", quote_id: "q-1", matter_id: null, status: "succeeded", occurred_at: "2026-10-02T03:00:00Z" });
    const result = await advanceEnrollment("enr-1");
    expect(createDraft).not.toHaveBeenCalled();
    expect(result.stopped?.reason).toBe("paid");
    expect(enrollment().status).toBe("stopped");
  });

  it("does not count a failed or pending payment as paid", async () => {
    db.tables.crm_quote.push({ id: "q-1", org_id: "org-1", lead_id: "lead-1", status: "sent", accepted_at: null });
    db.tables.crm_payment.push({ id: "p-1", org_id: "org-1", quote_id: "q-1", status: "failed", occurred_at: "2026-10-02T03:00:00Z" });
    const result = await advanceEnrollment("enr-1");
    expect(result.stopped).toBeUndefined();
    expect(createDraft).toHaveBeenCalledTimes(1);
  });

  it("stops when the lead is in a won stage (client) or has a matter (matter_opened)", async () => {
    db.tables.crm_lead[0].current_stage_id = "stage-won";
    expect((await advanceEnrollment("enr-1")).stopped?.reason).toBe("client");

    db.tables.crm_drip_enrollment[0] = { ...db.tables.crm_drip_enrollment[0], status: "active", stop_reason: null };
    db.tables.crm_lead[0].current_stage_id = "stage-open";
    db.tables.crm_matter.push({ id: "m-1", org_id: "org-1", lead_id: "lead-1", created_at: "2026-10-05T09:00:00Z" });
    expect((await advanceEnrollment("enr-1")).stopped?.reason).toBe("matter_opened");
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("stops on a reply or a recorded call AFTER enrolling, but not on one from before", async () => {
    db.tables.crm_lead[0].last_inbound_at = "2026-09-29T10:00:00Z"; // before enrolled_at
    expect((await advanceEnrollment("enr-1")).stopped).toBeUndefined();
    expect(createDraft).toHaveBeenCalledTimes(1);

    db.tables.crm_lead[0].last_inbound_at = "2026-10-04T10:00:00Z";
    expect((await advanceEnrollment("enr-1")).stopped?.reason).toBe("replied");
    expect(createDraft).toHaveBeenCalledTimes(1);
  });

  it("stops on a recorded call linked to the lead after enrolling (booked)", async () => {
    db.tables.crm_meeting.push({ id: "mt-1", org_id: "org-1", lead_id: "lead-1", started_at: "2026-10-06T15:00:00Z" });
    expect((await advanceEnrollment("enr-1")).stopped?.reason).toBe("booked");
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("fails closed: if the payment state can't be read, nothing is drafted and nothing moves", async () => {
    db.tables.crm_quote.push({ id: "q-1", org_id: "org-1", lead_id: "lead-1", status: "sent", accepted_at: null });
    db.failTable = "crm_payment";
    await expect(advanceEnrollment("enr-1")).rejects.toThrow(/Couldn't confirm/);
    expect(createDraft).not.toHaveBeenCalled();
    expect(enrollment()).toMatchObject({ status: "active", current_step: 0 });
  });

  it("reads the PERSON: a signature on a same-address duplicate lead row stops this one too", async () => {
    db.tables.crm_lead.push({
      id: "lead-2",
      org_id: "org-1",
      first_name: "Dana",
      last_name: "Reyes",
      business_name: null,
      email: "dana@example.com",
      current_stage_id: "stage-open",
      stage_entered_at: "2026-09-30T12:00:00Z",
      last_inbound_at: null,
    });
    db.tables.crm_quote.push({ id: "q-2", org_id: "org-1", lead_id: "lead-2", status: "accepted", accepted_at: "2026-10-03T21:10:00Z" });
    const result = await advanceEnrollment("enr-1");
    expect(createDraft).not.toHaveBeenCalled();
    expect(result.stopped).toEqual({ reason: "signed", at: "2026-10-03T21:10:00Z" });
    expect(enrollment()).toMatchObject({ status: "stopped", stop_reason: "signed" });
  });

  it("a same-address lead in ANOTHER firm is not read and does not stop this one", async () => {
    db.tables.crm_lead.push({
      id: "lead-x",
      org_id: "org-2",
      email: "dana@example.com",
      current_stage_id: "stage-open",
      stage_entered_at: "2026-09-30T12:00:00Z",
      last_inbound_at: null,
    });
    db.tables.crm_quote.push({ id: "q-x", org_id: "org-2", lead_id: "lead-x", status: "accepted", accepted_at: "2026-10-03T21:10:00Z" });
    const result = await advanceEnrollment("enr-1");
    expect(result.stopped).toBeUndefined();
    expect(createDraft).toHaveBeenCalledTimes(1);
  });

  it("counts a quote with accepted_at as signed whatever its status column says", async () => {
    db.tables.crm_quote.push({ id: "q-1", org_id: "org-1", lead_id: "lead-1", status: "expired", accepted_at: "2026-10-03T21:10:00Z" });
    expect((await advanceEnrollment("enr-1")).stopped?.reason).toBe("signed");
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("records when it checked the facts on the draft's timeline row (for the approval warning)", async () => {
    await advanceEnrollment("enr-1");
    const drafted = (db.tables.crm_activity ?? []).find((a) => a.type === "queue_drafted");
    expect(drafted?.payload).toMatchObject({ queueItemId: "queue-1", facts_checked_at: expect.any(String) });
  });

  it("a further advance after a stop drafts nothing", async () => {
    db.tables.crm_quote.push({ id: "q-1", org_id: "org-1", lead_id: "lead-1", status: "accepted", accepted_at: "2026-10-03T21:10:00Z" });
    await advanceEnrollment("enr-1");
    await expect(advanceEnrollment("enr-1")).rejects.toThrow(/stopped/);
    expect(createDraft).not.toHaveBeenCalled();
  });
});
