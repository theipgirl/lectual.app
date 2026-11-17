import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MISSING_TTL_MS,
  followMerged,
  foldMergedLeads,
  isMergeColumnMissing,
  keeperIn,
  leadMergeSupport,
  leadRead,
  mergeAvailable,
  mergedSetFor,
  resetLeadMergeSupport,
  resolveLeadId,
} from "@/lib/leads/live";
import {
  MERGE_FIELDS,
  buildChoices,
  canMergeLeads,
  defaultChoice,
  isLeadMergeGuarded,
  mergeErrorSentence,
  runMergeLeads,
  suggestKeeper,
} from "@/lib/leads/merge";
import { mergeHref, mergeNotice, mergedFromRedirect, mergedRedirect } from "@/lib/leads/merge-links";
import { loadMergeView, type MergeLeadRow, type MergeReads } from "@/lib/leads/merge-load";
import { LEAD_MERGED_WRITE, LEAD_MERGED_IMPORT_SKIP, MERGE_FAILED, MERGE_REFUSALS, notReadyYet } from "@/lib/ui/words";
import { findDuplicates } from "@/lib/intake/duplicates";
import { planImport, type ExistingLead } from "@/lib/lawmatics/import-plan";
import { planHiredSync, type HiredProspect, type PlanLead } from "@/lib/lawmatics/hired-sync-plan";
import { friendlyLeadWriteError, friendlyMoveStageError } from "@/app/dashboard/leads/errors";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

/** A tiny query builder that records the filters it was given and answers from a handler. */
function recorder(answer: (ops: Array<[string, unknown[]]>) => { data?: unknown; error?: unknown; count?: number }) {
  const calls: Array<Array<[string, unknown[]]>> = [];
  type Chain = { select: (...a: unknown[]) => Chain } & Record<string, unknown>;
  const from = (table: string): Chain => {
    const ops: Array<[string, unknown[]]> = [["from", [table]]];
    calls.push(ops);
    const q: Record<string, unknown> = {};
    for (const name of ["select", "eq", "in", "is", "order", "limit", "update", "range"]) {
      q[name] = (...args: unknown[]) => {
        ops.push([name, args]);
        return q;
      };
    }
    q.maybeSingle = () => Promise.resolve({ data: null, error: null, ...answer(ops) });
    q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ data: null, error: null, ...answer(ops) }).then(ok, bad);
    return q as Chain;
  };
  return { db: { from }, calls };
}
const hasIs = (ops: Array<[string, unknown[]]>) => ops.some(([n, a]) => n === "is" && a[0] === "merged_into_id" && a[1] === null);

beforeEach(() => resetLeadMergeSupport());
afterEach(() => resetLeadMergeSupport());

describe("live leads: leadRead", () => {
  it("adds .is('merged_into_id', null) through live(...) and remembers the columns exist", async () => {
    const { db, calls } = recorder(() => ({ data: [] }));
    await leadRead(({ live }) => live(db.from("crm_lead").select("*")) as unknown as PromiseLike<{ error: unknown }>);
    expect(hasIs(calls[0])).toBe(true);
    expect(leadMergeSupport()).toBe("present");
  });

  for (const code of ["42703", "PGRST204"]) {
    it(`before 0107 (${code}) it runs the same read unfiltered, and keeps doing so for a while`, async () => {
      const { db, calls } = recorder((ops) => (hasIs(ops) ? { error: { code, message: "column crm_lead.merged_into_id does not exist" } } : { data: [{ id: A }] }));
      let now = 1_000;
      const read = () => leadRead(({ live }) => live(db.from("crm_lead").select("*")) as unknown as PromiseLike<{ data: unknown; error: unknown }>, () => now);
      const first = await read();
      expect(first).toMatchObject({ data: [{ id: A }] });
      expect(calls.map(hasIs)).toEqual([true, false]);
      expect(leadMergeSupport(now)).toBe("missing");
      await read();
      expect(calls.map(hasIs)).toEqual([true, false, false]);
      now += MISSING_TTL_MS + 1;
      await read();
      expect(calls.map(hasIs).slice(3)).toEqual([true, false]);
    });
  }

  it("a missing column that is NOT ours is returned as the error, and nothing is remembered", async () => {
    const { db } = recorder(() => ({ error: { code: "42703", message: "other column" } }));
    const r = await leadRead(({ live }) => live(db.from("crm_lead").select("nope")) as unknown as PromiseLike<{ error: unknown }>);
    expect(isMergeColumnMissing(r.error)).toBe(true);
    expect(leadMergeSupport()).toBe("unknown");
  });

  it("judges the fallback by code only", () => {
    expect(isMergeColumnMissing({ code: "42703" })).toBe(true);
    expect(isMergeColumnMissing({ code: "PGRST204" })).toBe(true);
    expect(isMergeColumnMissing({ code: "42501", message: "merged_into_id" })).toBe(false);
    expect(isMergeColumnMissing(null)).toBe(false);
  });
});

