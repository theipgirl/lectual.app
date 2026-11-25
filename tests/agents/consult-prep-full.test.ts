// S2b wiring: the consult prep run builds the FULL brief, emails it with its two files, saves the files, and falls back to the
// facts brief (withheld, then retried) when the build fails. No network, no real model, no Resend.

import { describe, expect, it, vi } from "vitest";
import { runConsultPrep } from "@/lib/agents/consult-prep/run";
import { isFullBrief } from "@/lib/consult-prep/adopt";
import { buildFullPrep } from "@/lib/consult-prep/full";
import type { PrepDeps } from "@/lib/consult-prep/engine";
import type { PrepFile } from "@/lib/consult-prep/attachments";
import type { InternalMail, InternalMailResult } from "@/lib/mail/internal-mail";
import type { StructuredCall } from "@/lib/ai/claude";
import type { QueueItem } from "@/lib/queue/api";
import { agentCtx, assertOrgFenced, NOW, ORG } from "./helpers";
import { memDb, type DbError, type Row, type Tables } from "./mem-db";
import type { Recorded } from "../mailbox/fake-db";
import { FIRM, JUDGMENT, PDF_BYTES, usptoFetch } from "../consult-prep/full-fixtures";
import type { RoutePlan } from "@/lib/consult-prep/judge/schemas";

const hours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

const PLAN: RoutePlan = { route: "TRADEMARK", routeReason: "Register the name.", secondaryMatter: null, markStatus: "confirmed", mark: "SANKOFA", stem: "sankofa", variants: [], likelyClasses: [{ classNumber: 32, rationale: "Beer." }] };

const event = (over: Row = {}): Row => ({ id: "e1", org_id: ORG, lead_id: "lead-1", source: "lawmatics", external_id: "lmsync:e1", is_consult: true, starts_at: hours(30), join_url: null, title: "Strategy session", created_at: ago(1), ...over });

const tables = (): Tables => ({
  crm_calendar_event: [event()],
  crm_lead: [{ id: "lead-1", org_id: ORG, first_name: "Dana", last_name: "Ruiz", business_name: "Sankofa Brewing", email: "dana@client.example", phone: null, practice_area: "Trademark", mark_text: "SANKOFA", referral_source: null, referral_detail: null, current_stage_id: "s-open", lawmatics_id: null }],
  crm_stage: [{ id: "s-open", org_id: ORG, name: "Discovery", category: "open", order_index: 1 }],
  crm_firm_brain_entry: [{ id: "b1", org_id: ORG, category: "other", key: "consult_prep_recipients", created_at: ago(5), data: { user_ids: ["u-attorney"], cc: [] } }],
  crm_activity: [],
  crm_file: [],
  crm_intake_submission: [],
  crm_booth_scorecard: [],
  crm_meeting: [],
  crm_org_profile: [],
});

/** A model call that answers each request in turn and records them (an Error is thrown). */
function model(...outputs: Array<unknown>) {
  const calls: Array<{ system: string; agent?: string }> = [];
  const llm = (async (req) => {
    calls.push({ system: req.system, agent: req.agent });
    const out = outputs[calls.length - 1];
    if (out === undefined || out instanceof Error) throw out ?? new Error("no answer scripted");
    return { output: out, model: "claude-sonnet-5-5", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, costUsd: 0.001 };
  }) as StructuredCall;
  return { llm, calls };
}

type Run = { now?: number; llm?: unknown[]; queue?: boolean; scope?: import("@/lib/agents/types").RunScope; mailOut?: (m: InternalMail) => Promise<InternalMailResult>; full?: boolean; withBuilder?: boolean; deps?: Partial<PrepDeps> };

