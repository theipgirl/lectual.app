import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runStageKeeper, PERSON_MOVE_DAYS } from "../../src/lib/agents/stage-keeper/run";
import { runOneAgent } from "../../src/lib/agents/runner";
import { SENSITIVE_PHRASES } from "../../src/lib/intake/email-match";
import { fakeAdmin } from "../mailbox/fake-db";
import { assertOrgFenced, fakeLlm, NOW } from "../agents/helpers";
import {
  agentRows,
  event,
  keeperWorld,
  lead,
  mail,
  messageIdOf,
  personMove,
  stageRows,
  suggestionRows,
  type Row,
} from "./db";
import { L, ORG, OTHER_ORG, S, SENTINEL, daysAgo } from "./fixtures";

let consoleSpy: ReturnType<typeof vi.spyOn>[];
beforeEach(() => {
  consoleSpy = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
});
afterEach(() => {
  vi.restoreAllMocks();
});
const consoleOutput = () => consoleSpy.flatMap((s) => s.mock.calls).map((c) => c.map(String).join(" ")).join("\n");
const written = (log: { action: string; values?: unknown }[]) => JSON.stringify(log.filter((q) => q.action !== "select").map((q) => q.values));
const leadOf = (w: ReturnType<typeof keeperWorld>, id = L.amara) => w.db.tables.crm_lead.find((l) => l.id === id)!;

describe("F8 autonomy, F9 move semantics", () => {
  it("act moves the lead to the stage the mail names, once, and logs it with the evidence", async () => {
    const loe = mail(L.amara, "loe-invoice", { at: daysAgo(2), subject: "Your engagement letter" });
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [loe] });
    const { ctx, createDraft, llmCalls } = w.ctx("act");
    const result = await runStageKeeper(ctx);

    expect(leadOf(w).current_stage_id).toBe(S.loe);
    expect(result).toMatchObject({ itemsIn: 1, draftsOut: 0 });
    expect(result.summary).toBe("1 lead(s) read: 1 moved, 0 suggestion(s) written.");
    const [move] = agentRows(w.rows("crm_activity"));
    expect(move.actor_type).toBe("ai");
    expect(move.payload).toMatchObject({
      actor: "agent:stage-keeper",
      from_stage_id: S.newPnc,
      to_stage_id: S.loe,
      signal_key: `${L.amara}:mail:${messageIdOf(loe)}`,
      previous_stage_entered_at: daysAgo(10),
      evidence: { kind: "mail", type: "loe-invoice", direction: "outbound", at: loe.payload.at, subject: "Your engagement letter" },
    });
    expect(createDraft).not.toHaveBeenCalled();
    expect(llmCalls).toHaveLength(0);
  });

  it("stage_entered_at is the message date, last_activity_at is now", async () => {
    const at = daysAgo(4);
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "post-consult", { at })] });
    await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w)).toMatchObject({ current_stage_id: S.post, stage_entered_at: at, last_activity_at: new Date(NOW).toISOString() });
  });

  it("suggest and draft write a suggestion card and change no lead column; act with the same data moves", async () => {
    for (const autonomy of ["suggest", "draft"] as const) {
      const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "loe-invoice")] });
      const { ctx, log, createDraft } = w.ctx(autonomy);
      const result = await runStageKeeper(ctx);
      expect(leadOf(w)).toMatchObject({ current_stage_id: S.newPnc, stage_entered_at: daysAgo(10) });
      expect(log.some((q) => q.table === "crm_lead" && q.action === "update")).toBe(false);
      expect(result).toMatchObject({ itemsIn: 1, draftsOut: 1 });
      const [card] = suggestionRows(w.rows("crm_activity"));
      expect(card).toMatchObject({ type: "ai_insight", actor_type: "ai" });
      expect(card.payload).toMatchObject({ source: "stage-keeper", kind: "stage_suggestion", to_stage_id: S.loe, from_stage_id: S.newPnc, why: "autonomy", autonomy });
      expect(agentRows(w.rows("crm_activity"))).toEqual([]);
      expect(createDraft, autonomy).not.toHaveBeenCalled();
    }
  });

  it("never queues a draft or calls a model in any mode, and writes nothing to a client", async () => {
    for (const autonomy of ["suggest", "draft", "act"] as const) {
      const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "loe-invoice")] });
      const { ctx, createDraft, llmCalls, log } = w.ctx(autonomy, true);
      await runStageKeeper(ctx);
      expect(createDraft).not.toHaveBeenCalled();
      expect(llmCalls).toHaveLength(0);
      expect(log.some((q) => q.table === "agent_approval_queue" || /queue|draft/.test(q.table))).toBe(false);
    }
  });

  it("copies nothing but type, direction, date and subject out of the mail: a sentinel in every other field never lands anywhere", async () => {
    const w = keeperWorld({
      leads: [lead(L.amara, S.newPnc), lead(L.kwame, S.newPnc)],
      activity: [mail(L.amara, "loe-invoice", { subject: "Engagement letter" })],
      events: [event(L.kwame, { title: "Strategy session" })],
    });
    const { ctx, log } = w.ctx("act");
    const result = await runStageKeeper(ctx);
    expect(agentRows(w.rows("crm_activity"))).toHaveLength(2);
    expect(written(log)).not.toContain(SENTINEL);
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
    expect(consoleOutput()).not.toContain(SENTINEL);
    const evidence = agentRows(w.rows("crm_activity")).map((r) => r.payload.evidence);
    expect(evidence).toContainEqual({ kind: "calendar", title: "Strategy session", starts_at: expect.any(String) });
    for (const e of evidence) expect(Object.keys(e).sort()).toEqual(e.kind === "mail" ? ["at", "direction", "kind", "subject", "type"] : ["kind", "starts_at", "title"]);
  });

  it("a suggestion carries the same small evidence and no sentinel", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "loe-invoice")] });
    const { ctx, log } = w.ctx("suggest");
    await runStageKeeper(ctx);
    expect(written(log)).not.toContain(SENTINEL);
    expect(Object.keys(suggestionRows(w.rows("crm_activity"))[0].payload.evidence).sort()).toEqual(["at", "direction", "kind", "subject", "type"]);
  });
});

