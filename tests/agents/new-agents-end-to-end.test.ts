import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runOneAgent, type RunnerDeps } from "@/lib/agents/runner";
import { buildRunDigest, type DigestRun } from "@/lib/agents/digest";
import { autonomyHint, type Autonomy } from "@/lib/agents/types";
import { sealToken } from "@/lib/mailbox/crypto";
import type { NewQueueDraft, QueueItem } from "@/lib/queue/api";
import { fakeAdmin } from "../mailbox/fake-db";
import { fakeLlm, NOW, ORG } from "./helpers";
import { memDb, type Row } from "./mem-db";

/**
 * D1, D2, D5: the three agents driven through runOneAgent against a populated fake firm, with a stateful
 * fake queue and a stateful fake Outlook, then again, then the next day.
 */

const root = randomBytes(32);
const DAY = 86_400_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const iso = (ms: number) => new Date(ms).toISOString();

function firm(clock: { t: number }) {
  const consultAt = (hours: number) => iso(NOW + hours * 3_600_000);
  const db = memDb({
    crm_org: [{ id: ORG, queue_org_key: "firm-queue-key", modules: ["agents", "mailbox", "agent-toolkit"] }],
    agent_run: [],
    agent_autopilot: [],
    crm_org_profile: [],
    crm_stage: [{ id: "s1", org_id: ORG, name: "Discovery", category: "open", aging_threshold_days: 14 }],
    crm_lead: [
      { id: "L1", org_id: ORG, first_name: "Dana", last_name: "Ruiz", business_name: "Sankofa", email: "dana@client.example", practice_area: "Trademark", mark_text: "SANKOFA", current_stage_id: "s1", stage_entered_at: iso(NOW - 9 * DAY), last_activity_at: iso(NOW - 9 * DAY), last_inbound_at: iso(NOW - 3 * DAY), last_outbound_at: iso(NOW - 9 * DAY), created_at: iso(NOW - 30 * DAY), referral_source: null, referral_detail: null, phone: null },
      { id: "L2", org_id: ORG, first_name: "Lee", last_name: "Park", business_name: null, email: "lee@client.example", practice_area: "Copyright", mark_text: null, current_stage_id: "s1", stage_entered_at: iso(NOW - 10 * DAY), last_activity_at: iso(NOW - 10 * DAY), last_inbound_at: null, last_outbound_at: null, created_at: iso(NOW - 40 * DAY), referral_source: null, referral_detail: null, phone: null },
    ],
    crm_calendar_event: [
      { id: "e1", org_id: ORG, lead_id: "L1", source: "outlook", is_consult: true, starts_at: consultAt(5), join_url: "https://zoom.example/j/1", all_day: false },
      { id: "e2", org_id: ORG, lead_id: "L2", source: "outlook", is_consult: true, starts_at: consultAt(9), join_url: null, all_day: false },
    ],
    crm_matter_deadline: [],
    crm_matter: [],
    crm_activity: [],
    crm_intake_submission: [],
    crm_intake_form: [],
    crm_booth_scorecard: [],
    crm_meeting: [],
    mailbox_connection: [
      { id: "c1", org_id: ORG, provider: "microsoft", email: "attorney@firm.example", scope: "personal", status: "active", access_token_enc: sealToken(root, "tok"), refresh_token_enc: sealToken(root, "r"), token_expires_at: "2099-01-01T00:00:00Z", scopes: [] },
    ],
  } satisfies Record<string, Row[]>);

  // A queue that remembers what was drafted and lists what is still pending.
  const queue: QueueItem[] = [];
  const createDraft = vi.fn(async (d: NewQueueDraft) => {
    const id = `qi-${queue.length + 1}`;
    queue.push({
      id,
      org_id: d.orgKey,
      matter_id: d.matterId ?? null,
      agent: d.agent,
      type: d.type,
      headline: d.headline,
      summary: d.summary ?? null,
      draft_body: d.draftBody,
      final_body: null,
      status: "pending",
      created_at: iso(clock.t),
      client_name: d.clientName ?? null,
      recipient: d.recipient ?? null,
      subject: d.subject ?? null,
      proposed_send_at: null,
      attachments: null,
      resolved_by: null,
      resolved_at: null,
      resolution_note: null,
    });
    return { id };
  });

  // An Outlook that remembers the drafts it was handed.
  const outlookDrafts: Array<{ subject: string; to: string[]; body: string }> = [];
  const requests: Array<{ method: string; url: string }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ method, url });
    if (method === "POST") {
      const d = JSON.parse(String(init?.body));
      outlookDrafts.push({ subject: d.subject, to: d.toRecipients.map((r: { emailAddress: { address: string } }) => r.emailAddress.address), body: d.body.content });
      return json({ id: `draft-${outlookDrafts.length}`, webLink: "https://outlook.example/d" }, 201);
    }
    if (url.includes("/mailFolders/inbox/messages?")) {
      return json({
        value: [
          { id: "N1", conversationId: "cv1", subject: "Please advise on the filing", bodyPreview: "p", from: { emailAddress: { name: "Pat", address: "pat@client.example" } }, toRecipients: [], receivedDateTime: iso(clock.t - 2 * 3_600_000) },
          { id: "F1", conversationId: "cv2", subject: "Thanks", bodyPreview: "p", from: { emailAddress: { name: "Sam", address: "sam@client.example" } }, toRecipients: [], receivedDateTime: iso(clock.t - 3 * 3_600_000) },
        ],
      });
    }
    if (url.includes("/mailFolders/drafts/messages?")) return json({ value: outlookDrafts.map((d) => ({ subject: d.subject, toRecipients: d.to.map((a) => ({ emailAddress: { address: a } })) })) });
    return json({ body: { contentType: "text", content: "Hello, could you confirm the date?" } });
  }) as typeof fetch;

  const canned = { reply: "Thanks for your note.\n\nBest,\n[Attorney name]", text: "Dear client,\n\nPlease have the name ready.\n\nWarm regards", subject: "Checking in", body: "Hello.\n\nBest,\n[Attorney name]", internal_summary: "Quiet for a while." };
  const { llm } = fakeLlm(canned);
  const { client, log } = fakeAdmin(db.handler);
  const admin = client as unknown as SupabaseClient;
  const deps: RunnerDeps = {
    admin,
    llm,
    createDraft,
    listPending: async () => queue.filter((q) => q.status === "pending"),
    fetchImpl,
    now: () => clock.t,
    mailbox: { admin, root, credentials: () => ({ clientId: "c", clientSecret: "s" }) },
  };
  return { db, log, deps, queue, createDraft, outlookDrafts, requests };
}