describe("live leads: the resolver", () => {
  const table = (rows: Record<string, string | null>) => async (id: string) => (id in rows ? { id, merged_into_id: rows[id] } : null);

  it("a live lead is itself", async () => {
    expect(await followMerged(A, table({ [A]: null }))).toEqual({ status: "ok", id: A, mergedFrom: null });
  });
  it("a merged lead is followed one hop to its keeper", async () => {
    expect(await followMerged(B, table({ [A]: null, [B]: A }))).toEqual({ status: "ok", id: A, mergedFrom: B });
  });
  it("a loop, or a keeper that isn't there, is unavailable, never a guess", async () => {
    expect(await followMerged(A, table({ [A]: B, [B]: A }))).toEqual({ status: "unavailable" });
    expect(await followMerged(B, table({ [B]: C }))).toEqual({ status: "unavailable" });
  });
  it("a lead that isn't there is not-found; a failed read is unavailable", async () => {
    expect(await followMerged(C, table({}))).toEqual({ status: "not-found" });
    expect(await followMerged(A, async () => Promise.reject(new Error("down")))).toEqual({ status: "unavailable" });
  });
  it("keeperIn follows inside a loaded list with the same guard", () => {
    const rows = new Map([
      [A, { id: A, merged_into_id: null }],
      [B, { id: B, merged_into_id: A }],
      [C, { id: C, merged_into_id: C }],
    ]);
    expect(keeperIn(B, rows)).toBe(A);
    expect(keeperIn(A, rows)).toBe(A);
    expect(keeperIn(C, rows)).toBeNull();
  });
  it("resolveLeadId reads the pointer through the given client, fenced on the org when given", async () => {
    const { db, calls } = recorder((ops) => {
      const id = ops.find(([n, a]) => n === "eq" && a[0] === "id")?.[1][1];
      return { data: id === B ? { id: B, merged_into_id: A } : { id: A, merged_into_id: null } };
    });
    expect(await resolveLeadId(db, B, "org-1")).toEqual({ status: "ok", id: A, mergedFrom: B });
    expect(calls[0]).toContainEqual(["eq", ["org_id", "org-1"]]);
    expect(calls[0]).toContainEqual(["select", ["id, merged_into_id"]]);
  });
});

describe("live leads: the merged set (history reads)", () => {
  it("is the keeper plus the leads merged into it", async () => {
    const { db, calls } = recorder(() => ({ data: [{ id: B }, { id: C }] }));
    expect(await mergedSetFor(db, A)).toEqual({ status: "ok", ids: [A, B, C] });
    expect(calls[0]).toContainEqual(["eq", ["merged_into_id", A]]);
  });
  it("before 0107 it is the keeper alone", async () => {
    const { db } = recorder(() => ({ error: { code: "42703" } }));
    expect(await mergedSetFor(db, A)).toEqual({ status: "ok", ids: [A] });
  });
  it("a failed read is unavailable WITH the keeper, so the keeper's own history still draws", async () => {
    const { db } = recorder(() => ({ error: { code: "08006" } }));
    expect(await mergedSetFor(db, A)).toEqual({ status: "unavailable", ids: [A] });
  });
});

describe("mergeAvailable (Merge is hidden before 0107 and on a failed probe)", () => {
  it("true when the column is there", async () => {
    expect(await mergeAvailable(recorder(() => ({ data: [] })).db)).toBe(true);
  });
  it("false before 0107 and on any other failure", async () => {
    expect(await mergeAvailable(recorder(() => ({ error: { code: "PGRST204" } })).db)).toBe(false);
    resetLeadMergeSupport();
    expect(await mergeAvailable(recorder(() => ({ error: { code: "08006" } })).db)).toBe(false);
  });
});