describe("calendar consults", () => {
  it("a booked future consult moves the lead to Consultation Scheduled, stamped with the run time", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], events: [event(L.amara)] });
    await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w)).toMatchObject({ current_stage_id: S.consult, stage_entered_at: new Date(NOW).toISOString() });
    const [move] = agentRows(w.rows("crm_activity"));
    expect(move.payload.signal_key).toMatch(new RegExp(`^${L.amara}:calendar:event-`));
    expect(move.payload.evidence.kind).toBe("calendar");
  });

  it("a past consult, an unlinked one and a non-consult event place nobody", async () => {
    const w = keeperWorld({
      leads: [lead(L.amara, S.newPnc), lead(L.kwame, S.newPnc), lead(L.priya, S.newPnc)],
      events: [event(L.amara, { starts_at: daysAgo(2) }), event(null), event(L.priya, { is_consult: false })],
    });
    const result = await runStageKeeper(w.ctx("act").ctx);
    expect(result.itemsIn).toBe(0);
    expect(agentRows(w.rows("crm_activity"))).toEqual([]);
  });

  it("a consult whose title carries a sensitive phrase holds the lead back", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], events: [event(L.amara, { title: "Settlement call" })] });
    const result = await runStageKeeper(w.ctx("act").ctx);
    expect(result.summary).toContain("1 held back as sensitive");
    expect(leadOf(w).current_stage_id).toBe(S.newPnc);
  });
});

describe("F6 a person's placement wins", () => {
  const withPerson = async (daysBack: number | null, over: Row = {}) => {
    const w = keeperWorld({
      leads: [lead(L.amara, S.pnc)],
      activity: [mail(L.amara, "loe-invoice"), ...(daysBack === null ? [] : [personMove(L.amara, daysBack, over)])],
    });
    const result = await runStageKeeper(w.ctx("act").ctx);
    return { w, result };
  };

  it("moved by a person 6 days ago: a suggestion, no move", async () => {
    const { w, result } = await withPerson(PERSON_MOVE_DAYS - 1);
    expect(leadOf(w).current_stage_id).toBe(S.pnc);
    expect(result).toMatchObject({ itemsIn: 1, draftsOut: 1 });
    expect(suggestionRows(w.rows("crm_activity"))[0].payload).toMatchObject({ why: "recent-person-move", to_stage_id: S.loe });
  });

  it("exactly 7 days ago still counts as the last 7 days", async () => {
    const { w } = await withPerson(PERSON_MOVE_DAYS);
    expect(leadOf(w).current_stage_id).toBe(S.pnc);
    expect(suggestionRows(w.rows("crm_activity"))).toHaveLength(1);
  });

  it("8 days ago: moved", async () => {
    const { w } = await withPerson(PERSON_MOVE_DAYS + 1);
    expect(leadOf(w).current_stage_id).toBe(S.loe);
    expect(suggestionRows(w.rows("crm_activity"))).toEqual([]);
  });

  it("no person move at all: moved", async () => {
    expect(leadOf((await withPerson(null)).w).current_stage_id).toBe(S.loe);
  });

  it("the agent's own earlier move does not count as a person's", async () => {
    const own = personMove(L.amara, 1, {
      id: "agent-earlier",
      actor_type: "ai",
      payload: { actor: "agent:stage-keeper", from_stage_id: S.newPnc, to_stage_id: S.pnc, signal_key: `${L.amara}:mail:other` },
    });
    const w = keeperWorld({ leads: [lead(L.amara, S.pnc)], activity: [mail(L.amara, "loe-invoice"), own] });
    await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(S.loe);
  });

  it("a system stage change (an automation, a signed quote) is not a person's either", async () => {
    const { w } = await withPerson(1, { actor_type: "system" });
    expect(leadOf(w).current_stage_id).toBe(S.loe);
  });
});

