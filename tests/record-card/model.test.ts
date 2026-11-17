import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLeadStepView } from "@/lib/lead-step/view-model";
import {
  buildBoardCard,
  buildOpenedCard,
  contactLinks,
  deadlineLine,
  nextOpenDeadline,
  type CardContext,
  type CardRead,
  type RecordCardLoad,
} from "@/lib/record-card/model";
import { proposalFeeLines } from "@/lib/record-card/rules";
import { LEAD, NOW, TZ, facts as stepFacts, pending, draft } from "../lead-step/fixtures";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MATTER = "33333333-3333-4333-8333-333333333333";
const TASK = "44444444-4444-4444-8444-444444444444";
const DUP = "55555555-5555-4555-8555-555555555555";

const members: CardRead<{ userId: string; name: string }[]> = { status: "ok", value: [{ userId: ME, name: "Rebecca" }] };
const stages: CardRead<{ id: string; name: string; category: string }[]> = {
  status: "ok",
  value: [
    { id: "s-new", name: "New", category: "open" },
    { id: "s-held", name: "Consult held", category: "open" },
    { id: "s-won", name: "Signed LOE", category: "won" },
  ],
};

function ctx(over: Partial<CardContext> = {}): CardContext {
  return { role: "owner", members, stages, mergeAvailable: true, path: "/dashboard/intake/", params: { view: "board", set: "working" }, now: new Date(NOW), timeZone: TZ, ...over };
}

const leadRow = {
  id: LEAD,
  first_name: "Maya",
  last_name: "Okafor",
  business_name: "Okafor Studio",
  email: "maya@example.com",
  phone: "(404) 555-0100",
  current_stage_id: "s-new",
  assigned_to: ME,
  referral_source: "UGW",
  last_activity_at: "2026-11-15T14:00:00.000Z",
};

const leadInput = (over = {}) => ({
  kind: "lead" as const,
  lead: leadRow,
  temperature: { value: "warm" as const, source: "suggested" as const, reason: "Replied" },
  nextStep: { status: "ok" as const, value: { id: TASK, title: "Call Maya", dueAt: "2026-11-16T00:00:00.000Z", assigneeId: ME } },
  approvals: { status: "ok" as const, queueIds: [] as string[] },
  ...over,
});