/** One firm's world, run as many times as a test likes (the database, the sends and the saved files persist across runs). */
function world(initial: Tables = tables(), failures?: (q: Recorded) => DbError | undefined) {
  const db = memDb(initial, { failures });
  const sent: InternalMail[] = [];
  const saved = new Map<string, PrepFile[]>();
  const files = {
    save: vi.fn(async ({ prepKey, files: f }: { leadId: string; prepKey: string; files: readonly PrepFile[] }) => {
      if (saved.has(prepKey)) return { saved: 0, already: f.length, skipped: 0, failed: 0, unlogged: 0 };
      saved.set(prepKey, [...f]);
      return { saved: f.length, already: 0, skipped: 0, failed: 0, unlogged: 0 };
    }),
    load: vi.fn(async ({ prepKey }: { leadId: string; prepKey: string }) => ({ state: "ok" as const, files: saved.get(prepKey) ?? [] })),
  };
  const items: QueueItem[] = [];
  const run = async (r: Run = {}) => {
    const now = r.now ?? NOW;
    const handler: typeof db.handler = (q) => {
      if (q.action === "insert") q.values = (Array.isArray(q.values) ? q.values : [q.values]).map((v) => ({ created_at: new Date(now).toISOString(), ...(v as Row) }));
      return db.handler(q);
    };
    const m = model(...(r.llm ?? [PLAN, JUDGMENT]));
    const made = agentCtx(handler, {
      autonomy: "draft",
      queue: r.queue ?? true,
      llm: m.llm,
      // No client-prep template: the only model calls are the full build's.
      modules: ["mailbox"],
      listPending: async () => items.filter((i) => i.status === "pending"),
      listApproved: async () => [],
    });
    const ctx = made.ctx;
    ctx.now = () => now;
    if (r.scope) ctx.scope = r.scope;
    made.createDraft.mockImplementation(async (input) => {
      const item = { id: `q-${items.length + 1}`, org_id: ORG, matter_id: null, agent: input.agent, type: input.type, headline: input.headline, summary: input.summary ?? null, draft_body: input.draftBody, final_body: null, status: "pending", created_at: new Date(now).toISOString(), client_name: input.clientName ?? null, recipient: input.recipient ?? null, subject: input.subject ?? null, proposed_send_at: null, attachments: null, resolved_by: null, resolved_at: null, resolution_note: null } as QueueItem;
      items.push(item);
      return { id: item.id };
    });
    const builder = vi.fn((facts: Parameters<NonNullable<PrepDeps["full"]>>[0]) =>
      buildFullPrep(facts, FIRM, { llm: ctx.llm, fetch: usptoFetch().fetchImpl, timeLeftMs: () => Number.POSITIVE_INFINITY, now: ctx.now, renderPdf: async () => PDF_BYTES }),
    );
    const deps: PrepDeps = {
      mail: { apiKey: "re_key", from: "prep@lectual.example" },
      mailOut:
        r.mailOut ??
        (async (mail) => {
          sent.push(mail);
          return { status: "sent", id: `re_${sent.length}` };
        }),
      mailCancel: async () => ({ status: "cancelled" }),
      prospects: { client: async () => null },
      memberAddresses: async (ids) => ids.map((id) => `${id.replace("u-", "")}@firm.example`),
      ...(r.withBuilder === false ? {} : { full: builder }),
      files,
      ...r.deps,
    };
    const result = await runConsultPrep(ctx, deps);
    return { result, calls: m.calls, log: made.log, createDraft: made.createDraft, builder };
  };
  const markers = () => db.tables.crm_activity.filter((a) => a.type === "queue_drafted" && (a.payload as { source?: string }).source === "consult-prep");
  const sends = () => db.tables.crm_activity.filter((a) => a.type === "ai_insight" && (a.payload as { source?: string }).source === "consult-prep-send").map((a) => a.payload as Record<string, unknown>);
  return { db, sent, saved, files, items, run, markers, sends };
}