const run = (f: ReturnType<typeof firm>, agent: "morning-brief" | "consult-prep" | "inbox-summary", autonomy: Autonomy = "draft") =>
  runOneAgent(f.deps, { orgId: ORG, agent, autonomy, trigger: "cron" });
const types = (f: ReturnType<typeof firm>, agent: string) => f.queue.filter((q) => q.agent === agent).map((q) => q.type);
const digestRows = (f: ReturnType<typeof firm>): DigestRun[] =>
  f.db.tables.agent_run.map((r) => ({ agent: r.agent as string, status: r.status as string, started_at: r.started_at as string, items_in: (r.items_in as number) ?? 0, drafts_out: (r.drafts_out as number) ?? 0, summary: (r.summary as string | null) ?? null, error: (r.error as string | null) ?? null }));

describe("D1: switch on, run, and the drafts, the run row and the Overnight line are there", () => {
  it("morning-brief: a BRIEFING plus follow-ups in the queue, a run row, and a digest line that links to the queue", async () => {
    const f = firm({ t: NOW });
    const out = await run(f, "morning-brief");
    expect(out).toMatchObject({ status: "ok", result: { draftsOut: 3 } });
    expect(types(f, "morning-brief").sort()).toEqual(["BRIEFING", "CLIENT_EMAIL", "CLIENT_EMAIL"]);
    const rows = f.db.tables.agent_run;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agent: "morning-brief", status: "ok", drafts_out: 3, error: null });
    const digest = buildRunDigest(digestRows(f), new Date(NOW + 60_000));
    expect(digest).toMatchObject({ status: "ok" });
    expect((digest as { lines: Array<{ text: string; href: string }> }).lines[0]).toMatchObject({ text: "wrote the morning brief · 2 follow-ups drafted (in the Queue)", href: "/dashboard/queue/" });
  });

  it("consult-prep: two drafts per consult, and the prep is recorded", async () => {
    const f = firm({ t: NOW });
    const out = await run(f, "consult-prep");
    expect(out).toMatchObject({ status: "ok", result: { itemsIn: 2, draftsOut: 4 } });
    expect(types(f, "consult-prep").sort()).toEqual(["BRIEFING", "BRIEFING", "CLIENT_EMAIL", "CLIENT_EMAIL"]);
    expect(f.db.tables.crm_activity.filter((r) => r.type === "queue_drafted")).toHaveLength(4);
    const digest = buildRunDigest(digestRows(f), new Date(NOW + 60_000)) as { lines: Array<{ text: string; href: string }> };
    expect(digest.lines[0]).toMatchObject({ text: "prepped 2 consults · 4 drafts (in the Queue)", href: "/dashboard/queue/" });
  });

  it("inbox-summary: one digest in the queue and Outlook drafts in the fake mailbox", async () => {
    const f = firm({ t: NOW });
    const out = await run(f, "inbox-summary");
    expect(out).toMatchObject({ status: "ok", result: { itemsIn: 2, draftsOut: 2 } });
    expect(types(f, "inbox-summary")).toEqual(["BRIEFING"]);
    expect(f.outlookDrafts).toHaveLength(1);
    expect(f.outlookDrafts[0]).toMatchObject({ subject: "Re: Please advise on the filing", to: ["pat@client.example"] });
    const digest = buildRunDigest(digestRows(f), new Date(NOW + 60_000)) as { lines: Array<{ text: string }> };
    expect(digest.lines[0].text).toBe("summarised the inbox (2 messages) · 1 reply draft in Outlook");
  });
});