describe("the board card / list row", () => {
  it("a lead: name, business, open link keeping the view, bottom line, temperature, owner and stage picks", () => {
    const c = buildBoardCard(leadInput(), ctx());
    expect(c.name).toBe("Maya Okafor");
    expect(c.sub).toBe("Okafor Studio");
    expect(c.openHref).toBe(`/dashboard/intake/?view=board&set=working&open=lead%3A${LEAD}`);
    expect(c.fullHref).toBe(`/dashboard/leads/${LEAD}/`);
    expect(c.bottom).toEqual({ owner: "Rebecca", nextStep: "Call Maya · due Nov 16", lastActivity: "Last activity Nov 15" });
    expect(c.nextStep).toMatchObject({ status: "ok", step: { overdue: true }, edit: true, done: true, snooze: true });
    expect(c.temperature?.pill.style).toBe("outlined");
    expect(c.temperature?.menu[0].kind).toBe("accept");
    expect(c.owner.choices).toEqual(members.status === "ok" ? members.value : null);
    expect(c.stage).toEqual({ id: "s-new", name: "New", targets: [{ id: "s-held", name: "Consult held" }] });
    expect(c.source).toMatchObject({ value: "UGW" });
    expect(c.source.choices).toContain("Instagram");
    expect(c.deadline).toBeNull();
  });

  it("a viewer sees the same card with no control for anything", () => {
    const c = buildBoardCard(leadInput({ duplicateOf: DUP }), ctx({ role: "viewer" }));
    expect(c.name).toBe("Maya Okafor");
    expect(c.temperature?.menu).toEqual([]);
    expect(c.source.choices).toBeNull();
    expect(c.owner.choices).toBeNull();
    expect(c.stage.targets).toEqual([]);
    expect(c.nextStep).toMatchObject({ edit: false, done: false, snooze: false });
    expect(c.menu.map((m) => m.id)).toEqual(["open"]);
  });

  it("no next step: 'No next step' with Add for a writer; a failed read is never 'No next step'", () => {
    const none = buildBoardCard(leadInput({ nextStep: { status: "ok", value: null } }), ctx());
    expect(none.bottom.nextStep).toBe("No next step");
    expect(none.nextStep).toMatchObject({ status: "ok", step: null, add: "Add a next step" });
    const failed = buildBoardCard(leadInput({ nextStep: { status: "unavailable" } }), ctx());
    expect(failed.bottom.nextStep).toBe("Couldn't load next steps");
    expect(failed.nextStep).toEqual({ status: "unavailable", text: "Couldn't load next steps" });
  });

  it("unreadable members: owner read only; unreadable stages: stage read only", () => {
    const c = buildBoardCard(leadInput(), ctx({ members: { status: "unavailable" }, stages: { status: "unavailable" } }));
    expect(c.owner).toEqual({ id: ME, name: "A teammate", choices: null });
    expect(c.edits.owner).toBe(false);
    expect(c.stage.targets).toEqual([]);
    expect(c.edits.stage).toBe(false);
    expect(c.menu.some((m) => m.id === "move")).toBe(false);
  });

  it("an unassigned lead reads Unassigned; no activity reads No activity yet", () => {
    const c = buildBoardCard(leadInput({ lead: { ...leadRow, assigned_to: null, last_activity_at: null } }), ctx());
    expect(c.bottom.owner).toBe("Unassigned");
    expect(c.bottom.lastActivity).toBe("No activity yet");
  });

  it("Needs attorney links to the one approval; a failed approvals read is never 0", () => {
    const one = buildBoardCard(leadInput({ approvals: { status: "ok", queueIds: ["q1"] } }), ctx());
    expect(one.approvals).toMatchObject({ text: "Needs attorney · 1", href: "/dashboard/queue/q1/" });
    const failed = buildBoardCard(leadInput({ approvals: { status: "unavailable" } }), ctx());
    expect(failed.approvals?.text).toBe("Approvals couldn't load");
  });

  it("a matter: display title, no temperature, the deadline read only", () => {
    const c = buildBoardCard(
      {
        kind: "matter",
        matter: { id: MATTER, title: "TM-maya-okafor", mark_text: "OKAFOR", owner_name: "Maya Okafor", matter_number: "TM-maya-okafor", stage_id: null, assigned_to: null, referral_source: null },
        nextStep: { status: "ok", value: null },
        deadline: { status: "ok", value: { id: "d", dueDate: "2026-12-01", title: "Office action", confirmed: false } },
        lastActivityAt: null,
      },
      ctx({ path: "/dashboard/matters/", params: {} }),
    );
    expect(c.name).toBe("OKAFOR");
    expect(c.temperature).toBeNull();
    expect(c.openHref).toBe(`/dashboard/matters/?open=matter%3A${MATTER}`);
    expect(c.deadline).toEqual({ status: "ok", text: "USPTO deadline Dec 1", marker: "Unconfirmed", confirmed: false });
  });
});

describe("the next USPTO deadline is READ ONLY", () => {
  it("the line carries only words and the marker, never a control, for any role", () => {
    const line = deadlineLine({ status: "ok", value: { id: "d", dueDate: "2026-12-01", title: null, confirmed: true } });
    expect(line).toEqual({ status: "ok", text: "USPTO deadline Dec 1", marker: "Confirmed by an attorney", confirmed: true });
    expect(Object.keys(line ?? {}).sort()).toEqual(["confirmed", "marker", "status", "text"]);
    for (const role of ["owner", "attorney", "admin", "paralegal", "viewer"]) {
      const c = buildBoardCard(
        { kind: "matter", matter: { id: MATTER, title: "T", mark_text: null, owner_name: null, matter_number: "1", stage_id: null, assigned_to: null, referral_source: null }, nextStep: { status: "ok", value: null }, deadline: { status: "ok", value: { id: "d", dueDate: "2026-12-01", title: null, confirmed: false } }, lastActivityAt: null },
        ctx({ role }),
      );
      expect(Object.keys(c.deadline ?? {}).sort()).toEqual(["confirmed", "marker", "status", "text"]);
      expect(Object.keys(c.edits).some((k) => /deadline|confirm/i.test(k))).toBe(false);
    }
  });
  it("none, failed and not set up are their own states", () => {
    expect(deadlineLine({ status: "ok", value: null })).toEqual({ status: "none", text: "No open USPTO deadline" });
    expect(deadlineLine({ status: "unavailable" })).toEqual({ status: "unavailable", text: "Couldn't load" });
    expect(deadlineLine({ status: "not-set-up" })).toBeNull();
  });
  it("nextOpenDeadline is the soonest OPEN one", () => {
    const rows = [
      { id: "a", status: "met", due_date: "2026-11-01", title: null, attorney_confirmed: true },
      { id: "b", status: "open", due_date: "2027-01-05", title: null, attorney_confirmed: false },
      { id: "c", status: "open", due_date: "2026-12-10", title: "SOU", attorney_confirmed: true },
    ];
    expect(nextOpenDeadline(rows)).toEqual({ id: "c", dueDate: "2026-12-10", title: "SOU", confirmed: true });
    expect(nextOpenDeadline([])).toBeNull();
  });
});