describe("consult prep builds the full brief (S2b)", () => {
  it("a new prep is built full: the full BRIEFING is queued, booked goes now and 24h / 1h are scheduled, each with both files; the files are saved once", async () => {
    const w = world();
    const { result, calls, log } = await w.run();
    assertOrgFenced(log);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.agent === "consult-prep")).toBe(true);
    expect(w.items).toHaveLength(1);
    expect(isFullBrief(w.items[0].draft_body ?? "")).toBe(true);
    const m = w.markers();
    expect(m).toHaveLength(1);
    expect(m[0].payload).toMatchObject({ kind: "brief", queueItemId: "q-1", full: true, attach: { uspto_xlsx: "built", packages_pdf: "built" } });
    expect(w.sent.map((s) => s.subject.split("Consult prep")[0])).toEqual(["", "Tomorrow: ", "In 1 hour: "]);
    for (const s of w.sent) {
      expect(s.attachments?.map((a) => a.filename).sort()).toEqual(["Dana_Ruiz_Packages_SANKOFA.pdf", "tmSearchResults2026-09-25.xlsx"]);
      expect(s.text).toContain("Likely classes — preliminary");
      expect(s.text).toContain("Attached: tmSearchResults2026-09-25.xlsx");
      expect(s.to).toEqual(["attorney@firm.example"]);
    }
    expect(w.sends().map((p) => [p.kind, p.status, p.quality ?? "full"])).toEqual([
      ["booked", "sent", "full"],
      ["24h", "scheduled", "full"],
      ["1h", "scheduled", "full"],
    ]);
    expect(w.files.save).toHaveBeenCalledTimes(1);
    expect(w.saved.get(m[0].payload ? (m[0].payload as { prep_key: string }).prep_key : "")?.length).toBe(2);
    expect(result.summary).toContain("1 full prep built.");
    expect(result.summary).toContain("2 files saved");
    // Counts only: no name, mark or file name in the summary.
    expect(result.summary).not.toMatch(/Dana|SANKOFA|tmSearch|Packages_/);
  });

  it("a model failure (either call) leaves the facts brief: booked and 24h are withheld, the 1h is facts only; the next run retries and sends them", async () => {
    for (const failing of [[new Error("down")], [PLAN, new Error("down")]]) {
      const w = world();
      const first = await w.run({ llm: failing });
      expect(isFullBrief(w.items[0].draft_body ?? "")).toBe(false);
      expect(w.markers()[0].payload).not.toHaveProperty("full");
      expect(w.sends().map((p) => [p.kind, p.status, p.quality ?? "full"])).toEqual([
        ["booked", "withheld", "full"],
        ["24h", "withheld", "full"],
        ["1h", "scheduled", "facts"],
      ]);
      expect(w.sent.every((s) => !s.attachments)).toBe(true);
      expect(first.result.summary).toMatch(/1 full prep couldn't be built \(the model call failed: 1\)/);
      expect(w.files.save).not.toHaveBeenCalled();

      // Next run, the model answers: the full prep is built (a second BRIEFING), the withheld emails go with the files, and the
      // facts-only 1 h email still waiting at Resend is cancelled and planned again with the full brief.
      const later = NOW + 2 * 3_600_000;
      const second = await w.run({ now: later });
      expect(second.calls).toHaveLength(2);
      expect(w.items).toHaveLength(2);
      expect(isFullBrief(w.items[1].draft_body ?? "")).toBe(true);
      const newest = w.markers().at(-1)!.payload as Record<string, unknown>;
      expect(newest).toMatchObject({ full: true, queueItemId: "q-2", attach: { uspto_xlsx: "built", packages_pdf: "built" } });
      const fresh = w.sent.slice(1);
      expect(fresh.map((s) => s.subject.startsWith("Facts only") ? "facts" : s.subject.split("Consult prep")[0])).toEqual(["", "Tomorrow: ", "In 1 hour: "]);
      for (const s of fresh) expect(s.attachments).toHaveLength(2);
      expect(second.result.summary).toContain("1 full prep built.");
      expect(w.files.save).toHaveBeenCalledTimes(1);
    }
  });

  it("a third run with nothing owed builds nothing and saves nothing again", async () => {
    const w = world();
    await w.run();
    const again = await w.run({ now: NOW + 3_600_000 });
    expect(again.calls).toHaveLength(0);
    expect(again.builder).not.toHaveBeenCalled();
    expect(w.files.save).toHaveBeenCalledTimes(1);
  });

  it("a reminder sent by a later run carries the saved copies (read back), and saves nothing", async () => {
    const w = world({ ...tables(), crm_calendar_event: [event({ starts_at: hours(80) })] });
    await w.run();
    // booked now and 24h scheduled; the 1 h (79 h away) is beyond the 72 h horizon and is left for a later run.
    expect(w.sends().map((p) => p.kind)).toEqual(["booked", "24h"]);
    const later = await w.run({ now: NOW + 10 * 3_600_000 });
    expect(later.builder).not.toHaveBeenCalled();
    expect(w.sends().map((p) => p.kind)).toEqual(["booked", "24h", "1h"]);
    const oneHour = w.sent.at(-1)!;
    expect(oneHour.subject.startsWith("In 1 hour: ")).toBe(true);
    expect(oneHour.attachments?.map((a) => a.filename).sort()).toEqual(["Dana_Ruiz_Packages_SANKOFA.pdf", "tmSearchResults2026-09-25.xlsx"]);
    expect(w.files.load).toHaveBeenCalledTimes(1);
    expect(w.files.save).toHaveBeenCalledTimes(1);
  });

  it("refused with its files: re-posted once without them under its own key, and the body names each missing file", async () => {
    const w = world();
    const posts: InternalMail[] = [];
    await w.run({
      mailOut: async (m) => {
        posts.push(m);
        if (m.attachments && m.attachments.length > 0) return { status: "failed", http: 422 };
        return { status: "sent", id: `re_${posts.length}` };
      },
    });
    const booked = posts.filter((p) => p.idempotencyKey?.endsWith(":booked") || p.idempotencyKey?.endsWith(":booked:noatt"));
    expect(booked).toHaveLength(2);
    expect(booked[0].attachments).toHaveLength(2);
    expect(booked[1].attachments).toBeUndefined();
    expect(booked[1].idempotencyKey).toBe(`${booked[0].idempotencyKey}:noatt`);
    expect(booked[1].text).toContain("USPTO search results workbook not attached: the mail service refused attachments on this email.");
    expect(booked[1].text).toContain("Packages PDF not attached: the mail service refused attachments on this email.");
    expect(w.sends().find((p) => p.kind === "booked")?.status).toBe("sent");
  });

  it("only a refusal that plausibly means the files (400, 413, 422) is re-posted without them", async () => {
    for (const http of [400, 413]) {
      const w = world();
      const posts: InternalMail[] = [];
      await w.run({ mailOut: async (m) => (posts.push(m), m.attachments ? { status: "failed", http } : { status: "sent", id: "x" }) });
      expect(posts.some((p) => p.idempotencyKey?.endsWith(":noatt"))).toBe(true);
    }
  });

  it("a duplicate (409), a rate limit (429), a bad key or sender (401, 403) or a timeout (408) is not re-posted without the files", async () => {
    for (const http of [401, 403, 408, 409, 429]) {
      const w = world();
      const posts: InternalMail[] = [];
      await w.run({ mailOut: async (m) => (posts.push(m), { status: "failed", http }) });
      expect(posts.every((p) => (p.attachments ?? []).length === 2)).toBe(true);
    }
  });

  it("a person's re-run builds a new full prep and sends its booked email with the files", async () => {
    const w = world();
    await w.run();
    const re = await w.run({ now: NOW + 60_000, scope: { leadIds: ["lead-1"], reason: "rerun" } });
    expect(re.calls).toHaveLength(2);
    expect(w.items).toHaveLength(2);
    const last = w.sent.at(-1)!;
    expect(last.idempotencyKey).toMatch(/:rerun:\d+:booked$/);
    expect(last.attachments).toHaveLength(2);
    expect(w.files.save).toHaveBeenCalledTimes(2);
    expect(w.files.save.mock.calls[1][0].prepKey).toMatch(/:rerun:\d+$/);
  });

  it("an adopted prep builds nothing new and attaches nothing", async () => {
    const full = "Consult prep for Dana Ruiz\n\nLikely classes\nClass 32 beer\n\nRisk read\nOne close mark\n\nPackage recommendation\nEnhanced";
    const w = world({ ...tables(), crm_activity: [{ id: "fm1", org_id: ORG, lead_id: "lead-1", type: "queue_drafted", created_at: new Date(NOW).toISOString(), payload: { source: "prep-consult", kind: "brief", queueItemId: "skill-1" } }] });
    w.items.push({ id: "skill-1", org_id: ORG, matter_id: null, agent: "prep-consult", type: "BRIEFING", headline: "Prep", summary: null, draft_body: full, final_body: null, status: "pending", created_at: new Date(NOW).toISOString(), client_name: "Dana Ruiz", recipient: null, subject: null, proposed_send_at: null, attachments: null, resolved_by: null, resolved_at: null, resolution_note: null } as QueueItem);
    const r = await w.run();
    expect(r.builder).not.toHaveBeenCalled();
    expect(r.calls).toHaveLength(0);
    expect(w.items).toHaveLength(1);
    expect(w.sent.length).toBeGreaterThan(0);
    for (const s of w.sent) {
      expect(s.attachments).toBeUndefined();
      expect(s.text).not.toContain("Attachments");
    }
    expect(w.files.save).not.toHaveBeenCalled();
  });

  it("without a builder (the facts brief only) nothing changes from S2a", async () => {
    const w = world();
    const r = await w.run({ withBuilder: false });
    expect(r.calls).toHaveLength(0);
    expect(w.sends().map((p) => p.status)).toEqual(["withheld", "withheld", "scheduled"]);
  });

  it("no approval queue: no build is tried (the full text could not be kept for later emails); the prep is S2a's facts prep, and the summary says so", async () => {
    const w = world();
    const r = await w.run({ queue: false });
    expect(r.calls).toHaveLength(0);
    expect(r.builder).not.toHaveBeenCalled();
    expect(w.sends().map((p) => [p.kind, p.status, p.quality ?? "full"])).toEqual([
      ["booked", "withheld", "full"],
      ["24h", "withheld", "full"],
      ["1h", "scheduled", "facts"],
    ]);
    expect(w.markers()[0].payload).not.toHaveProperty("full");
    expect(r.result.summary).toContain("got the facts brief only: a full prep is kept in Approvals for every email, and no approval queue is connected.");
  });

  it("the BRIEFING can't be queued: nothing is sent as full and nothing is marked (the next run tries again, within the attempt cap)", async () => {
    const w = world();
    w.items.push = () => {
      throw new Error("queue down");
    };
    const r = await w.run();
    expect(w.sent).toEqual([]);
    expect(w.markers()).toEqual([]);
    expect(w.files.save).not.toHaveBeenCalled();
    expect(r.result.summary).toContain("could not be prepped and will be tried again");
  });

  it("a marker that fails to write is repaired by the next run from the build record: no rebuild, no second BRIEFING", async () => {
    let failMarkers = true;
    const w = world(tables(), (q) =>
      failMarkers && q.table === "crm_activity" && q.action === "insert" && [q.values].flat().some((v) => (v as Row).type === "queue_drafted") ? { message: "x" } : undefined,
    );
    const first = await w.run();
    expect(first.calls).toHaveLength(2);
    expect(w.items).toHaveLength(1);
    expect(w.markers()).toHaveLength(0);
    failMarkers = false;
    const second = await w.run({ now: NOW + 3_600_000 });
    expect(second.calls).toHaveLength(0);
    expect(second.builder).not.toHaveBeenCalled();
    expect(w.items).toHaveLength(1);
    expect(w.markers()[0].payload).toMatchObject({ full: true, queueItemId: "q-1", attach: { uspto_xlsx: "built", packages_pdf: "built" } });
    expect(second.result.summary).toContain("recorded on the lead now (nothing rebuilt)");
    // And from then on it is an ordinary prepped consult.
    const third = await w.run({ now: NOW + 2 * 3_600_000 });
    expect(third.calls).toHaveLength(0);
    expect(w.items).toHaveLength(1);
  });

  it("a prep is built at most MAX_BUILD_ATTEMPTS times, however many runs see it owed", async () => {
    const w = world();
    let total = 0;
    for (let i = 0; i < 6; i += 1) {
      const r = await w.run({ now: NOW + i * 600_000, llm: [new Error("down")] });
      total += r.calls.length;
    }
    expect(total).toBe(3);
    const builds = w.db.tables.crm_activity.filter((a) => (a.payload as { source?: string }).source === "consult-prep-build");
    expect(builds.filter((b) => (b.payload as { status?: string }).status === "started")).toHaveLength(3);
  });

  it("a later email whose saved copy can't be read says so (not 'could not be built')", async () => {
    const w = world({ ...tables(), crm_calendar_event: [event({ starts_at: hours(80) })] });
    await w.run();
    w.files.load.mockImplementation(async () => ({ state: "ok" as const, files: [] }));
    await w.run({ now: NOW + 10 * 3_600_000 });
    const oneHour = w.sent.at(-1)!;
    expect(oneHour.attachments).toBeUndefined();
    expect(oneHour.text).toContain("USPTO search results workbook not attached: the saved copy couldn't be read for this email.");
    expect(oneHour.text).toContain("Packages PDF not attached: the saved copy couldn't be read for this email.");
    expect(oneHour.text).not.toContain("could not be built");
  });
});