describe("F7 each signal is used once", () => {
  it("running twice over the same data writes the move once", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "loe-invoice")] });
    const first = await runStageKeeper(w.ctx("act").ctx);
    const second = await runStageKeeper(w.ctx("act").ctx);
    expect(first.itemsIn).toBe(1);
    expect(second.itemsIn).toBe(0);
    expect(agentRows(w.rows("crm_activity"))).toHaveLength(1);
  });

  it("running twice under suggest writes the card once", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "loe-invoice")] });
    await runStageKeeper(w.ctx("suggest").ctx);
    await runStageKeeper(w.ctx("suggest").ctx);
    expect(suggestionRows(w.rows("crm_activity"))).toHaveLength(1);
  });

  it("a signal an accepted or a dismissed suggestion used is not used again", async () => {
    for (const decision of ["apply", "dismiss"]) {
      const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "loe-invoice")] });
      await runStageKeeper(w.ctx("suggest").ctx);
      const [card] = suggestionRows(w.rows("crm_activity"));
      w.rows("crm_activity").push({
        id: `review-${decision}`,
        org_id: ORG,
        lead_id: L.amara,
        type: "ai_insight",
        actor_type: "user",
        created_at: daysAgo(0),
        payload: { source: "stage-keeper-review", suggestion_id: card.id, decision },
      });
      const again = await runStageKeeper(w.ctx("act").ctx);
      expect(again.itemsIn, decision).toBe(0);
      expect(suggestionRows(w.rows("crm_activity"))).toHaveLength(1);
      expect(agentRows(w.rows("crm_activity"))).toEqual([]);
      expect(leadOf(w).current_stage_id).toBe(S.newPnc);
    }
  });

  it("a signal an undone move used is not used again, and nothing is suggested for it either", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "loe-invoice")] });
    await runStageKeeper(w.ctx("act").ctx);
    // A person undoes it, a long time ago for the 7-day rule to be out of the way.
    leadOf(w).current_stage_id = S.newPnc;
    w.rows("crm_activity").push(personMove(L.amara, 20, { id: "undo", created_at: daysAgo(20) }));
    const again = await runStageKeeper(w.ctx("act").ctx);
    expect(again.itemsIn).toBe(0);
    expect(agentRows(w.rows("crm_activity"))).toHaveLength(1);
    expect(suggestionRows(w.rows("crm_activity"))).toEqual([]);
    expect(leadOf(w).current_stage_id).toBe(S.newPnc);
  });

  it("two signals for one lead in one run give exactly one action", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "questionnaire"), mail(L.amara, "loe-invoice")], events: [event(L.amara)] });
    const result = await runStageKeeper(w.ctx("act").ctx);
    expect(result.itemsIn).toBe(1);
    expect(agentRows(w.rows("crm_activity"))).toHaveLength(1);
    expect(leadOf(w).current_stage_id).toBe(S.loe);
  });

  it("a pending suggestion for a stage is not written a second time by a newer signal for the same stage", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "loe-invoice", { id: "a" })] });
    await runStageKeeper(w.ctx("suggest").ctx);
    w.rows("crm_activity").push(mail(L.amara, "loe-invoice", { id: "b", at: daysAgo(1) }));
    const second = await runStageKeeper(w.ctx("suggest").ctx);
    expect(second.summary).toContain("1 already waiting");
    expect(suggestionRows(w.rows("crm_activity"))).toHaveLength(1);
  });

  it("mail older than the 30-day window is not a signal", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "loe-invoice", { at: daysAgo(40) })] });
    expect((await runStageKeeper(w.ctx("act").ctx)).itemsIn).toBe(0);
  });

  it("inbound mail alone places nobody", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "loe-invoice", { direction: "inbound" })] });
    expect((await runStageKeeper(w.ctx("act").ctx)).itemsIn).toBe(0);
    expect(leadOf(w).current_stage_id).toBe(S.newPnc);
  });
});

