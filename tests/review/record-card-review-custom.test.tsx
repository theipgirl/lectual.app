import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RecordCardLoad } from "@/lib/record-card/model";
import type { FirmColumnsBlock } from "@/lib/custom-columns/rules";
import { CUSTOM_COLUMNS_NOT_ON, CUSTOM_FROM_LEAD, CUSTOM_FROM_MERGED, DECK_COULDNT_LOAD, FIRM_COLUMNS_HEADING } from "@/lib/ui/words";
import { NOW, TZ, facts as stepFacts } from "../lead-step/fixtures";
import { row, TODAY } from "./fixtures";
import { customFixture, members as listMembers } from "./columns-fixtures";
import { mockPage, renderPage, spies } from "./custom-page-harness";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/dashboard/review/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/voice/notes", () => ({ voiceNotePlaybackUrls: async () => ({}) }));

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const members = [{ userId: "u-reb", name: "Rebecca" }];
const okBlock: FirmColumnsBlock = {
  status: "ok",
  items: [
    { label: "Priority", cell: { text: "High", tone: "value", title: CUSTOM_FROM_LEAD } },
    { label: "Brand note", cell: { text: "Met at the expo", tone: "value", title: CUSTOM_FROM_MERGED } },
    { label: "Quoted fee", cell: { text: "—", tone: "none" } },
  ],
};