describe("S2c: the switch-over", () => {
  it("a consult lawmatics-mcp already briefed is still BUILT, queued, marked and its files saved; only the emails are left out", async () => {
    // NOW + 30 h: lawmatics-mcp (cut over at NOW, Fri 8 AM EDT) had its 24 h brief; Lectual's 1 h email (29 h) is past its reach.
    const w = world();
    const { calls } = await w.run({ deps: { cutoverAtMs: NOW } });
    expect(calls).toHaveLength(2);
    expect(w.items).toHaveLength(1);
    expect(w.markers()[0].payload).toMatchObject({ full: true });
    expect(w.files.save).toHaveBeenCalledTimes(1);
    expect(w.sends().map((p) => [p.kind, p.status])).toEqual([
      ["booked", "superseded"],
      ["24h", "superseded"],
      ["1h", "scheduled"],
    ]);
  });

  it("a person's re-run is exempt: they asked for that email, and lawmatics-mcp sends no booked email it could double", async () => {
    const w = world();
    await w.run({ deps: { cutoverAtMs: NOW } });
    await w.run({ now: NOW + 60_000, scope: { leadIds: ["lead-1"], reason: "rerun" }, deps: { cutoverAtMs: NOW } });
    const last = w.sent.at(-1)!;
    expect(last.idempotencyKey).toMatch(/:rerun:\d+:booked$/);
    expect(w.sends().filter((p) => String(p.prep_key).includes(":rerun:")).map((p) => p.status)).toEqual(["sent"]);
  });
});