describe("foldMergedLeads (matchers that follow the pointer)", () => {
  it("reads a merged row as its keeper with only its email, and drops what can't be resolved", () => {
    const out = foldMergedLeads([
      { id: A, email: "new@x.com", merged_into_id: null },
      { id: B, email: "OLD@x.com", merged_into_id: A },
      { id: C, email: "c@x.com", merged_into_id: "missing" },
      { id: "d", email: "new@x.com", merged_into_id: A },
    ]);
    expect(out).toEqual([
      { id: A, email: "new@x.com" },
      { id: A, email: "OLD@x.com" },
    ]);
  });
});

describe("merge rules", () => {
  it("only owner, admin and senior admin may merge", () => {
    expect(["owner", "admin", "senior_admin"].every((r) => canMergeLeads(r as never))).toBe(true);
    expect(["attorney", "intake", "paralegal", "viewer", "social_media", "clerk", "law_clerk"].some((r) => canMergeLeads(r as never))).toBe(false);
    expect(canMergeLeads(null)).toBe(false);
  });

  it("builds the choices only from known fields and the two known sides", () => {
    const form = new FormData();
    form.append("choice.email", "loser");
    form.append("choice.phone", "keeper");
    form.append("choice.current_stage_id", "loser");
    form.append("choice.org_id", "loser");
    form.append("choice.first_name", "both");
    form.append("choice.last_name", "loser");
    form.append("choice.last_name", "keeper");
    form.append("email", "loser");
    expect(buildChoices(form)).toEqual({ email: "loser", phone: "keeper" });
    expect(MERGE_FIELDS).not.toContain("current_stage_id");
  });

  it("defaults like the database: the keeper's value unless it is empty and the other isn't", () => {
    expect(defaultChoice("a@x.com", "b@x.com")).toBe("keeper");
    expect(defaultChoice(" ", "b@x.com")).toBe("loser");
    expect(defaultChoice(null, null)).toBe("keeper");
  });

  it("suggests the lead with a matter, then the Lawmatics one, then the older", () => {
    const f = (id: string, o: Partial<{ createdAt: string; hasMatter: boolean; hasLawmatics: boolean }> = {}) => ({ id, createdAt: "2026-01-02", hasMatter: false, hasLawmatics: false, ...o });
    expect(suggestKeeper(f(A), f(B, { hasMatter: true }))).toEqual({ keeperId: B, why: "matter" });
    expect(suggestKeeper(f(A, { hasLawmatics: true }), f(B))).toEqual({ keeperId: A, why: "lawmatics" });
    expect(suggestKeeper(f(A), f(B, { createdAt: "2025-12-01" }))).toEqual({ keeperId: B, why: "older" });
    expect(suggestKeeper(f(A), f(B))).toEqual({ keeperId: A, why: "older" });
  });
});

