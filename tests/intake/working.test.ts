import { describe, it, expect } from "vitest";
import {
  classifyLeads,
  effectiveView,
  firstContactBoundary,
  inWorkingView,
  isEventSource,
  isFollowUpStage,
  isPastFirstContact,
  leadsWithLiveProposal,
  parseWorkingView,
  type FactSet,
  type WorkingFacts,
  type WorkingLead,
  type WorkingStage,
} from "@/lib/intake/working";

// RPB's shape: Follow-Up sorts first, then the new-enquiry stage, then the real pipeline.
const stages: WorkingStage[] = [
  { id: "fu", name: "Follow-Up", category: "open", order_index: 1 },
  { id: "pnc", name: "Potential New Client", category: "open", order_index: 2 },
  { id: "cs", name: "Consult Scheduled", category: "open", order_index: 3 },
  { id: "ch", name: "Consult Held", category: "open", order_index: 4 },
  { id: "pe", name: "Post Consultation Email Sent", category: "open", order_index: 5 },
  { id: "nur", name: "Nurture", category: "nurture", order_index: 6 },
  { id: "won", name: "Signed LOE / Deposit Received", category: "won", order_index: 7 },
  { id: "lost", name: "Lost", category: "lost", order_index: 8 },
];

const ok = (...ids: string[]): FactSet => ({ status: "ok", leadIds: new Set(ids) });
const none: FactSet = ok();
const facts = (over: Partial<WorkingFacts> = {}): WorkingFacts => ({ activity: none, approvals: none, proposals: none, consults: none, booth: none, ...over });
const lead = (id: string, stage: string, source: string | null = null): WorkingLead => ({ id, current_stage_id: stage, referral_source: source });

function kind(res: ReturnType<typeof classifyLeads>, id: string) {
  if (res.status !== "ok") throw new Error("unavailable");
  return res.byLead.get(id)!;
}

describe("first-contact boundary", () => {
  it("is the furthest of the new-enquiry stage and any open Follow-Up stage", () => {
    expect(firstContactBoundary(stages)).toEqual({ stageId: "pnc", position: 1 });
    // A Follow-Up stage placed after the enquiry stage moves the boundary to it.
    const late = stages.map((s) => (s.id === "fu" ? { ...s, order_index: 2.5 } : s));
    expect(firstContactBoundary(late)?.stageId).toBe("fu");
  });
  it("recognises Follow-Up by name, ignoring numbering and punctuation", () => {
    expect(isFollowUpStage({ name: "4. Follow up" })).toBe(true);
    expect(isFollowUpStage({ name: "Follow-Up" })).toBe(true);
    expect(isFollowUpStage({ name: "Following" })).toBe(false);
  });
  it("past first contact is strictly beyond, open stages only", () => {
    expect(isPastFirstContact("fu", stages)).toBe(false);
    expect(isPastFirstContact("pnc", stages)).toBe(false);
    expect(isPastFirstContact("cs", stages)).toBe(true);
    expect(isPastFirstContact("won", stages)).toBe(false);
    expect(isPastFirstContact(null, stages)).toBe(false);
  });
  it("a firm with no open stage has no boundary", () => {
    expect(firstContactBoundary([{ id: "w", name: "Won", category: "won", order_index: 1 }])).toBeNull();
  });
});