describe("F4 won, lost and nurture", () => {
  const brain = (stageName: string, key = "loe-invoice-sent"): Row[] => [{ org_id: ORG, category: "stage_mapping", key, body: "", data: { stage: stageName } }];

  it("a signal that maps to the won stage is a suggestion under act, with no move, no matter and no sequence stop", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "loe-invoice")], brain: brain("Signed LOE / Deposit Received") });
    const { ctx, log } = w.ctx("act");
    await runStageKeeper(ctx);
    expect(leadOf(w).current_stage_id).toBe(S.newPnc);
    expect(suggestionRows(w.rows("crm_activity"))[0].payload).toMatchObject({ why: "won", to_stage_id: S.signed });
    expect(log.some((q) => q.table === "crm_lead" && q.action === "update")).toBe(false);
    expect(log.some((q) => /matter|drip/.test(q.table))).toBe(false);
  });

  it("lost and nurture targets are suggestions in every mode", async () => {
    for (const [name, why] of [["Lost", "lost"], ["Nurture", "nurture"]] as const) {
      for (const autonomy of ["suggest", "draft", "act"] as const) {
        const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "loe-invoice")], brain: brain(name) });
        await runStageKeeper(w.ctx(autonomy).ctx);
        expect(leadOf(w).current_stage_id, `${name} ${autonomy}`).toBe(S.newPnc);
        expect(suggestionRows(w.rows("crm_activity"))[0].payload.why).toBe(autonomy === "act" ? why : why);
      }
    }
  });

  it("a welcome signal at most suggests", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "welcome")], brain: brain("Undecided / Questions", "welcome-sent") });
    await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(S.newPnc);
    expect(suggestionRows(w.rows("crm_activity"))[0].payload.why).toBe("welcome-or-payment");
  });

  it("a lead already in the won stage gets nothing, and one in a nurture stage gets a card only", async () => {
    const stages = [
      ...stageRows().filter((s) => s.id !== S.nurture),
      { id: "n-early", org_id: ORG, name: "Follow-Up", category: "nurture", order_index: 0 },
    ];
    const w = keeperWorld({
      stages,
      leads: [lead(L.amara, S.signed), lead(L.kwame, "n-early")],
      activity: [mail(L.amara, "loe-invoice"), mail(L.kwame, "loe-invoice")],
    });
    await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w, L.amara).current_stage_id).toBe(S.signed);
    expect(leadOf(w, L.kwame).current_stage_id).toBe("n-early");
    const cards = suggestionRows(w.rows("crm_activity"));
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ lead_id: L.kwame });
    expect(cards[0].payload.why).toBe("current-stage");
  });
});

describe("F5 sensitive mail", () => {
  it("each phrase on any message in the window stops that lead, and not the next one", async () => {
    for (const phrase of SENSITIVE_PHRASES) {
      const w = keeperWorld({
        leads: [lead(L.amara, S.newPnc), lead(L.kwame, S.newPnc)],
        activity: [
          mail(L.amara, "loe-invoice"),
          mail(L.amara, "other", { direction: "inbound", sensitive: true, subject: `Re: ${phrase}` }),
          mail(L.kwame, "loe-invoice"),
        ],
      });
      const result = await runStageKeeper(w.ctx("act").ctx);
      expect(leadOf(w, L.amara).current_stage_id, phrase).toBe(S.newPnc);
      expect(leadOf(w, L.kwame).current_stage_id, phrase).toBe(S.loe);
      expect(result.summary, phrase).toContain("1 held back as sensitive");
      expect(suggestionRows(w.rows("crm_activity")).filter((r) => r.lead_id === L.amara)).toEqual([]);
    }
  });

  it("a sensitive message an earlier run already looked at keeps holding the lead back", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "loe-invoice"), mail(L.amara, "other", { sensitive: true, direction: "inbound" })] });
    await runStageKeeper(w.ctx("suggest").ctx);
    await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(S.newPnc);
    expect(w.rows("crm_activity").filter((r) => r.actor_type === "ai")).toEqual([]);
  });
});