describe("proposal fees: two lines from the stored quote, never added up", () => {
  it("legal fee and USPTO fees are separate lines", () => {
    expect(proposalFeeLines({ legalCents: 407500, govCents: 70000 })).toEqual([
      { label: "Legal fee", value: "$4,075.00" },
      { label: "USPTO fees", value: "$700.00" },
    ]);
  });
  it("no code in the record card adds the two figures", () => {
    const dir = path.resolve(__dirname, "../../src/lib/record-card");
    for (const f of ["rules.ts", "model.ts", "load.ts"]) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/(legal\w*|govCents|gov_total_cents)\s*\+\s*\w*(gov|legal)/i);
      expect(src, f).not.toMatch(/(gov\w*)\s*\+\s*\w*legal/i);
      expect(src, f).not.toMatch(/total_?due|grandTotal|sumFees/i);
    }
  });
});

describe("contactLinks: the person's own apps, only for what the lead has", () => {
  it("tel: and mailto:", () => {
    expect(contactLinks({ phone: "(404) 555-0100", email: "maya@example.com" })).toEqual({ call: "tel:4045550100", email: "mailto:maya@example.com" });
  });
  it("nothing for a missing or unusable value", () => {
    expect(contactLinks({ phone: null, email: null })).toEqual({ call: null, email: null });
    expect(contactLinks({ phone: "n/a", email: "not an email" })).toEqual({ call: null, email: null });
    expect(contactLinks({ phone: "", email: "x@y.z?cc=a@b.c<script>" }).email).toBeNull();
  });
});

const PAGE = { path: "/dashboard/intake/", params: { view: "list", open: `lead:${LEAD}` } };

function leadLoad(over: Partial<Extract<RecordCardLoad, { kind: "lead" }>> = {}): RecordCardLoad {
  return {
    status: "ok",
    kind: "lead",
    role: "owner",
    now: NOW,
    timeZone: TZ,
    lead: { ...leadRow, last_inbound_at: null, last_outbound_at: null, lane: null, lane_set_at: null, ai_summary: null },
    stages,
    members,
    tags: { status: "ok", value: { on: [{ id: "t1", label: "VIP", color: null }], catalog: [{ id: "t1", label: "VIP", color: null }, { id: "t2", label: "UGW", color: null }] } },
    leadStep: { status: "ok", facts: stepFacts({ approvals: pending(draft({ id: "q1" })) }) },
    approvals: { status: "ok", queueIds: ["q1"] },
    proposal: { status: "ok", value: { id: "p1", version: 2, status: "sent", legalCents: 407500, govCents: 70000 } },
    documents: { status: "unavailable" },
    temperature: { value: "warm", source: "suggested", reason: "Replied" },
    mergeAvailable: true,
    duplicateOf: null,
    ...over,
  } as RecordCardLoad;
}

