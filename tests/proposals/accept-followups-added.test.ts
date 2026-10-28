import { describe, it, expect, vi, afterEach } from "vitest";
import { acceptanceHeadline, acceptanceNoteBody, runAcceptanceFollowups, type FollowupDb } from "@/lib/proposals/accept-followups";
import { quoteWithClientClasses } from "@/lib/proposals/client-classes";
import { describeStepEvent } from "@/lib/proposals/paid";
import { buildAcceptedSnapshot } from "@/lib/proposals/public";
import type { FetchLike } from "@/lib/lawmatics/writes";
import { fakeFollowupDb } from "./followup-db";
import { sevetri } from "./fixture";

const SECRET = "ZQX-distinctive-client-wording";

function snapshotWithAdded() {
  const c = sevetri();
  c.pricing = { ...c.pricing, package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 82_500 };
  c.names = [{ ...c.names[0], classes: [c.names[0].classes[0]], client_add: { max: 2 } }];
  const priced = quoteWithClientClasses(c, { "p-word": true, "p-c1": true }, { entries: {}, added: { p: [{ text: SECRET, on: true }, { text: "Not ticked", on: false }] } });
  if (!priced.ok) throw new Error("priced");
  return buildAcceptedSnapshot({ version: 1, content: priced.content, selection: priced.selection, quote: priced.quote, acceptedAt: "2026-10-27T15:00:00.000Z" });
}

afterEach(() => vi.restoreAllMocks());

describe("accept follow-ups name the number of added classes and the new legal total, never the client's words", () => {
  const snap = snapshotWithAdded();

  it("the headline and the note carry the count and the legal total", () => {
    expect(snap.quote.legal_total_cents).toBe(277_500);
    expect(acceptanceHeadline({ clientName: "Sevetri", packageName: "Essential", legalTotalCents: snap.quote.legal_total_cents, addedClasses: 1 })).toBe(
      "Sevetri accepted Essential · legal $2,775 · 1 class added by the client",
    );
    const { body } = acceptanceNoteBody(snap, "Sevetri");
    expect(body).toContain("Classes added by the client: 1");
    expect(body).toContain("Legal fee, due when accepted: $2,775");
    expect(body).toContain("USPTO fees, due at filing: $700");
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain("Not ticked");
  });

  it("the notice payload, the Lawmatics request, the timeline events and every log call omit the client's text", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")].map((s) => s.mockImplementation(() => {}));
    const { db, tables } = fakeFollowupDb({
      client_proposal: [{ id: "prop-1", org_id: "org-1", family_id: "fam-1", status: "accepted", client_name: "Sevetri Wilson", client_email: null, lead_id: "lead-1", matter_id: null, accepted_snapshot: snap }],
      client_proposal_setting: [{ org_id: "org-1", approver_user_ids: ["u1"] }],
      crm_org_member: [{ org_id: "org-1", user_id: "u1", role: "owner" }],
      crm_lead: [{ id: "lead-1", org_id: "org-1", email: "s@example.com", lawmatics_id: "LM-1" }],
      crm_matter: [],
      client_proposal_event: [],
      crm_notification: [],
    });
    const sent: string[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      sent.push(init.body);
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
    };
    await runAcceptanceFollowups(db as FollowupDb, { proposalId: "prop-1", orgId: "org-1" }, { getToken: async () => "tok", fetchImpl });

    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain(SECRET);
    expect(sent[0]).toContain("Classes added by the client: 1");
    expect(JSON.stringify(tables.crm_notification)).not.toContain(SECRET);
    expect(JSON.stringify(tables.crm_notification)).toContain("1 class added by the client");
    expect(JSON.stringify(tables.client_proposal_event)).not.toContain(SECRET);
    for (const event of tables.client_proposal_event) {
      expect(event.payload).toMatchObject({ added_classes: 1, legal_total_cents: 277_500 });
    }
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
  });

  it("the timeline line says how many classes and the new legal fee", () => {
    const line = describeStepEvent({ step: "accept_notice", outcome: "sent", added_classes: 2, legal_total_cents: 442_500 });
    expect(line).toContain("2 classes added by the client");
    expect(line).toContain("legal fee now $4,425");
    expect(describeStepEvent({ step: "accept_notice", outcome: "sent" })).not.toContain("added by the client");
  });
});

describe("Spec 3: an open class the client described", () => {
  it("is COUNTED in the Lawmatics note, never quoted, and its question is not repeated", () => {
    const c = sevetri();
    c.pricing = { ...c.pricing, package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 82_500 };
    c.names = [{ ...c.names[0], classes: [{ id: "o1", label: "Describe what you sell", preselected: true, client_entry: true }] }];
    const priced = quoteWithClientClasses(c, { "p-word": true, o1: true }, { entries: { o1: "Scented candles" }, added: {} });
    if (!priced.ok) throw new Error("priced");
    const snap = buildAcceptedSnapshot({ version: 1, content: priced.content, selection: priced.selection, quote: priced.quote, acceptedAt: "2026-10-28T15:00:00.000Z" });
    const { body } = acceptanceNoteBody(snap, "Sevetri");
    expect(body).not.toContain("Scented candles");
    expect(body).toContain("Classes described by the client: 1");
    expect(body).not.toContain("Classes added by the client");
    expect(body).not.toContain("Describe what you sell");
  });
});
