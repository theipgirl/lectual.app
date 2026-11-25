import { describe, expect, it } from "vitest";
import { isFullBrief, pickAdoption, adoptableItems } from "@/lib/consult-prep/adopt";
import { resolveBatch } from "@/lib/queue/resolve-batch";
import type { QueueItem } from "@/lib/queue/api";
import type { StopDb } from "@/lib/campaigns/stop-db";

/**
 * The lectual-plugin prep-consult skill (branch claude/gracious-darwin-rceoyv, Nov 25) now queues its FULL BRIEF as a BRIEFING
 * from agent `prep-consult`, with `recipient` = the client's email on record, so Lectual adopts it instead of building a
 * second, thinner prep. These cases pin that the skill's canonical BRIEF FORMAT (copied below as the skill fills it in) is
 * read as full, that the recipient links it to exactly the client's lead, and that the general-matter path is not adopted.
 */

const LEAD = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

// The skill's § BRIEF FORMAT, trademark path, filled in as a model would.
const SKILL_FULL = `Full pre-consult brief
Matter: New — Trademark intake (submitted Nov 20, 2026, 3:14 PM)
Prepared: Nov 25, 2026 · Session: Wednesday, Nov 26, 2026, 2:00 PM EST
Client snapshot — Dana Ruiz runs a small skincare brand, Lumora Botanics, selling online since 2025.
Mark(s) submitted — LUMORA BOTANICS, word mark, for skin creams and serums.
Prior call — None on record (form only).

— TRADEMARK PATH (omit on the general-matter path) —
Likely classes — preliminary — Class 3 (skin creams, serums); Class 35 only if she runs a retail store for others' goods.
Preliminary risk read — preliminary — Several LUMORA-formative marks in Class 3 are live; attorney to confirm via TESS.
Package recommendation — Enhanced: one mark, one class, with the knockout already showing conflicts worth an opinion.

Questions for Rebecca
* When did she first sell under the name?
* Does she plan a logo filing too?
* Any other brands in the pipeline?
`;

// The general-matter path has no classes, risk or package sections: Lectual builds its own prep.
const SKILL_GENERAL = `Full pre-consult brief
Matter: New — Contracts intake (submitted Nov 20, 2026)
Prepared: Nov 25, 2026 · Session: pending — pull from Appointment Scheduled activity
Client snapshot — Owner of a studio asking about a vendor agreement.
Mark(s) submitted — None; not a trademark filing

— GENERAL-MATTER PATH (omit on the trademark path) —
Scope & engagement — Review of one vendor agreement; she should send the draft before the call.

Questions for Rebecca
* Who drafted the agreement?
`;

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: "q-skill-1",
  org_id: "org",
  matter_id: null,
  agent: "prep-consult",
  type: "BRIEFING",
  headline: "Consult prep for Dana Ruiz",
  summary: null,
  draft_body: SKILL_FULL,
  final_body: null,
  status: "pending",
  created_at: "2026-11-25T14:00:00.000Z",
  client_name: "Dana Ruiz",
  recipient: "Dana.Ruiz@example.com",
  subject: "Consult prep: Dana Ruiz",
  proposed_send_at: null,
  attachments: null,
  resolved_by: null,
  resolved_at: null,
  resolution_note: null,
  ...over,
});

type Row = Record<string, unknown>;

/** Just enough PostgREST for resolveBatch: select / eq / in / is, awaited. */
function fakeDb(tables: Record<string, Row[]>): StopDb {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
      is: (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), q),
      in: (col: string, vs: unknown[]) => {
        const m = /^payload->>(.+)$/.exec(col);
        filters.push((r) => vs.includes(m ? (r.payload as Row | undefined)?.[m[1]] : r[col]));
        return q;
      },
      then: (ok: (v: { data: Row[]; error: null }) => unknown) => ok({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null }),
    };
    return q;
  };
  return { from } as unknown as StopDb;
}

describe("the prep-consult skill's queued full brief", () => {
  it("its trademark-path brief is a full prep", () => {
    expect(isFullBrief(SKILL_FULL)).toBe(true);
  });

  it("its general-matter brief is not, so Lectual builds its own", () => {
    expect(isFullBrief(SKILL_GENERAL)).toBe(false);
  });

  it("a brief with a section left TBD is not full", () => {
    expect(isFullBrief(SKILL_FULL.replace(/Package recommendation — .*/, "Package recommendation — TBD"))).toBe(false);
  });

  it("the client's email as recipient links it to exactly that lead, and it is adopted for that lead only", async () => {
    const db = fakeDb({
      crm_activity: [],
      crm_lead: [
        { id: LEAD, email: "dana.ruiz@example.com", merged_into_id: null },
        { id: OTHER, email: "someone@example.com", merged_into_id: null },
      ],
    });
    const it1 = item();
    const resolved = await resolveBatch(db, [it1]);
    expect(resolved.get(it1.id)?.leadIds).toEqual([LEAD]);
    const candidates = adoptableItems([it1], Date.parse("2026-11-25T05:00:00.000Z"));
    expect(pickAdoption(candidates, resolved, LEAD)?.id).toBe(it1.id);
    expect(pickAdoption(candidates, resolved, OTHER)).toBeNull();
  });

  it("with no recipient (no email on record) it links to no lead and is not adopted", async () => {
    const db = fakeDb({ crm_activity: [], crm_lead: [{ id: LEAD, email: "dana.ruiz@example.com", merged_into_id: null }] });
    const it1 = item({ recipient: null });
    const resolved = await resolveBatch(db, [it1]);
    expect(resolved.has(it1.id)).toBe(false);
    expect(pickAdoption(adoptableItems([it1], 0), resolved, LEAD)).toBeNull();
  });

  it("an address on two leads names both, so it is not adopted for either (never a guess)", async () => {
    const db = fakeDb({
      crm_activity: [],
      crm_lead: [
        { id: LEAD, email: "dana.ruiz@example.com", merged_into_id: null },
        { id: OTHER, email: "dana.ruiz@example.com", merged_into_id: null },
      ],
    });
    const it1 = item();
    const resolved = await resolveBatch(db, [it1]);
    const candidates = adoptableItems([it1], 0);
    expect(pickAdoption(candidates, resolved, LEAD)).toBeNull();
    expect(pickAdoption(candidates, resolved, OTHER)).toBeNull();
  });
});

describe("isFullBrief reads the skill's inline labels", () => {
  it("a placeholder on the label's own line is an empty section, even when another line follows", () => {
    expect(isFullBrief("Likely classes: Class 3\nRisk read: low\nPackage recommendation: n/a\nQuestions for Rebecca\n* one")).toBe(false);
  });
  it("'preliminary —' alone is not content; content after it or on the next line is", () => {
    expect(isFullBrief(SKILL_FULL.replace(/Likely classes — preliminary — .*/, "Likely classes — preliminary — TBD"))).toBe(false);
    expect(isFullBrief(SKILL_FULL.replace(/Likely classes — preliminary — .*/, "Likely classes — preliminary —\nClass 3 (skin creams)"))).toBe(true);
  });
});