describe("the opened card", () => {
  it("its top card is Sprint 9's engine, unchanged", () => {
    const f = stepFacts({ approvals: pending(draft({ id: "q1" })) });
    const view = buildOpenedCard(leadLoad({ leadStep: { status: "ok", facts: f } }), PAGE);
    if (view.status !== "ok" || view.kind !== "lead") throw new Error("expected a lead card");
    const engine = buildLeadStepView(f);
    expect(view.top.kind).toBe("needs-yes");
    expect(view.top).toEqual(engine.top);
    expect(view.facts).toEqual(engine.facts);
    expect(view.did).toEqual(engine.did);
    expect(view.closeHref).toBe("/dashboard/intake/?view=list");
    expect(view.proposal).toEqual({ status: "ok", lines: [{ label: "Legal fee", value: "$4,075.00" }, { label: "USPTO fees", value: "$700.00" }], href: "/dashboard/proposals/p1/" });
    expect(view.contact).toEqual({ call: "tel:4045550100", email: "mailto:maya@example.com" });
    expect(view.tags).toEqual({ status: "ok", on: [{ id: "t1", label: "VIP", color: null }], addable: [{ id: "t2", label: "UGW", color: null }], edit: true });
  });

  it("a failed engine read never says 'Lectual has it'; steps and timeline say they couldn't load", () => {
    for (const leadStep of [{ status: "unavailable" as const }, { status: "not-found" as const }]) {
      const view = buildOpenedCard(leadLoad({ leadStep }), PAGE);
      if (view.status !== "ok" || view.kind !== "lead") throw new Error("expected a lead card");
      expect(view.top.kind).toBe("couldnt-load");
      expect(view.steps).toEqual({ status: "unavailable", text: "Couldn't load next steps" });
      expect(view.timeline).toEqual({ status: "unavailable" });
      expect(view.did.status).toBe("unavailable");
    }
  });

  it("every other failed read is named, never empty", () => {
    const view = buildOpenedCard(leadLoad({ tags: { status: "unavailable" }, proposal: { status: "unavailable" }, approvals: { status: "unavailable" } }), PAGE);
    if (view.status !== "ok" || view.kind !== "lead") throw new Error("expected a lead card");
    expect(view.tags).toEqual({ status: "unavailable", text: "Couldn't load" });
    expect(view.proposal).toEqual({ status: "unavailable", text: "Couldn't load" });
    expect(view.card.approvals?.text).toBe("Approvals couldn't load");
    expect(view.documents).toEqual({ status: "unavailable" });
  });

  it("Proposals off hides the section; no proposal yet is its own state", () => {
    const off = buildOpenedCard(leadLoad({ proposal: { status: "not-set-up" } }), PAGE);
    const none = buildOpenedCard(leadLoad({ proposal: { status: "ok", value: null } }), PAGE);
    expect(off.status === "ok" && off.kind === "lead" && off.proposal).toBeNull();
    expect(none.status === "ok" && none.kind === "lead" && none.proposal).toEqual({ status: "none" });
  });

  it("with the stages unreadable a person's level still shows and no suggestion is drawn", () => {
    const view = buildOpenedCard(leadLoad({ stages: { status: "unavailable" }, temperature: null, lead: { ...leadRow, last_inbound_at: null, last_outbound_at: null, lane: "hot", lane_set_at: NOW, ai_summary: null } }), PAGE);
    if (view.status !== "ok" || view.kind !== "lead") throw new Error("expected a lead card");
    expect(view.card.temperature?.pill).toMatchObject({ value: "hot", style: "filled" });
    expect(view.card.temperature?.menu.some((m) => m.kind === "accept")).toBe(false);
  });

  it("a foreign or missing id carries nothing of the record", () => {
    for (const load of [{ status: "not-found" }, { status: "unavailable" }] as RecordCardLoad[]) {
      const view = buildOpenedCard(load, PAGE);
      expect(Object.keys(view).sort()).toEqual(["closeHref", "status", "text"]);
      expect(JSON.stringify(view)).not.toMatch(/Maya|Okafor|example\.com|Consult|New\b/);
    }
    expect(buildOpenedCard({ status: "not-found" }, PAGE)).toMatchObject({ text: "This record couldn't be found." });
    expect(buildOpenedCard({ status: "unavailable" }, PAGE)).toMatchObject({ text: "This record couldn't be loaded." });
  });

  it("a matter card: checklist, timeline, read-only deadline, its own failures", () => {
    const load: RecordCardLoad = {
      status: "ok",
      kind: "matter",
      role: "paralegal",
      now: NOW,
      timeZone: TZ,
      matter: { id: MATTER, title: "OKAFOR", mark_text: "OKAFOR", owner_name: "Maya Okafor", matter_number: "TM-1", stage_id: "m1", assigned_to: ME, referral_source: "UGW" },
      stages: { status: "ok", value: [{ id: "m1", label: "Filed" }, { id: "m2", label: "Published" }] },
      members,
      tasks: { status: "ok", value: [{ id: TASK, title: "Check status", dueAt: null, assigneeId: null }] },
      activity: { status: "unavailable" },
      deadline: { status: "ok", value: { id: "d", dueDate: "2026-12-01", title: null, confirmed: true } },
      documents: { status: "unavailable" },
    };
    const view = buildOpenedCard(load, { path: "/dashboard/matters/", params: {} });
    if (view.status !== "ok" || view.kind !== "matter") throw new Error("expected a matter card");
    expect(view.steps).toEqual({ status: "ok", items: [{ id: TASK, title: "Check status", due: "No date set", overdue: false }], add: true, done: true, snooze: true, edit: true });
    expect(view.deadline).toEqual({ status: "ok", text: "USPTO deadline Dec 1", marker: "Confirmed by an attorney", confirmed: true });
    expect(view.timeline).toEqual({ status: "unavailable" });
    expect(view.card.stage.targets).toEqual([{ id: "m2", name: "Published" }]);
    expect(view.card.edits.title).toBe(true);
    const failed = buildOpenedCard({ ...load, tasks: { status: "unavailable" }, deadline: { status: "unavailable" } }, { path: "/dashboard/matters/", params: {} });
    if (failed.status !== "ok" || failed.kind !== "matter") throw new Error("expected a matter card");
    expect(failed.steps).toEqual({ status: "unavailable", text: "Couldn't load next steps" });
    expect(failed.deadline).toEqual({ status: "unavailable", text: "Couldn't load" });
  });
});