describe("runMergeLeads: gates first, then one call", () => {
  const ok = { data: { tasks: 2, activity_left: 5, bogus: "x" }, error: null };

  it("resolves the role FIRST and a refused role calls nothing", async () => {
    const order: string[] = [];
    const merge = vi.fn(async () => (order.push("merge"), ok));
    for (const role of ["attorney", "intake", "viewer", "social_media"]) {
      const out = await runMergeLeads({ keeperId: A, loserId: B, choices: {} }, { role: async () => (order.push("role"), role as never), merge });
      expect(out).toEqual({ ok: false, error: MERGE_REFUSALS.merge_not_allowed });
    }
    expect(merge).not.toHaveBeenCalled();
    const unresolvable = await runMergeLeads({ keeperId: A, loserId: B, choices: {} }, { role: async () => Promise.reject(new Error("no role")), merge });
    expect(unresolvable).toEqual({ ok: false, error: MERGE_REFUSALS.merge_not_allowed });
    expect(merge).not.toHaveBeenCalled();
  });

  it("refuses bad or equal ids before calling", async () => {
    const merge = vi.fn(async () => ok);
    expect(await runMergeLeads({ keeperId: "x", loserId: B, choices: {} }, { role: async () => "owner", merge })).toEqual({ ok: false, error: MERGE_REFUSALS.merge_not_found });
    expect(await runMergeLeads({ keeperId: A, loserId: A, choices: {} }, { role: async () => "admin", merge })).toEqual({ ok: false, error: MERGE_REFUSALS.merge_same_record });
    expect(merge).not.toHaveBeenCalled();
  });

  it("calls crm_merge_leads once with the keeper, the merged lead and the cleaned choices", async () => {
    const merge = vi.fn(async () => ok);
    const out = await runMergeLeads({ keeperId: A, loserId: B, choices: { email: "loser", nope: "loser" } as never }, { role: async () => "senior_admin", merge });
    expect(merge).toHaveBeenCalledWith({ p_keeper: A, p_loser: B, p_choices: { email: "loser" } });
    expect(out).toEqual({ ok: true, keeperId: A, counts: { tasks: 2, activity_left: 5 } });
  });

  it("maps every refusal prefix to its fixed sentence and never echoes the message", async () => {
    const codes: Record<string, string> = {
      merge_not_allowed: "42501",
      merge_same_record: "23514",
      merge_not_found: "42501",
      merge_already_merged: "23514",
      merge_chain: "23514",
      merge_open_payment: "23514",
      merge_proposal_unpaid: "23514",
      merge_bad_choice: "22023",
    };
    for (const [prefix, code] of Object.entries(codes)) {
      const error = { code, message: `${prefix}: SECRET detail about lead ${B}` };
      const out = await runMergeLeads({ keeperId: A, loserId: B, choices: {} }, { role: async () => "owner", merge: async () => ({ data: null, error }) });
      expect(out).toEqual({ ok: false, error: MERGE_REFUSALS[prefix as keyof typeof MERGE_REFUSALS] });
      expect(JSON.stringify(out)).not.toContain("SECRET");
    }
    expect(MERGE_REFUSALS.merge_chain).toContain("Keep this lead and merge the other into it");
    expect(mergeErrorSentence({ code: "PGRST202", message: "Could not find the function" })).toBe(notReadyYet("Merging leads"));
    expect(mergeErrorSentence({ code: "XX000", message: "boom SECRET" })).toBe(MERGE_FAILED);
    expect(mergeErrorSentence(new Error("thrown SECRET"))).toBe(MERGE_FAILED);
  });
});

describe("a write that reaches a merged lead", () => {
  const guarded = { code: "42501", message: "lead_merge_guarded: lead SECRET is merged" };
  it("is recognised by code AND prefix", () => {
    expect(isLeadMergeGuarded(guarded)).toBe(true);
    expect(isLeadMergeGuarded({ code: "42501", message: "new row violates row-level security" })).toBe(false);
    expect(isLeadMergeGuarded({ code: "23514", message: "lead_merge_guarded" })).toBe(false);
  });
  it("shows the fixed sentence on every lead write and stage move, never the raw text", () => {
    expect(friendlyLeadWriteError(guarded, "fallback")).toBe(LEAD_MERGED_WRITE);
    expect(friendlyMoveStageError(guarded)).toBe(LEAD_MERGED_WRITE);
    expect(friendlyMoveStageError({ code: "42501", message: "permission denied" })).not.toBe(LEAD_MERGED_WRITE);
  });
});

describe("the links and the quiet lines", () => {
  it("a merge lands on the kept lead; a merged lead's link goes to its keeper", () => {
    expect(mergedRedirect(A)).toBe(`/dashboard/leads/${A}/?merged=1`);
    expect(mergedFromRedirect(A, B)).toBe(`/dashboard/leads/${A}/?from=${B}`);
    expect(mergeHref(A, B)).toBe(`/dashboard/intake/merge/?a=${A}&b=${B}`);
    expect(mergeHref(A, B, B)).toBe(`/dashboard/intake/merge/?a=${A}&b=${B}&keep=${B}`);
  });
  it("the 'merged into' line is shown only for a lead really merged into this one", () => {
    expect(mergeNotice({ merged: "1" }, [B])).toBe("merged");
    expect(mergeNotice({ merged: "1" }, [])).toBeNull();
    expect(mergeNotice({ from: B }, [B])).toBe("from");
    expect(mergeNotice({ from: C }, [B])).toBeNull();
    expect(mergeNotice({ from: "<script>" }, ["<script>"])).toBeNull();
    expect(mergeNotice({}, [B])).toBeNull();
  });
});

