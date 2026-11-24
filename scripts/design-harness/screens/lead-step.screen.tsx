import type { ReactElement } from "react";
import LeadPage from "@/app/dashboard/leads/[id]/page";
import { AGENT_ACTOR } from "@/lib/stage-keeper/moves";
import type { LeadStepFacts } from "@/lib/lead-step/facts";
import type { Role } from "@/lib/auth/roles";
import { L, S } from "../mono-data";
import { resetState } from "../fixtures";
import { state } from "../state";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";
import { THURSDAY_CONSULT, draft, facts, pending, proposal, row } from "../../../tests/lead-step/fixtures";

/**
 * Sprint 9 Part 2: the real lead page (Maya) with the top card drawn from sample lead-step facts, in each card state, at
 * 1440 / 1280 / 375. The rest of the page is the real page over mono-data. Not a design board: measured for overflow.
 */
const RELEASE = "<style>.lx-app{height:auto!important;min-height:0!important;overflow:visible!important}.lx-main,.lx-content,.lx-page{overflow:visible!important;height:auto!important}</style>";
const VPS = [["d", "desktop"], ["m", "desktop1280"], ["p", "phone"]] as const;

const LONG = "Hi Maya,\n\nThank you for your time on Thursday. I wanted to make sure the proposal link reached you, and to say that the mark we talked about, CRUMB & CO., looks like a good fit for the package we discussed.\n\nIf it helps, I can walk through the three package options on a short call.\n\nThere is nothing you need to do until you have read it.\n\nOne more thing about timing.\n\nThis sentence is behind the fold.\n\nWarm regards,\nRebecca";
const move = (id: string, at: string) => row({ id, lead_id: L.maya, type: "stage_changed", created_at: at, payload: { actor: AGENT_ACTOR, from_stage_id: S.scheduled, to_stage_id: S.proposal, from_stage: "Consult Scheduled", to_stage: "Proposal Sent" } });
const base = (over: Partial<LeadStepFacts> = {}) => {
  const f = facts(over);
  return { ...f, lead: { ...f.lead, id: L.maya, mergedIds: [L.maya], name: "Maya Chen", stageId: S.proposal, ...(over.lead ?? {}) } } as LeadStepFacts;
};
const rows = [
  move("m1", "2026-11-16T15:00:00Z"),
  row({ id: "d1", lead_id: L.maya, type: "queue_drafted", created_at: "2026-11-16T12:00:00Z", payload: { source: "post-consult" } }),
  row({ id: "e1", lead_id: L.maya, type: "email_received", actor_type: "system", created_at: "2026-11-15T15:00:00Z" }),
  row({ id: "e2", lead_id: L.maya, type: "email_sent", actor_type: "system", created_at: "2026-11-14T15:00:00Z" }),
];
const withRole = (role: Role) => ({ viewer: { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role, actingAsStaff: false, canMoveStage: true } });

const states: Array<{ key: string; title: string; facts: () => LeadStepFacts }> = [
  { key: "yes", title: "Needs your yes", facts: () => base({ approvals: pending(draft({ draftBody: LONG, summary: "CHECK FIRST: the package named in the email.\nFirst step: read the proposal." })), activity: { status: "ok", value: { rows, truncated: false } } }) },
  { key: "ro", title: "Needs a yes, read-only", facts: () => base({ ...withRole("viewer"), approvals: pending(draft({ draftBody: LONG })) }) },
  { key: "has", title: "Lectual has it", facts: () => base({ consult: { status: "ok", value: THURSDAY_CONSULT }, activity: { status: "ok", value: { rows, truncated: false } } }) },
  { key: "mine", title: "Yours to do", facts: () => base({ tasks: { status: "ok", value: [{ id: "55555555-5555-4555-8555-555555555555", title: "Call Maya about the proposal", type: "custom", dueAt: "2026-11-16T12:00:00.000Z", assigneeId: null, createdAt: "2026-11-10T12:00:00.000Z" }] }, proposal: { status: "ok", value: proposal() } }) },
  { key: "gap", title: "Not prepared (proposal out, day 2)", facts: () => base({ proposal: { status: "ok", value: proposal() }, activity: { status: "ok", value: { rows, truncated: true } } }) },
];

export const screens: Screen[] = states.flatMap((st) =>
  VPS.map(([tag, viewport]) => ({
    id: `l2-lead-step-${st.key}-${tag}`,
    title: `Lead page, top card: ${st.title} (${viewport})`,
    designBoard: "none",
    viewport,
    pathname: `/dashboard/leads/${L.maya}/`,
    shell: "none" as const,
    prepare: () => {
      resetState();
      state.pathname = `/dashboard/leads/${L.maya}/`;
      (state as { leadStep?: unknown }).leadStep = { status: "ok", facts: st.facts() };
    },
    render: async () => <OwnerShell>{(await LeadPage({ params: Promise.resolve({ id: L.maya }), searchParams: Promise.resolve({}) })) as unknown as ReactElement}</OwnerShell>,
    transformHtml: (html: string) => html.replace("</head>", `${RELEASE}</head>`),
  })),
);
