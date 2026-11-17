import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Lead, Stage } from "@/lib/pipeline";
import { buildIntakeRows } from "@/lib/intake/rows";
import { ROLES } from "@/lib/auth/roles";
import { buildIntakeCards } from "@/lib/record-card/intake-cards";
import { startHold } from "@/lib/record-card/hold";
import { leadLabel } from "@/lib/record-card/lead-label";
import { buildMatterCards } from "@/lib/record-card/matter-cards";
import { buildOpenedCard, type CardContext, type CardRead, type RecordCardLoad } from "@/lib/record-card/model";
import { NO_SHOW_HOLD_MS } from "@/lib/record-card/rules";
import { LEAD, NOW, TZ, facts as stepFacts, pending, draft } from "../lead-step/fixtures";
import IntakeCard from "@/app/dashboard/intake/_components/IntakeCard";
import { RecordCardHost } from "@/components/record-card/RecordCardHost";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock("@/lib/voice/notes", () => ({ voiceNotePlaybackUrls: async () => ({}) }));

const root = path.resolve(__dirname, "../..");
const src = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MATTER = "33333333-3333-4333-8333-333333333333";
const TASK = "44444444-4444-4444-8444-444444444444";
const members: CardRead<{ userId: string; name: string }[]> = { status: "ok", value: [{ userId: ME, name: "Rebecca" }] };
const stageRows = [
  { id: "s-new", name: "New", category: "open" },
  { id: "s-held", name: "Consult held", category: "open" },
];
const stages: CardRead<typeof stageRows> = { status: "ok", value: stageRows };

describe("a lead is labelled by the PERSON first (Taylor, Nov 17 call)", () => {
  it("the person's name is the name; the business and the mark are the sub-line", () => {
    expect(leadLabel({ first_name: "Anthony", last_name: "Harris", business_name: "Harris Holdings LLC", mark_text: "HARRIS" })).toEqual({ name: "Anthony Harris", sub: "Harris Holdings LLC · HARRIS" });
    expect(leadLabel({ first_name: "Anthony", last_name: "Harris", business_name: "Harris Holdings LLC" }).sub).toBe("Harris Holdings LLC");
  });
  it("the company stands in only when there is no person's name, then the email", () => {
    expect(leadLabel({ first_name: "", last_name: " ", business_name: "Harris Holdings LLC", mark_text: "HARRIS" })).toEqual({ name: "Harris Holdings LLC", sub: "HARRIS" });
    expect(leadLabel({ first_name: null, last_name: null, business_name: null, email: "a@b.co" })).toEqual({ name: "a@b.co", sub: null });
    expect(leadLabel({}, "A teammate")).toEqual({ name: "A teammate", sub: null });
  });
  it("never repeats the business beside itself", () => {
    expect(leadLabel({ first_name: "Ana", last_name: "Ruiz", business_name: "Ana Ruiz", mark_text: "Ana Ruiz" }).sub).toBeNull();
  });
  it("the Matters 'open a matter' picker and the opened card use it (no company-first fallback left there)", () => {
    expect(src("src/app/dashboard/matters/page.tsx")).toMatch(/leadLabel\(l\)\.name/);
    expect(src("src/app/dashboard/matters/page.tsx")).not.toMatch(/business_name\?\.trim\(\) \|\|/);
    expect(src("src/lib/record-card/model.ts")).toMatch(/leadLabel\(lead, RECORD_CARD_A_TEAMMATE\)/);
  });
});