describe("classifyLeads: the RPB shape", () => {
  it("follow-up / PNC leads with no activity are Not started, or Event contacts by source or booth", () => {
    const res = classifyLeads({
      leads: [lead("a", "fu"), lead("b", "pnc"), lead("c", "pnc", "UGW"), lead("d", "pnc", " event "), lead("e", "fu", "Instagram"), lead("f", "pnc")],
      stages,
      facts: facts({ booth: ok("f") }),
    });
    expect(kind(res, "a").kind).toBe("not_started");
    expect(kind(res, "b").kind).toBe("not_started");
    expect(kind(res, "c")).toMatchObject({ kind: "event", viaSource: true, viaBooth: false });
    expect(kind(res, "d").kind).toBe("event");
    expect(kind(res, "e").kind).toBe("not_started");
    expect(kind(res, "f")).toMatchObject({ kind: "event", viaBooth: true });
    if (res.status !== "ok") throw new Error();
    expect(res.counts).toMatchObject({ working: 0, eventContacts: 3, notStarted: 3, open: 6 });
  });

  it("an importer or agent stage move is not activity (the loader never reports it), so the lead stays Not started", () => {
    // The loader reports lead ids only for real activity; an importer-only lead is simply absent.
    const res = classifyLeads({ leads: [lead("a", "pnc")], stages, facts: facts({ activity: ok() }) });
    expect(kind(res, "a").kind).toBe("not_started");
  });

  it("real activity makes a lead Working even in the first stage", () => {
    const res = classifyLeads({ leads: [lead("a", "pnc", "UGW"), lead("b", "pnc")], stages, facts: facts({ activity: ok("a") }) });
    expect(kind(res, "a")).toEqual({ kind: "working", reasons: ["activity"] });
    expect(kind(res, "b").kind).toBe("not_started");
  });

  it("each other basis makes a lead Working on its own, and the reasons are all listed", () => {
    const res = classifyLeads({
      leads: [lead("stage", "cs"), lead("appr", "pnc"), lead("prop", "pnc"), lead("cons", "fu"), lead("many", "ch")],
      stages,
      facts: facts({ approvals: ok("appr", "many"), proposals: ok("prop"), consults: ok("cons", "many") }),
    });
    expect(kind(res, "stage")).toEqual({ kind: "working", reasons: ["stage"] });
    expect(kind(res, "appr")).toEqual({ kind: "working", reasons: ["approval"] });
    expect(kind(res, "prop")).toEqual({ kind: "working", reasons: ["proposal"] });
    expect(kind(res, "cons")).toEqual({ kind: "working", reasons: ["consult"] });
    expect(kind(res, "many")).toEqual({ kind: "working", reasons: ["stage", "approval", "consult"] });
  });

  it("Working beats Event: an event contact with a pending approval is Working", () => {
    const res = classifyLeads({ leads: [lead("a", "pnc", "UGW")], stages, facts: facts({ approvals: ok("a"), booth: ok("a") }) });
    expect(kind(res, "a").kind).toBe("working");
  });

  it("nurture, lost and won leads are in none of the three, even with activity", () => {
    const res = classifyLeads({
      leads: [lead("n", "nur", "UGW"), lead("l", "lost"), lead("w", "won"), lead("x", "ghost-stage"), { id: "y", current_stage_id: null, referral_source: null }],
      stages,
      facts: facts({ activity: ok("n", "l", "w", "x"), approvals: ok("n") }),
    });
    expect(kind(res, "n")).toEqual({ kind: "closed", as: "nurture" });
    expect(kind(res, "l")).toEqual({ kind: "closed", as: "lost" });
    expect(kind(res, "w")).toEqual({ kind: "closed", as: "won" });
    expect(kind(res, "x")).toEqual({ kind: "closed", as: "unknown" });
    expect(kind(res, "y")).toEqual({ kind: "closed", as: "unknown" });
    if (res.status !== "ok") throw new Error();
    expect(res.counts).toMatchObject({ working: 0, open: 0, nurture: 1, lost: 1, won: 1, noStage: 2, inScope: 1 });
  });

  it("counts always add up: working + event + not started = open", () => {
    const leads = [lead("1", "pnc"), lead("2", "cs"), lead("3", "pnc", "UGW"), lead("4", "fu"), lead("5", "nur")];
    const res = classifyLeads({ leads, stages, facts: facts({ activity: ok("1") }) });
    if (res.status !== "ok") throw new Error();
    const c = res.counts;
    expect(c.working + c.eventContacts + c.notStarted).toBe(c.open);
    expect(c.inScope).toBe(c.open + c.nurture);
  });
});