async function aside(rowOrNull: ReturnType<typeof row> | null, firmColumns: FirmColumnsBlock | null) {
  const { ReviewCardAside } = await import("@/components/review/ReviewCardExtras");
  return decode(renderToStaticMarkup(<ReviewCardAside open={{ kind: "lead", id: "l-1" }} row={rowOrNull} members={members} today={TODAY} stagesFailed={false} closeStages={[]} firmColumns={firmColumns} />));
}
const block = (html: string) => /<div class="rv-cardx-firm"[\s\S]*?<\/div>(?=<\/section>|<form|<div class="rv-lost)/.exec(html)?.[0] ?? (html.includes("rv-cardx-firm") ? html.slice(html.indexOf('<div class="rv-cardx-firm"')) : "");

describe("ReviewCardAside: the Firm columns block, three states, both branches", () => {
  for (const [name, r] of [["a record on the review", row({ key: "l", kind: "lead", id: "l-1" })], ["a record not on the review (row null)", null]] as const) {
    describe(name, () => {
      it("ok: label and value per field, the lead and merged titles kept, a dash quiet", async () => {
        const html = await aside(r, okBlock);
        const b = block(html);
        expect(b).toContain(`<h4 class="lx-label">${FIRM_COLUMNS_HEADING}</h4>`);
        expect(b).toMatch(/<dt class="lx-label">Priority<\/dt><dd><span title="From the lead">High<\/span><\/dd>/);
        expect(b).toMatch(/<dt class="lx-label">Brand note<\/dt><dd><span title="From a merged duplicate">Met at the expo<\/span><\/dd>/);
        expect(b).toMatch(/<dt class="lx-label">Quoted fee<\/dt><dd><span class="lx-note">—<\/span><\/dd>/);
        if (r === null) expect(html.indexOf("isn't on the weekly review")).toBeLessThan(html.indexOf("rv-cardx-firm"));
      });
      it("ok with no fields for this record: no block", async () => {
        expect(await aside(r, { status: "ok", items: [] })).not.toContain("rv-cardx-firm");
        expect(await aside(r, null)).not.toContain("rv-cardx-firm");
      });
      it("not switched on: one quiet line", async () => {
        const b = block(await aside(r, { status: "not-set-up" }));
        expect(b).toContain(`<p class="lx-note">${CUSTOM_COLUMNS_NOT_ON}</p>`);
        expect(b).not.toContain("<dl");
      });
      it("couldn't load: says so, never a dash", async () => {
        const b = block(await aside(r, { status: "unavailable" }));
        expect(b).toContain(`role="status">${DECK_COULDNT_LOAD}</p>`);
        expect(b).not.toContain("—");
        expect(b).not.toContain("<dl");
      });
    });
  }
});

/* ── The page: which read feeds the block ── */

const KEEPER = "00000000-0000-4000-8000-0000000000d1"; // the List fixture's lead, a review row
const OTHER = "00000000-0000-4000-8000-0000000000e9"; // a lead that is NOT on the review
const MERGED = "00000000-0000-4000-8000-0000000000e8";
const leadCard = (id: string, role = "attorney"): RecordCardLoad =>
  ({
    status: "ok", kind: "lead", role, now: NOW, timeZone: TZ,
    lead: { id, first_name: "Jo", last_name: "Lee", business_name: "Cedar Works", mark_text: null, email: null, phone: null, current_stage_id: "s1", assigned_to: null, referral_source: null, last_activity_at: null, last_inbound_at: null, last_outbound_at: null, lane: null, lane_set_at: null, ai_summary: null },
    stages: { status: "ok", value: [{ id: "s1", name: "Consult", category: "open" }] }, members: { status: "ok", value: [] },
    tags: { status: "ok", value: { on: [], catalog: [] } },
    leadStep: { status: "ok", facts: stepFacts() },
    approvals: { status: "ok", queueIds: [] }, proposal: { status: "not-set-up" },
    documents: { status: "ok", value: { files: { status: "ok", files: [], capped: false }, letters: null } },
    temperature: null, mergeAvailable: false, duplicateOf: null,
  }) as RecordCardLoad;
const matterCard = (id: string, type: string | null, leadId: string | null): RecordCardLoad =>
  ({
    status: "ok", kind: "matter", role: "attorney", now: NOW, timeZone: TZ,
    matter: { id, title: "Supply agreement", mark_text: null, owner_name: "Birch Goods", matter_number: "BL-1", stage_id: null, assigned_to: null, referral_source: null, type, lead_id: leadId },
    stages: { status: "ok", value: [] }, members: { status: "ok", value: [] }, tasks: { status: "ok", value: [] },
    activity: { status: "ok", value: { rows: [], truncated: false } }, deadline: { status: "ok", value: null },
    documents: { status: "ok", value: { files: { status: "ok", files: [], capped: false }, letters: null } },
  }) as RecordCardLoad;
const listRows = [row({ key: "l-1", kind: "lead", id: KEEPER, client: "Jo Lee" })];
const load = (custom: unknown) => ({ status: "ok", rows: listRows, today: TODAY, timeZone: "America/New_York", members: listMembers, failed: [], closeStages: [], custom });

describe("the page decides which read feeds the card's Firm columns", () => {
  beforeEach(() => vi.resetModules());

  it("a record NOT on the review: ONE scoped read for the keeper id the card resolved (a merged lead opened by URL)", async () => {
    mockPage({ load: load(customFixture), role: "attorney", card: leadCard(OTHER), cardCustom: { status: "not-set-up" } });
    const html = decode(await renderPage({ view: "sheet", open: `lead:${MERGED}` }));
    expect(spies.cardCustom).toHaveBeenCalledTimes(1);
    expect(spies.cardCustom.mock.calls[0][0]).toEqual({ kind: "lead", id: OTHER });
    expect(html).toContain(CUSTOM_COLUMNS_NOT_ON);
    expect(html).toContain("isn't on the weekly review");
  });

  it("a review row on the List: no extra read; the block comes from the List's own read", async () => {
    mockPage({ load: load(customFixture), role: "attorney", card: leadCard(KEEPER) });
    const html = decode(await renderPage({ view: "sheet", open: `lead:${KEEPER}` }));
    expect(spies.cardCustom).not.toHaveBeenCalled();
    expect(html).toContain(FIRM_COLUMNS_HEADING);
    expect(html).toMatch(/<dt class="lx-label">Priority<\/dt><dd><span>Urgent \(old\)<\/span><\/dd>/);
  });

  it("the same review row on the Board (no List read): the one card read", async () => {
    mockPage({ load: load(null), role: "attorney", card: leadCard(KEEPER), cardCustom: { status: "unavailable" } });
    const html = decode(await renderPage({ open: `lead:${KEEPER}` }));
    expect(spies.cardCustom).toHaveBeenCalledTimes(1);
    expect(spies.cardCustom.mock.calls[0][0]).toEqual({ kind: "lead", id: KEEPER });
    expect(html).toContain(FIRM_COLUMNS_HEADING);
    expect(html).toContain(`role="status">${DECK_COULDNT_LOAD}</p>`);
  });

  it("a matter not on the review reads with its own lead, and its section follows its type", async () => {
    mockPage({ load: load(null), role: "attorney", card: matterCard("00000000-0000-4000-8000-0000000000b9", "BL", "00000000-0000-4000-8000-0000000000e7"), cardCustom: customFixture });
    const html = decode(await renderPage({ open: "matter:00000000-0000-4000-8000-0000000000b9" }));
    expect(spies.cardCustom.mock.calls[0][0]).toEqual({ kind: "matter", id: "00000000-0000-4000-8000-0000000000b9", leadId: "00000000-0000-4000-8000-0000000000e7" });
    // a Contracts matter: the contracts and both fields only
    expect(html).toContain('<dt class="lx-label">Signed on</dt>');
    expect(html).toContain('<dt class="lx-label">Review cycle</dt>');
    expect(html).not.toContain('<dt class="lx-label">Priority</dt>');
  });

  it("no card (not found or couldn't load): no read and no block", async () => {
    for (const card of [{ status: "not-found" }, { status: "unavailable" }]) {
      vi.resetModules();
      mockPage({ load: load(null), role: "attorney", card });
      const html = await renderPage({ open: `lead:${OTHER}` });
      expect(spies.cardCustom).not.toHaveBeenCalled();
      expect(html).not.toContain("rv-cardx-firm");
    }
  });
});