describe("the merge screen's reads", () => {
  const lead = (id: string, o: Partial<MergeLeadRow> = {}): MergeLeadRow => ({
    id,
    first_name: "Ana",
    last_name: "Ruiz",
    email: "ana@x.com",
    phone: null,
    business_name: null,
    website: null,
    mark_text: null,
    referral_source: null,
    referral_detail: null,
    practice_area: null,
    assigned_to: null,
    temperature: null,
    lane: null,
    current_stage_id: "s1",
    lawmatics_id: null,
    created_at: "2026-01-01T00:00:00Z",
    merged_into_id: null,
    ...o,
  });
  const reads = (rows: Record<string, MergeLeadRow>, over: Partial<MergeReads> = {}): MergeReads => ({
    lead: async (id) => rows[id] ?? null,
    matterExists: async () => false,
    matters: async () => [],
    count: async () => 3,
    ...over,
  });

  it("bad ids ask for two leads; a matter id says a lead and a matter can't be merged", async () => {
    expect(await loadMergeView(A, A, null, reads({}))).toEqual({ status: "bad-ids" });
    expect(await loadMergeView("x", B, null, reads({}))).toEqual({ status: "bad-ids" });
    expect(await loadMergeView(A, B, null, reads({ [A]: lead(A) }, { matterExists: async (id) => id === B }))).toEqual({ status: "not-a-lead", matterId: B });
    expect(await loadMergeView(A, B, null, reads({ [A]: lead(A) }))).toEqual({ status: "gone" });
  });

  it("an already merged lead is said, with its keeper", async () => {
    expect(await loadMergeView(A, B, null, reads({ [A]: lead(A), [B]: lead(B, { merged_into_id: C }) }))).toMatchObject({ status: "already-merged", keeperId: C });
  });

  it("each count is its own read: a failed one is unavailable, never 0", async () => {
    const view = await loadMergeView(A, B, null, reads({ [A]: lead(A), [B]: lead(B) }, { count: async (key) => (key === "files" ? Promise.reject(new Error("x")) : 4) }));
    if (view.status !== "ok") throw new Error(view.status);
    expect(view.counts.files).toEqual({ status: "unavailable" });
    expect(view.counts.tasks).toEqual({ status: "ok", count: 4 });
  });

  it("suggests the lead with a matter, counts the OTHER lead, and a chosen keeper wins", async () => {
    const counted: string[] = [];
    const r = reads({ [A]: lead(A, { email: "" }), [B]: lead(B, { email: "b@x.com" }) }, { matters: async (id) => (id === B ? [{ id: "m", label: "SANKOFA" }] : []), count: async (_k, id) => (counted.push(id), 1) });
    const view = await loadMergeView(A, B, null, r);
    if (view.status !== "ok") throw new Error(view.status);
    expect(view.keeper.id).toBe(B);
    expect(view.why).toBe("matter");
    expect(new Set(counted)).toEqual(new Set([A]));
    const chosen = await loadMergeView(A, B, A, r);
    if (chosen.status !== "ok") throw new Error(chosen.status);
    expect(chosen.keeper.id).toBe(A);
    expect(chosen.why).toBe("chosen");
    expect(chosen.loserMatters).toEqual([{ id: "m", label: "SANKOFA" }]);
    expect(chosen.fields.find((f) => f.field === "email")).toMatchObject({ same: false, choice: "loser" });
  });

  it("a keep= that is neither lead is ignored", async () => {
    const view = await loadMergeView(A, B, C, reads({ [A]: lead(A), [B]: lead(B, { created_at: "2025-01-01T00:00:00Z" }) }));
    if (view.status !== "ok") throw new Error(view.status);
    expect(view.keeper.id).toBe(B);
  });
});