describe("F10 org fence, F11 lane", () => {
  it("every statement names the firm, and another firm's leads, mail and stages are never touched", async () => {
    const w = keeperWorld({
      leads: [lead(L.amara, S.newPnc), lead(L.other, S.newPnc, { org_id: OTHER_ORG })],
      activity: [mail(L.amara, "loe-invoice"), { ...mail(L.other, "loe-invoice"), org_id: OTHER_ORG }],
      events: [event(L.amara), { ...event(L.other), org_id: OTHER_ORG }],
    });
    const { ctx, log } = w.ctx("act");
    await runStageKeeper(ctx);
    expect(() => assertOrgFenced(log)).not.toThrow();
    expect(leadOf(w, L.other).current_stage_id).toBe(S.newPnc);
    expect(agentRows(w.rows("crm_activity")).every((r) => r.org_id === ORG)).toBe(true);
    expect(log.filter((q) => q.action === "update").every((q) => q.filters.some((f) => f.column === "org_id" && f.value === ORG))).toBe(true);
  });

  it("a stale decision writes nothing: the lead was moved between the read and the write", async () => {
    const w = keeperWorld({
      leads: [lead(L.amara, S.newPnc)],
      activity: [mail(L.amara, "loe-invoice")],
      beforeWrite: (q, db) => {
        if (q.table === "crm_lead" && q.action === "update") db.tables.crm_lead[0].current_stage_id = S.pnc;
      },
    });
    const result = await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(S.pnc);
    expect(agentRows(w.rows("crm_activity"))).toEqual([]);
    expect(result.summary).toContain("1 changed by a person first");
  });

  it("no write from the agent names a lane column", async () => {
    for (const autonomy of ["suggest", "act"] as const) {
      const w = keeperWorld({ leads: [lead(L.amara, S.newPnc, { lane: "hot" })], activity: [mail(L.amara, "loe-invoice")], events: [event(L.amara)] });
      const { ctx, log } = w.ctx(autonomy);
      await runStageKeeper(ctx);
      expect(written(log), autonomy).not.toMatch(/lane/);
      expect(leadOf(w).lane).toBe("hot");
    }
  });
});