describe("classifyLeads: three-state sources", () => {
  it("a failed activity read makes Working uncomputable; the page shows All with the note, never an empty Working", () => {
    const res = classifyLeads({ leads: [lead("a", "pnc"), lead("b", "cs"), lead("n", "nur")], stages, facts: facts({ activity: { status: "unavailable" } }) });
    expect(res.status).toBe("unavailable");
    if (res.status !== "unavailable") throw new Error();
    expect(res.failed).toEqual(["activity"]);
    expect(res.counts).toMatchObject({ open: 2, nurture: 1, inScope: 3 });
    expect(effectiveView(res, "working")).toBe("all");
    expect(inWorkingView(res, "a", "working")).toBe(true);
    expect(inWorkingView(res, "b", "event")).toBe(true);
  });

  it("a failed optional source fails toward showing: unverified leads stay in the Working view and the source is named", () => {
    for (const source of ["approvals", "proposals", "consults"] as const) {
      const res = classifyLeads({
        leads: [lead("quiet", "pnc"), lead("ugw", "pnc", "UGW"), lead("busy", "pnc")],
        stages,
        facts: facts({ activity: ok("busy"), [source]: { status: "unavailable" } }),
      });
      if (res.status !== "ok") throw new Error();
      expect(res.degraded).toEqual([source]);
      expect(res.counts.uncertain).toBe(2);
      expect(kind(res, "quiet")).toEqual({ kind: "not_started", uncertain: true });
      expect(kind(res, "ugw")).toMatchObject({ kind: "event", uncertain: true });
      expect(inWorkingView(res, "quiet", "working")).toBe(true);
      expect(inWorkingView(res, "ugw", "working")).toBe(true);
      expect(inWorkingView(res, "busy", "working")).toBe(true);
      // Honest buckets are unchanged: the Not started chip still lists "quiet" only.
      expect(inWorkingView(res, "quiet", "not_started")).toBe(true);
      expect(inWorkingView(res, "ugw", "not_started")).toBe(false);
      expect(res.counts.working).toBe(1);
    }
  });

  it("a failed booth read only blurs the Event / Not started split", () => {
    const res = classifyLeads({ leads: [lead("a", "pnc"), lead("b", "pnc", "UGW")], stages, facts: facts({ booth: { status: "unavailable" } }) });
    if (res.status !== "ok") throw new Error();
    expect(res.splitApproximate).toBe(true);
    expect(res.degraded).toEqual(["booth"]);
    expect(res.counts.uncertain).toBe(0);
    expect(inWorkingView(res, "a", "working")).toBe(false);
    expect(kind(res, "b").kind).toBe("event");
  });

  it("a skipped source (feature off) is the same as an empty one and is not degraded", () => {
    const res = classifyLeads({ leads: [lead("a", "pnc")], stages, facts: facts({ consults: { status: "skipped" }, approvals: { status: "skipped" } }) });
    if (res.status !== "ok") throw new Error();
    expect(res.degraded).toEqual([]);
    expect(kind(res, "a").kind).toBe("not_started");
  });
});

describe("views", () => {
  const res = classifyLeads({
    leads: [lead("w", "cs"), lead("e", "pnc", "UGW"), lead("n", "pnc"), lead("nur", "nur")],
    stages,
    facts: facts(),
  });
  it("lists each lead in exactly the right chip; All lists everything passed", () => {
    expect(inWorkingView(res, "w", "working")).toBe(true);
    expect(inWorkingView(res, "e", "working")).toBe(false);
    expect(inWorkingView(res, "e", "event")).toBe(true);
    expect(inWorkingView(res, "n", "not_started")).toBe(true);
    expect(inWorkingView(res, "nur", "working")).toBe(false);
    expect(inWorkingView(res, "nur", "event")).toBe(false);
    expect(inWorkingView(res, "nur", "not_started")).toBe(false);
    expect(inWorkingView(res, "nur", "all")).toBe(true);
  });
  it("the URL value defaults to working and ignores unknown values", () => {
    expect(parseWorkingView(undefined)).toBe("working");
    expect(parseWorkingView("bogus")).toBe("working");
    expect(parseWorkingView("all")).toBe("all");
    expect(parseWorkingView("event")).toBe("event");
  });
});

describe("helpers", () => {
  it("event source is UGW or Event, case-insensitive, nothing broader", () => {
    expect(isEventSource("UGW")).toBe(true);
    expect(isEventSource("event")).toBe(true);
    expect(isEventSource("Instagram")).toBe(false);
    expect(isEventSource(null)).toBe(false);
  });
  it("a live proposal is the NEWEST version of a family being sent or accepted", () => {
    const set = leadsWithLiveProposal([
      { family_id: "f1", version: 1, status: "sent", lead_id: "a" },
      { family_id: "f1", version: 2, status: "withdrawn", lead_id: "a" },
      { family_id: "f2", version: 1, status: "draft", lead_id: "b" },
      { family_id: "f3", version: 2, status: "sent", lead_id: "c" },
      { family_id: "f3", version: 1, status: "replaced", lead_id: "c" },
      { family_id: "f4", version: 1, status: "accepted", lead_id: "d" },
      { family_id: "f5", version: 1, status: "sent", lead_id: null },
    ]);
    expect([...set].sort()).toEqual(["c", "d"]);
  });
});