describe("Mark no-show holds for 5 seconds and posts nothing until then", () => {
  it("posts once, only when the hold ends", () => {
    const post = vi.fn();
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const hold = startHold(post, { setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length), clearTimer: () => {} });
    expect(timers[0].ms).toBe(NO_SHOW_HOLD_MS);
    expect(NO_SHOW_HOLD_MS).toBe(5000);
    expect(post).not.toHaveBeenCalled();
    timers[0].fn();
    expect(post).toHaveBeenCalledTimes(1);
    expect(hold.settled()).toBe("posted");
    expect(hold.cancel()).toBe(false); // after it, there is no undo
  });
  it("Undo inside the hold posts nothing", () => {
    const post = vi.fn();
    let fn: (() => void) | null = null;
    const cleared = vi.fn(() => (fn = null));
    const hold = startHold(post, { setTimer: (f) => ((fn = f), 1), clearTimer: cleared });
    expect(hold.cancel()).toBe(true);
    expect(cleared).toHaveBeenCalled();
    expect(fn).toBeNull();
    expect(post).not.toHaveBeenCalled();
    expect(hold.settled()).toBe("cancelled");
  });
  it("is the only path to the no-show action: it is posted from inside the hold callback, as the no_show outcome, and moves no stage", () => {
    const c = src("src/components/record-card/controls.tsx");
    const body = c.slice(c.indexOf("export function useNoShow"), c.indexOf("/** The ⋯ menu for a board card"));
    expect(body).toMatch(/startHold\(\(\) => \{[\s\S]*logConsultOutcomeAction[\s\S]*outcome: "no_show"[\s\S]*\}\)/);
    expect(body.match(/logConsultOutcomeAction/g)).toHaveLength(1);
    expect(body).not.toMatch(/moveStageAction|moveLeadStage/);
  });
});