describe("F12 run lifecycle", () => {
  function deps(w: ReturnType<typeof keeperWorld>) {
    const { client, log } = fakeAdmin(w.handler);
    const createDraft = vi.fn(async () => ({ id: "q" }));
    return { log, createDraft, deps: { admin: client as unknown as SupabaseClient, llm: fakeLlm({}).llm, createDraft, now: () => NOW } };
  }
  const args = { orgId: ORG, agent: "stage-keeper" as const, autonomy: "act" as const, trigger: "event" as const };

  it("one agent_run row per run, finished with counts and a counts-only summary", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "loe-invoice", { subject: SENTINEL })], extra: { agent_run: [], agent_autopilot: [] } });
    const d = deps(w);
    const out = await runOneAgent(d.deps, args);
    expect(out.status).toBe("ok");
    const runs = w.rows("agent_run");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ agent: "stage-keeper", trigger: "event", status: "ok", items_in: 1, drafts_out: 0, error: null });
    expect(runs[0].summary).toBe("1 lead(s) read: 1 moved, 0 suggestion(s) written.");
    expect(JSON.stringify(runs)).not.toContain(SENTINEL);
  });

  it("a required read that throws ends the run as an error and touches no lead", async () => {
    const w = keeperWorld({
      leads: [lead(L.amara, S.newPnc)],
      activity: [mail(L.amara, "loe-invoice")],
      extra: { agent_run: [], agent_autopilot: [] },
      refuse: (q) => (q.table === "crm_stage" ? { message: "stages boom" } : undefined),
    });
    const d = deps(w);
    const out = await runOneAgent(d.deps, args);
    expect(out).toMatchObject({ status: "error", error: expect.stringContaining("stages boom") });
    expect(w.rows("agent_run")[0]).toMatchObject({ status: "error" });
    expect(d.log.some((q) => q.table === "crm_lead" && q.action === "update")).toBe(false);
    expect(leadOf(w).current_stage_id).toBe(S.newPnc);
  });

  it("each required read, in turn, ends the run as an error before any lead is touched", async () => {
    for (const table of ["crm_firm_brain_entry", "crm_activity", "crm_lead"]) {
      const w = keeperWorld({
        leads: [lead(L.amara, S.newPnc)],
        activity: [mail(L.amara, "loe-invoice")],
        extra: { agent_run: [], agent_autopilot: [] },
        refuse: (q) => (q.table === table && q.action === "select" ? { message: "boom" } : undefined),
      });
      const out = await runOneAgent(deps(w).deps, args);
      expect(out.status, table).toBe("error");
      expect(leadOf(w).current_stage_id, table).toBe(S.newPnc);
    }
  });

  it("an agent_run insert that is refused (lectual 0098 not applied) does not stop the run", async () => {
    const w = keeperWorld({
      leads: [lead(L.amara, S.newPnc)],
      activity: [mail(L.amara, "loe-invoice")],
      extra: { agent_autopilot: [] },
      refuse: (q) => (q.table === "agent_run" ? { message: "violates check constraint agent_run_agent", code: "23514" } : undefined),
    });
    const out = await runOneAgent(deps(w).deps, args);
    expect(out.status).toBe("ok");
    expect(out.runId).toBeNull();
    expect(leadOf(w).current_stage_id).toBe(S.loe);
  });

  it("D6: with the calendar columns and the agent_run insert both refused, mail evidence alone still moves the lead and nothing throws", async () => {
    const w = keeperWorld({
      leads: [lead(L.amara, S.newPnc), lead(L.kwame, S.newPnc)],
      activity: [mail(L.amara, "loe-invoice")],
      events: [event(L.kwame)],
      extra: { agent_autopilot: [] },
      refuse: (q) => {
        if (q.table === "crm_calendar_event") return { message: 'column "is_consult" does not exist', code: "42703" };
        if (q.table === "agent_run") return { message: "check", code: "23514" };
        return undefined;
      },
    });
    const out = await runOneAgent(deps(w).deps, args);
    expect(out.status).toBe("ok");
    expect(leadOf(w, L.amara).current_stage_id).toBe(S.loe);
    expect(leadOf(w, L.kwame).current_stage_id).toBe(S.newPnc);
    expect(out.result?.summary).toContain("Calendar consults: not available until the database update.");
  });

  it("a calendar read that fails some other way is reported as such and mail still works", async () => {
    const w = keeperWorld({
      leads: [lead(L.amara, S.newPnc)],
      activity: [mail(L.amara, "loe-invoice")],
      refuse: (q) => (q.table === "crm_calendar_event" ? { message: "timeout", code: "57014" } : undefined),
    });
    const result = await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(S.loe);
    expect(result.summary).toContain("Calendar consults couldn't be read this run.");
  });

  it("a failed write ends the run as an error with counts only", async () => {
    const w = keeperWorld({
      leads: [lead(L.amara, S.newPnc)],
      activity: [mail(L.amara, "loe-invoice", { subject: SENTINEL })],
      refuse: (q) => (q.table === "crm_lead" && q.action === "update" ? { message: "write boom" } : undefined),
    });
    await expect(runStageKeeper(w.ctx("act").ctx)).rejects.toThrow(/1 lead move\(s\) failed/);
    try {
      await runStageKeeper(w.ctx("act").ctx);
    } catch (err) {
      expect(String(err)).not.toContain(SENTINEL);
    }
  });

  it("nothing to place is said plainly and is not an error", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)] });
    expect(await runStageKeeper(w.ctx("act").ctx)).toEqual({ itemsIn: 0, draftsOut: 0, summary: "No matched mail or booked consults to place." });
  });
});

describe("the brain mapping", () => {
  it("a firm's stage_mapping entry decides the stage", async () => {
    const w = keeperWorld({
      leads: [lead(L.amara, S.newPnc)],
      activity: [mail(L.amara, "loe-invoice")],
      brain: [{ org_id: ORG, category: "stage_mapping", key: "loe-invoice-sent", body: "", data: { stage: "Undecided / Questions" } }],
    });
    await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(S.undecided);
  });

  it("another firm's brain entry is never read", async () => {
    const w = keeperWorld({
      leads: [lead(L.amara, S.newPnc)],
      activity: [mail(L.amara, "loe-invoice")],
      brain: [{ org_id: OTHER_ORG, category: "stage_mapping", key: "loe-invoice-sent", body: "", data: { stage: "Undecided / Questions" } }],
    });
    await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(S.loe);
  });
});