describe("D2: the autonomy level changes what is written, and the card says which", () => {
  it("suggest writes the internal item only; draft writes the full set", async () => {
    for (const [agent, suggestOnly, full] of [
      ["morning-brief", ["BRIEFING"], ["BRIEFING", "CLIENT_EMAIL", "CLIENT_EMAIL"]],
      ["consult-prep", ["BRIEFING", "BRIEFING"], ["BRIEFING", "BRIEFING", "CLIENT_EMAIL", "CLIENT_EMAIL"]],
      ["inbox-summary", ["BRIEFING"], ["BRIEFING"]],
    ] as const) {
      const s = firm({ t: NOW });
      await run(s, agent, "suggest");
      expect(types(s, agent).sort()).toEqual([...suggestOnly].sort());
      expect(s.outlookDrafts).toHaveLength(0);
      const d = firm({ t: NOW });
      await run(d, agent, "draft");
      expect(types(d, agent).sort()).toEqual([...full].sort());
      expect(autonomyHint(agent, "suggest")).not.toBe(autonomyHint(agent, "draft"));
    }
    const s = firm({ t: NOW });
    await run(s, "inbox-summary", "suggest");
    const d = firm({ t: NOW });
    await run(d, "inbox-summary", "draft");
    expect(s.outlookDrafts).toHaveLength(0);
    expect(d.outlookDrafts).toHaveLength(1);
  });
});

describe("D5: twice on the same data, then the next day", () => {
  it("creates no second prep, no second Outlook draft and no second follow-up for the same lead", async () => {
    const f = firm({ t: NOW });
    await run(f, "morning-brief");
    await run(f, "consult-prep");
    await run(f, "inbox-summary");
    const first = { queue: f.queue.length, outlook: f.outlookDrafts.length, followUps: f.queue.filter((q) => q.type === "CLIENT_EMAIL" && q.agent === "morning-brief").length, prepped: f.queue.filter((q) => q.agent === "consult-prep").length };
    expect(first).toMatchObject({ outlook: 1, followUps: 2, prepped: 4 });

    await run(f, "morning-brief");
    await run(f, "consult-prep");
    await run(f, "inbox-summary");
    expect(f.outlookDrafts).toHaveLength(1); // the Drafts folder already holds it
    expect(f.queue.filter((q) => q.type === "CLIENT_EMAIL" && q.agent === "morning-brief")).toHaveLength(2); // the pending follow-ups and the 7-day rule hold
    expect(f.queue.filter((q) => q.agent === "consult-prep")).toHaveLength(4); // the event ids are recorded
    // each lead still has exactly one pending follow-up
    const recipients = f.queue.filter((q) => q.agent === "morning-brief" && q.type === "CLIENT_EMAIL").map((q) => q.recipient).sort();
    expect(recipients).toEqual(["dana@client.example", "lee@client.example"]);
  });

  it("the next day's morning brief and inbox digest are new drafts with a different dated headline", async () => {
    const clock = { t: NOW };
    const f = firm(clock);
    await run(f, "morning-brief");
    await run(f, "inbox-summary");
    const today = f.queue.filter((q) => q.type === "BRIEFING").map((q) => q.headline);
    clock.t = NOW + DAY;
    await run(f, "morning-brief");
    await run(f, "inbox-summary");
    const all = f.queue.filter((q) => q.type === "BRIEFING");
    expect(all).toHaveLength(4);
    const tomorrow = all.map((q) => q.headline).filter((h) => !today.includes(h));
    expect(tomorrow).toHaveLength(2);
    expect(tomorrow.every((h) => /Sat Sep 26, 2026$/.test(h))).toBe(true);
    expect(today.every((h) => /Fri Sep 25, 2026$/.test(h))).toBe(true);
  });
});
