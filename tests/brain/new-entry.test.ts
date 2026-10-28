import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  existing: [] as { key: string }[],
  stages: [{ id: "st-1", name: "Consult Booked" }, { id: "st-2", name: "Proposal Sent" }] as { id: string; name: string }[],
  stagesFail: false,
  createError: null as Error | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/brain", () => ({
  createBrainEntry: vi.fn(async (input: Record<string, unknown>) => {
    if (h.createError) throw h.createError;
    h.created.push(input);
  }),
  listBrainEntries: vi.fn(async () => h.existing),
  updateBrainEntry: vi.fn(),
  deleteBrainEntry: vi.fn(),
  proposeClaim: vi.fn(),
  reviewClaim: vi.fn(),
  deleteClaim: vi.fn(),
}));
vi.mock("@/lib/pipeline/stages", () => ({
  listStages: async () => {
    if (h.stagesFail) throw new Error("down");
    return h.stages;
  },
}));

const { createBrainEntryAction } = await import("@/app/dashboard/brain/actions");
const { generateEntryKey } = await import("@/lib/brain/entry-key");
const { ENTRY_TYPES, knowledgeHelp, claimsHelp } = await import("@/app/dashboard/brain/enums");
const { parseStageMapping, stageForSignal } = await import("@/lib/agents/stage-keeper/mapping");

function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

beforeEach(() => {
  h.created = [];
  h.existing = [];
  h.stagesFail = false;
  h.createError = null;
});

describe("generateEntryKey", () => {
  it("is a lowercase slug of at most 64 characters", () => {
    const key = generateEntryKey("voice", "Brand Voice — Tone & Warmth!");
    expect(key).toMatch(/^voice-brand-voice-tone-warmth-[a-z0-9]{6}$/);
    expect(generateEntryKey("pricing", "x".repeat(300)).length).toBeLessThanOrEqual(64);
  });
  it("is never empty for a title of only symbols", () => {
    expect(generateEntryKey("other", "★★★ !!!")).toMatch(/^other-note-[a-z0-9]{6}$/);
  });
  it("differs between two calls for the same title", () => {
    expect(generateEntryKey("voice", "Same")).not.toBe(generateEntryKey("voice", "Same"));
  });
});

describe("ENTRY_TYPES", () => {
  it("offers four plain types mapped to existing categories", () => {
    expect(ENTRY_TYPES.map((t) => [t.label, t.category])).toEqual([
      ["Tone of voice", "voice"],
      ["Prices and packages", "pricing"],
      ["Stage rules", "stage_mapping"],
      ["Other", "other"],
    ]);
  });
});

describe("createBrainEntryAction", () => {
  it("maps Tone of voice to voice with a generated key and the posted title and body", async () => {
    const res = await createBrainEntryAction({}, form({ entryType: "voice", title: "Warm", body: "Be kind" }));
    expect(res).toEqual({});
    expect(h.created[0]).toMatchObject({ category: "voice", title: "Warm", body: "Be kind" });
    expect(String(h.created[0].key)).toMatch(/^voice-warm-/);
  });
  it("maps Prices and packages to pricing and Other to other", async () => {
    await createBrainEntryAction({}, form({ entryType: "pricing", title: "Flat fees" }));
    await createBrainEntryAction({}, form({ entryType: "other", title: "Misc" }));
    expect(h.created.map((c) => c.category)).toEqual(["pricing", "other"]);
  });
  it("refuses an unknown type, and ignores a posted key or category", async () => {
    expect((await createBrainEntryAction({}, form({ entryType: "decision_log", title: "x" }))).error).toBeTruthy();
    expect(h.created).toHaveLength(0);
    await createBrainEntryAction({}, form({ entryType: "voice", title: "Hello", key: "forged-key", category: "identity" }));
    expect(h.created[0].category).toBe("voice");
    expect(h.created[0].key).not.toBe("forged-key");
  });
  it("a permission refusal passes through and anything else is a fixed sentence", async () => {
    h.createError = new Error("You don't have permission to change the firm notes.");
    expect((await createBrainEntryAction({}, form({ entryType: "other", title: "x" }))).error).toMatch(/permission/);
    h.createError = new Error("duplicate key value violates constraint");
    expect((await createBrainEntryAction({}, form({ entryType: "other", title: "x" }))).error).toBe("Couldn't create this entry.");
  });
});

describe("stage rules", () => {
  it("creates a stage_mapping entry keyed by the signal id with the stage in body and data.stage", async () => {
    const res = await createBrainEntryAction({}, form({ entryType: "stage_rules", signal: "consult-scheduled", stageId: "st-1" }));
    expect(res).toEqual({});
    expect(h.created[0]).toMatchObject({
      category: "stage_mapping",
      key: "consult-scheduled",
      title: "Consult booked rule",
      body: "Consult Booked",
      data: { stage: "Consult Booked" },
    });
  });
  it("round trips: parseStageMapping and stageForSignal resolve the chosen stage", async () => {
    await createBrainEntryAction({}, form({ entryType: "stage_rules", signal: "post-consult-sent", stageId: "st-2" }));
    const mapping = parseStageMapping(h.created as { key: string; body: string; data: unknown }[]);
    expect(mapping["post-consult-sent"]).toBe("Proposal Sent");
    const stages = h.stages.map((s, i) => ({ id: s.id, name: s.name, category: "open", orderIndex: i }));
    expect(stageForSignal("post-consult-sent", stages, mapping)?.id).toBe("st-2");
  });
  it("refuses an invalid signal, a stage that is not the firm's, and a second rule for a signal", async () => {
    expect((await createBrainEntryAction({}, form({ entryType: "stage_rules", signal: "nope", stageId: "st-1" }))).error).toBeTruthy();
    expect((await createBrainEntryAction({}, form({ entryType: "stage_rules", signal: "consult-held", stageId: "other-firm" }))).error).toBe("Choose one of your stages.");
    h.existing = [{ key: "consult-held" }];
    expect((await createBrainEntryAction({}, form({ entryType: "stage_rules", signal: "consult-held", stageId: "st-1" }))).error).toMatch(/already a rule for Consult held/);
    expect(h.created).toHaveLength(0);
  });
  it("an unreadable stage list is its own sentence and writes nothing", async () => {
    h.stagesFail = true;
    const res = await createBrainEntryAction({}, form({ entryType: "stage_rules", signal: "consult-held", stageId: "st-1" }));
    expect(res.error).toMatch(/stages couldn't be loaded/);
    expect(h.created).toHaveLength(0);
  });
});

describe("who-can-add help", () => {
  it("is computed per role", () => {
    expect(knowledgeHelp("admin")).toMatch(/^You can add and edit/);
    expect(knowledgeHelp("paralegal")).toMatch(/You can read them/);
    expect(claimsHelp("attorney")).toBe("You can propose a claim. You can also review claims.");
    expect(claimsHelp("paralegal")).toMatch(/^You can propose a claim\. Owners, admins, senior admins and attorneys review/);
    expect(claimsHelp("viewer")).toMatch(/^You can read the claims but not propose one\./);
  });
});