describe("matchers and writers skip or follow merged leads", () => {
  it("a merged lead is never a possible duplicate", () => {
    const stages = [{ id: "s", name: "New", category: "open" }];
    const live = { id: A, first_name: "Ana", last_name: "Ruiz", email: "ana@x.com", current_stage_id: "s" };
    const merged = { id: B, first_name: "Ana", last_name: "Ruiz", email: "ana@x.com", current_stage_id: "s", merged_into_id: A };
    expect(findDuplicates([live, merged], [live, merged], stages)).toEqual({});
  });

  it("the Lawmatics importer neither updates nor re-creates a person whose lead was merged", () => {
    const stages = [{ id: "s", name: "New Lead", category: "open", orderIndex: 1 }];
    const ex = (o: Partial<ExistingLead>): ExistingLead => ({
      id: B,
      email: "old@x.com",
      first_name: "Ana",
      last_name: "Ruiz",
      phone: null,
      business_name: null,
      website: null,
      current_stage_id: "s",
      lawmatics_id: "LM-1",
      practice_area: null,
      referral_source: null,
      referral_detail: null,
      merged_into_id: A,
      ...o,
    });
    const src = (o: Record<string, unknown>) =>
      ({ lawmaticsId: "LM-1", matterName: null, firstName: "Ana", lastName: "Ruiz", email: "old@x.com", phone: null, businessName: null, website: null, stageName: null, practiceArea: null, createdAt: null, updatedAt: null, contactId: null, referralSource: null, ...o }) as never;
    const byId = planImport([src({})], stages as never, [ex({})]);
    expect(byId.updates).toEqual([]);
    expect(byId.creates).toEqual([]);
    expect(byId.skipped[0].reason).toBe(LEAD_MERGED_IMPORT_SKIP(null));
    const byEmail = planImport([src({ lawmaticsId: "LM-2" })], stages as never, [ex({ lawmatics_id: null })]);
    expect(byEmail.creates).toEqual([]);
    expect(byEmail.skipped[0].reason).toBe(LEAD_MERGED_IMPORT_SKIP(null));
    // With the keeper in the list, the reason names it.
    const keeper = ex({ id: A, email: "new@x.com", first_name: "Ana", last_name: "Ruiz-Keep", lawmatics_id: "LM-K", merged_into_id: null });
    const named = planImport([src({})], stages as never, [ex({}), keeper]);
    expect(named.skipped[0].reason).toBe(LEAD_MERGED_IMPORT_SKIP("Ana Ruiz-Keep"));
    expect(named.skipped[0].reason).toContain("Ana Ruiz-Keep");
  });

  it("Reconcile folds a merged lead's sheet key and Lawmatics id onto its keeper", async () => {
    const { foldMergedKeys } = await import("@/lib/reconcile/sources");
    const keeper = { id: A, firstName: "Ana", lastName: "Ruiz", email: "a@x.com", currentStageId: "s", sheetKey: "k-own", lawmaticsId: "LM-K", practiceArea: null };
    const out = foldMergedKeys([keeper], [{ into: A, sheetKey: "k-old", lawmaticsId: "LM-OLD" }, { into: "gone", sheetKey: "x", lawmaticsId: null }]);
    expect(out[0].mergedKeys).toEqual([{ sheetKey: "k-old", lawmaticsId: "LM-OLD" }]);
  });

  it("a sheet row held only by a merged lead matches its keeper; two keys reaching two rows is ambiguous", async () => {
    const { matchSheetToLeads } = await import("@/lib/reconcile/sheet-match");
    const entry = (key: string) => ({ exactKey: key, anyCodeKeys: [], reading: { kind: "ok" } }) as never;
    const old = entry("k-old");
    const one = matchSheetToLeads([old], [{ id: A, sheetKey: "k-own" }, { id: A, sheetKey: "k-old" }]);
    expect(one.byLead.get(A)).toEqual({ kind: "entry", entry: old });
    expect(one.withoutLead).toEqual([]);
    const two = matchSheetToLeads([entry("k-own"), old], [{ id: A, sheetKey: "k-own" }, { id: A, sheetKey: "k-old" }]);
    expect(two.byLead.get(A)?.kind).toBe("ambiguous");
  });

  it("the hired-matter sync follows a merged lead to its keeper (matter link and stage move)", () => {
    const prospect: HiredProspect = {
      lawmaticsId: "LM-9",
      name: "Ada Lovelace",
      email: "old@x.com",
      status: "Hired",
      convertedDate: "2026-11-02",
      caseNumber: "7",
      caseTitle: "ENGINE",
      trademarkName: null,
      practiceAreaField: null,
      practiceAreaName: "Trademark Law",
    };
    const leads: PlanLead[] = [
      { id: A, email: "new@x.com", lawmatics_id: null, current_stage_id: "o1", merged_into_id: null },
      { id: B, email: "old@x.com", lawmatics_id: "LM-9", current_stage_id: "o1", merged_into_id: A },
    ];
    const plan = planHiredSync({
      prospects: [prospect],
      matters: [],
      leads,
      stages: [{ id: "st1", label: "Signed LOE / Deposit Received" }],
      leadStages: [
        { id: "o1", name: "Proposal Sent", category: "open", order_index: 1 },
        { id: "w1", name: "Signed LOE / Deposit Received", category: "won", order_index: 2 },
      ],
    });
    expect(plan.create[0].lead_id).toBe(A);
    expect(plan.leadMoves.map((m) => m.leadId)).toEqual([A]);
  });
});