describe("each control is wired to the right existing action", () => {
  const c = src("src/components/record-card/controls.tsx");
  const o = src("src/components/record-card/opened-parts.tsx");
  it("temperature, source, owner, stage and the next-step controls", () => {
    expect(c).toMatch(/run\(\(\) => setLaneAction\(leadId, lane\)\)/);
    expect(c).toMatch(/setSourceAction\(id, /);
    expect(c).toMatch(/viaForm\(updateMatterHeaderAction, \{ matterId: id, referralSource: option \}\)/);
    expect(c).toMatch(/viaForm\(assignRecordAction, \{ kind, id, userId/);
    expect(c).toMatch(/viaForm\(moveStageAction, \{ kind, id, stageId: t\.id \}\)/);
    expect(c).toMatch(/updateNextStepAction/);
    expect(c).toMatch(/setNextStepAction, \{ kind, id/);
    expect(c).toMatch(/snoozeNextStepAction/);
    expect(c).toMatch(/completeNextStepAction/);
  });
  it("a matter's stage is the review's moveStageAction, never updateMatterStageAction (it can't say Saved)", () => {
    for (const f of ["src/components/record-card/controls.tsx", "src/components/record-card/MatterBits.tsx"]) expect(src(f)).not.toMatch(/updateMatterStageAction/);
    expect(src("src/components/record-card/MatterBits.tsx")).toMatch(/moveStageAction/);
  });
  it("rename and tags are the two new actions; the rename form posts only the name fields and the matter title", () => {
    expect(o).toMatch(/renameLeadAction, \{ leadId: id, firstName: first, lastName: last, businessName: business \}/);
    expect(o).toMatch(/cardTagAction, \{ leadId, tagId: t\.id, op: "remove" \}/);
    expect(o).toMatch(/cardTagAction, \{ leadId, tagId: v, op: "add" \}/);
    expect(o).toMatch(/updateMatterHeaderAction, \{ matterId: id, title: name \}/);
  });
  it("Saved comes only from the action's own result (savedMark), through one hook", () => {
    expect(src("src/components/record-card/use-run.ts")).toMatch(/savedMark\(result\)/);
    expect(src("src/components/record-card/SavedMarkView.tsx")).toMatch(/mark\.error/);
  });
  it("the source menu offers only the firm's list; the lead's rename prefills the business from the LEAD ROW", () => {
    expect(c).not.toMatch(/<input[^>]*source/i);
    const m = src("src/lib/record-card/model.ts");
    expect(m).toMatch(/business: load\.lead\.business_name \?\? ""/);
    expect(o).toMatch(/useState\(names\?\.business \?\? ""\)/);
  });
  it("no raw error text and no service role in the card components", () => {
    for (const f of ["controls.tsx", "opened-parts.tsx", "RecordCardHost.tsx", "use-run.ts"]) {
      const t = src(`src/components/record-card/${f}`);
      expect(t).not.toMatch(/\.message\b|String\(err/);
      expect(t).not.toMatch(/@\/lib\/db\/admin/);
    }
  });
  it("the Weekly review was not touched by the card wiring", () => {
    for (const f of ["src/app/dashboard/review/page.tsx", "src/components/review/ReviewPanel.tsx"]) expect(src(f)).not.toMatch(/record-card/);
  });
});

// ---- markup per role: board card / list row ------------------------------------------------------------------------

const stage = { id: "s-new", org_id: "o", name: "New", order_index: 1, category: "open", aging_threshold_days: 30 } as unknown as Stage;
const lead = {
  id: LEAD, first_name: "Anthony", last_name: "Harris", business_name: "Harris Holdings LLC", mark_text: "HARRIS", email: "a@x.test", phone: null,
  current_stage_id: "s-new", stage_entered_at: "2026-11-10T12:00:00Z", assigned_to: null, temperature: null, lane: null, ai_summary: null,
  last_activity_at: "2026-11-14T12:00:00Z", last_outbound_at: null, last_inbound_at: null, referral_source: "UGW",
} as unknown as Lead;
const ctx = (role: string): CardContext => ({ role, members, stages, mergeAvailable: false, path: "/dashboard/intake/", params: { view: "board" }, now: new Date(NOW), timeZone: TZ });

function intakeCard(role: string, steps: Parameters<typeof buildIntakeCards>[0]["steps"] = { status: "ok", value: { [LEAD]: { id: TASK, title: "Call Anthony", dueAt: "2026-11-20T00:00:00Z", assigneeId: null } } }) {
  const rows = buildIntakeRows({ leads: [lead], stages: [stage], members: [], now: new Date(NOW) });
  const cards = buildIntakeCards({ rows, ctx: ctx(role), steps, approvals: { status: "ok", byLead: { [LEAD]: [{ queueId: "q-1", headline: "Draft", kind: "client_draft", createdAt: null }] } }, duplicates: {} });
  const html = renderToStaticMarkup(
    <IntakeCard row={rows[0]} stages={[stage]} members={[]} pending={false} time={null} onMoveStage={() => {}} onAssign={() => {}} now={new Date(NOW)} card={cards[LEAD]} onSetLane={() => {}} onSetSource={() => {}} />,
  );
  return { html, cards };
}

describe("the Intake card, per role", () => {
  it("names the person first, the business and the mark beside it, and links the name to the opened card keeping the view", () => {
    const { html } = intakeCard("attorney");
    expect(html).toMatch(/class="[^"]*ix-card-name"[^>]*>Anthony Harris</);
    expect(html).toContain("Harris Holdings LLC · HARRIS");
    expect(html).toContain("view=board&amp;open=lead%3A" + LEAD);
  });
  it("an editor gets the temperature, source, owner and next-step controls, 'Needs attorney · 1' as a link to the approval", () => {
    const { html } = intakeCard("attorney");
    expect(html).toContain('data-testid="temperature-cell"');
    expect(html).toContain("Change source");
    expect(html).toContain("Reassign");
    expect(html).toContain("Call Anthony");
    expect(html).toMatch(/<a [^>]*href="\/dashboard\/queue\/q-1\/?"[^>]*>Needs attorney · 1</);
    expect(html).toContain('aria-label="Actions for Anthony Harris"');
  });
  it("a viewer sees the same card with no control for temperature, source, owner or the next step", () => {
    const { html } = intakeCard("viewer");
    expect(html).toContain("Anthony Harris");
    expect(html).toContain("UGW");
    expect(html).not.toContain("Change source");
    expect(html).not.toContain("Reassign");
    expect(html).not.toMatch(/<button[^>]*Call Anthony/);
    expect(html).toContain("Call Anthony");
  });
  it("a failed steps read says so on the card, never 'No next step'", () => {
    const { html } = intakeCard("attorney", { status: "unavailable" });
    expect(html).toContain("Couldn&#x27;t load next steps");
    expect(html).not.toContain("No next step");
  });
  it("every role's controls equal cardEdits (the card draws exactly the edit set)", () => {
    for (const role of ROLES) {
      const { cards } = intakeCard(role);
      const e = cards[LEAD].edits;
      const html = intakeCard(role).html;
      expect(html.includes("Change source"), role).toBe(e.source);
      expect(html.includes("Reassign"), role).toBe(e.owner);
      expect(html.includes('data-testid="temperature-cell"'), role).toBe(e.temperature);
    }
  });
});

describe("the Matters cards", () => {
  const matter = { id: MATTER, title: "OKAFOR", mark_text: "OKAFOR", owner_name: "Maya Okafor", matter_number: "TM-1", stage_id: "m1", assigned_to: null, referral_source: null, type: "TM", stage: { id: "m1", code: "3", label: "3. Filed" } } as never;
  it("strips the stage's ordering prefix and keeps the open link on the Matters path", () => {
    const cards = buildMatterCards({
      matters: [matter],
      ctx: { ...ctx("attorney"), path: "/dashboard/matters/", params: {}, stages: { status: "ok", value: [{ id: "m1", label: "3. Filed" }, { id: "m2", label: "4. Published" }] } as never },
      steps: { status: "ok", value: {} },
    });
    expect(cards[MATTER].stage.name).toBe("Filed");
    expect(cards[MATTER].stage.targets).toEqual([{ id: "m2", name: "Published" }]);
    expect(cards[MATTER].openHref).toBe(`/dashboard/matters/?open=matter%3A${MATTER}`);
    expect(cards[MATTER].bottom.nextStep).toBe("No next step");
  });
});

// ---- the opened card ------------------------------------------------------------------------------------------------

const leadRow = {
  id: LEAD, first_name: "Anthony", last_name: "Harris", business_name: "Harris Holdings LLC", mark_text: "HARRIS", email: "a@x.test", phone: "(404) 555-0100",
  current_stage_id: "s-new", assigned_to: ME, referral_source: "UGW", last_activity_at: "2026-11-15T14:00:00.000Z",
  last_inbound_at: null, last_outbound_at: null, lane: null, lane_set_at: null, ai_summary: null,
};
function leadLoad(role: string, over: Partial<Extract<RecordCardLoad, { kind: "lead" }>> = {}): RecordCardLoad {
  return {
    status: "ok", kind: "lead", role, now: NOW, timeZone: TZ, lead: leadRow, stages, members,
    tags: { status: "ok", value: { on: [{ id: "t1", label: "VIP", color: null }], catalog: [{ id: "t1", label: "VIP", color: null }, { id: "t2", label: "UGW", color: null }] } },
    leadStep: { status: "ok", facts: stepFacts({ approvals: pending(draft({ id: "q1" })) }) },
    approvals: { status: "ok", queueIds: ["q1"] },
    proposal: { status: "ok", value: { id: "p1", version: 2, status: "sent", legalCents: 407500, govCents: 70000 } },
    documents: { status: "unavailable" },
    temperature: { value: "warm", source: "suggested", reason: "Replied" },
    mergeAvailable: false, duplicateOf: null, ...over,
  } as RecordCardLoad;
}
const matterLoad = (role: string, over = {}): RecordCardLoad =>
  ({
    status: "ok", kind: "matter", role, now: NOW, timeZone: TZ,
    matter: { id: MATTER, title: "OKAFOR", mark_text: "OKAFOR", owner_name: "Maya Okafor", matter_number: "TM-1", stage_id: "m1", assigned_to: ME, referral_source: "UGW" },
    stages: { status: "ok", value: [{ id: "m1", label: "Filed" }, { id: "m2", label: "Published" }] }, members,
    tasks: { status: "ok", value: [{ id: TASK, title: "Check status", dueAt: "2026-11-20T00:00:00Z", assigneeId: null }] },
    activity: { status: "ok", value: { rows: [], truncated: false } },
    deadline: { status: "ok", value: { id: "d", dueDate: "2026-12-01", title: null, confirmed: false } },
    documents: { status: "unavailable" }, ...over,
  }) as RecordCardLoad;

async function host(load: RecordCardLoad, kind: "lead" | "matter" = "lead", id = LEAD) {
  const el = await RecordCardHost({ open: { kind, id }, path: kind === "lead" ? "/dashboard/intake/" : "/dashboard/matters/", params: { view: "board" }, load });
  return renderToStaticMarkup(el);
}

describe("the opened card's states", () => {
  it("a foreign or missing id shows the sentence and nothing of the record, with a close link that keeps the view", async () => {
    const html = await host({ status: "not-found" });
    expect(html).toContain("This record couldn&#x27;t be found.");
    for (const secret of ["Anthony", "Harris", "a@x.test", "Rebecca", "UGW"]) expect(html).not.toContain(secret);
    expect(html).toMatch(/href="\/dashboard\/intake\/?\?view=board"/);
    expect(html).toContain('role="dialog"');
  });
  it("a failed record read shows its fixed sentence and no fields", async () => {
    const html = await host({ status: "unavailable" });
    expect(html).toContain("This record couldn&#x27;t be loaded.");
    expect(html).not.toContain("Anthony");
  });
  it("no ?open= draws nothing", async () => {
    expect(await RecordCardHost({ open: null, path: "/dashboard/intake/", params: {} })).toBeNull();
  });
  it("a lead: the person first, business and mark beside, the engine's top card, Close and Esc are the close LINK", async () => {
    const html = await host(leadLoad("attorney"));
    expect(html).toMatch(/<h2[^>]*>Anthony Harris<\/h2>/);
    expect(html).toContain("Harris Holdings LLC · HARRIS");
    expect(html).toContain('data-step="needs-yes"');
    expect(html).toContain("data-close");
    expect(html).toContain("rc-card");
    expect(html).toContain('id="card-steps"');
    expect(html).toContain("Open full page");
  });
  it("an editor has Edit name, the note composer, Add a tag; a viewer has none of them", async () => {
    const ed = await host(leadLoad("attorney"));
    expect(ed).toContain("Edit name");
    expect(ed).toContain('aria-label="Add to the timeline"');
    expect(ed).toContain("Add a tag");
    expect(ed).toContain('aria-label="Remove tag VIP"');
    const vw = await host(leadLoad("viewer"));
    expect(vw).not.toContain("Edit name");
    expect(vw).not.toContain('aria-label="Add to the timeline"');
    expect(vw).not.toContain("Add a tag");
    expect(vw).not.toContain("Remove tag");
    expect(vw).toContain("VIP");
  });
  it("Call and Email are tel: and mailto: links, and nothing is sent", async () => {
    const html = await host(leadLoad("attorney"));
    expect(html).toContain('href="tel:4045550100"');
    expect(html).toContain('href="mailto:a@x.test"');
  });
  it("the proposal shows the legal fee and the USPTO fees on SEPARATE lines, never added up", async () => {
    const html = await host(leadLoad("attorney"));
    expect(html).toMatch(/Legal fee<\/span><span>\$4,075\.00</);
    expect(html).toMatch(/USPTO fees<\/span><span>\$700\.00</);
    expect(html).not.toContain("$4,775.00");
    const code = src("src/components/record-card/RecordCardHost.tsx") + src("src/lib/record-card/rules.ts");
    expect(code).not.toMatch(/legalCents\s*\+|\+\s*govCents|govCents\s*\+|\+\s*legalCents/);
  });
  it("each failed read says so: steps, timeline, tags, proposal, documents", async () => {
    const html = await host(leadLoad("attorney", { leadStep: { status: "unavailable" }, tags: { status: "unavailable" }, proposal: { status: "unavailable" } }));
    expect(html).toContain("Couldn&#x27;t load next steps");
    expect(html).toContain("Couldn&#x27;t load");
    expect(html).not.toContain("No open next steps.");
    expect(html).not.toContain("No tags.");
    expect(html).not.toContain("No proposal yet.");
  });
  it("a matter: next USPTO deadline with its marker, READ ONLY for every role", async () => {
    for (const role of ROLES) {
      const html = await host(matterLoad(role), "matter", MATTER);
      expect(html, role).toContain("USPTO deadline Dec 1");
      expect(html, role).toContain("Unconfirmed");
      expect(html, role).not.toMatch(/Confirm (the )?deadline|Close (the )?deadline|Extend|Edit deadline/i);
      expect(html, role).not.toMatch(/confirmDeadline|closeDeadline|updateDeadline/);
    }
    const src2 = src("src/components/record-card/RecordCardHost.tsx") + src("src/components/record-card/controls.tsx");
    expect(src2).not.toMatch(/confirmDeadline|closeDeadline|updateDeadline|crm_matter_deadline|DeadlineActions/);
  });
  it("a matter: an editor edits the title, a viewer doesn't", async () => {
    expect(await host(matterLoad("attorney"), "matter", MATTER)).toContain("Edit title");
    expect(await host(matterLoad("viewer"), "matter", MATTER)).not.toContain("Edit title");
  });
  it("a matter's failed deadline read says so and is never 'No open USPTO deadline'", async () => {
    const html = await host(matterLoad("attorney", { deadline: { status: "unavailable" } }), "matter", MATTER);
    expect(html).not.toContain("No open USPTO deadline");
    expect(html).toContain("Couldn&#x27;t load");
  });
});
