import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ROWS, item, PACKAGES, renderListPage as render, rowOf, segments, type Opts } from "./list-page-harness";

/**
 * The Quotes & proposals page (Sprint 6, B): header and subtitle from the firm's packages, the
 * segment column and the "Out with clients" tile, the table's columns, the footer and the note,
 * and what each failed read does. Every failure has its own text; none of them is "$0.00",
 * "No proposals yet" or an empty strip.
 */

const settingsWith = (packages: unknown[]) => ({ pricing: { packages }, default_pay_url: null });
const THREE = [
  { ...PACKAGES[0], gov_per_class_cents: 40_000, per_class_cents: 90_000 },
  { package: "Enhanced", base_cents: 325_000, included_classes: 2, per_class_cents: 70_000, second_mark_discount_pct: 15, gov_per_class_cents: 35_000 },
  { package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 60_000, second_mark_discount_pct: 10, gov_per_class_cents: 35_000 },
];

describe("Quotes & proposals page", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T16:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const go = (search: { segment?: string; status?: string } = {}, opts: Opts = {}) => render(search, opts);

  describe("header", () => {
    it("shows the title, the subtitle with the package count (plural), and New proposal", async () => {
      const html = await go({}, { settings: settingsWith(THREE) });
      expect(html).toContain("Quotes &amp; proposals");
      expect(html).toContain("3 published packages, priced per class. Legal fees fall due at signing, USPTO fees at filing, and the two never add into one number.");
      expect(html).toMatch(/href="\/dashboard\/proposals\/new\/?"[^>]*>New proposal</);
      expect(html).not.toContain("Client proposals</h1>");
    });

    it("uses the singular for one package", async () => {
      const html = await go({}, { settings: settingsWith([PACKAGES[0]]) });
      expect(html).toContain("1 published package, priced per class.");
      expect(html).not.toContain("1 published packages");
    });

    it("a legacy firm (flat fields) has one package; a firm with no settings row has the default one", async () => {
      expect(await go({}, { settings: { pricing: { package: "Signature", base_cents: 650_000 }, default_pay_url: null } })).toContain("1 published package,");
      vi.resetModules();
      expect(await go({}, { settings: null })).toContain("1 published package,");
    });

    it("hides New proposal from a role that can't start one, and shows Settings only to admins", async () => {
      const viewer = await go({}, { role: "viewer" });
      expect(viewer).not.toContain("New proposal");
      expect(viewer).not.toContain(">Settings<");
      vi.resetModules();
      const owner = await go();
      expect(owner).toContain(">Settings<");
    });
  });

  describe("segments and the Out with clients tile", () => {
    it("shows the five segments with counts from the unfiltered set, under a SEGMENTS label", async () => {
      const html = await go();
      expect(html).toContain(">Segments<");
      expect(segments(html)).toEqual(["Everything:8", "Out with a client:1", "Drafts and blocked:3", "Accepted:1", "Expired:2"]);
    });

    it("?segment=out filters the table and highlights that segment; the counts do not move", async () => {
      const html = await go({ segment: "out" });
      expect(html).toContain("Client s1");
      for (const other of ["a1", "a2", "b1", "e1", "e2", "c1", "x1"]) expect(html).not.toContain(`Client ${other}<`);
      expect(html).toMatch(/aria-current="page"[^>]*><span>Out with a client/);
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
      expect(segments(html)).toEqual(["Everything:8", "Out with a client:1", "Drafts and blocked:3", "Accepted:1", "Expired:2"]);
    });

    it("each segment's count matches the rows shown for it", async () => {
      const counts: Record<string, number> = { everything: 8, out: 1, drafts: 3, accepted: 1, expired: 2 };
      for (const [seg, n] of Object.entries(counts)) {
        vi.resetModules();
        const html = await go({ segment: seg });
        expect(html.match(/<tr data-status/g)?.length ?? 0, seg).toBe(n);
      }
    });

    it("the tile shows the cheapest offered package's legal fee for each Sent proposal, never a USPTO fee", async () => {
      const rows = [
        item("s1", { status: "sent", offered: [{ name: "Concierge", legalAtSigningCents: 495_000, usptoAtFilingCents: 175_000 }, { name: "Essential", legalAtSigningCents: 195_000, usptoAtFilingCents: 35_000 }] }),
        item("s2", { status: "sent", offered: [{ name: "Concierge", legalAtSigningCents: 660_000, usptoAtFilingCents: 175_000 }] }),
        item("e1", { status: "sent", expires_on: "2026-10-10" }),
        item("d1"),
      ];
      const html = await go({}, { rows });
      expect(html).toContain("$8,550.00");
      expect(html).toContain("2 proposals are out with a client, counted at the cheapest package offered.");
      expect(html).toContain(">Out with clients<");
    });

    it("one proposal out reads in the singular, as in the design", async () => {
      const html = await go({}, { rows: [item("s1", { status: "sent", offered: [{ name: "Concierge", legalAtSigningCents: 660_000, usptoAtFilingCents: 175_000 }] })] });
      expect(html).toContain("$6,600.00");
      expect(html).toContain("1 proposal is out with a client, counted at the cheapest package offered.");
    });

    it("nothing out is a real $0.00 with its own sentence", async () => {
      const html = await go({}, { rows: [item("d1")] });
      expect(html).toContain("$0.00");
      expect(html).toContain("No proposals are out with a client.");
    });

    it("a failed proposals read shows — and 'couldn't be loaded', never $0.00, and no counts", async () => {
      const html = await go({}, { rows: "fail" });
      expect(html).not.toContain("$0.00");
      expect(html).toContain("Out with clients couldn&#x27;t be loaded.");
      expect(html).toContain('class="pq-out-figure">—<');
      expect(html).not.toContain("pq-count");
    });
  });

  describe("the table", () => {
    it("has the nine columns in order (Accepted and Paid after Status), with the legal fee and the USPTO fees in two cells and no total", async () => {
      const html = await go();
      const heads = [...html.slice(html.indexOf("<thead")).matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]).slice(0, 9);
      expect(heads).toEqual(["Proposal", "Client", "Status", "Accepted", "Paid", "At signing", "At filing", "Expires", "Last activity"]);
      const row = rowOf(html, "Client s1<");
      expect([...row.matchAll(/<td class="pq-money[^"]*">([^<]*)<\/td>/g)].map((m) => m[1])).toEqual(["$4,950.00", "$700.00"]);
      expect(html.toLowerCase()).not.toContain("total");
      expect(html).not.toContain("$5,650.00");
    });

    it("renders the title with brands, the ref sub-line, expires and the last activity for the design's statuses", async () => {
      const rows = [
        item("s1", { status: "sent", source: "agent", brands: ["Oneforme Pilates"], class_count: 5, expires_on: "2026-10-28", client_name: "Irina Vilarino" }),
        item("c1", { status: "accepted", brands: ["Petra"], class_count: 2, signed_package: "Enhanced", accepted_at: "2026-09-09T15:00:00Z", client_name: "Maison Petra" }),
        item("e1", { status: "sent", brands: ["Orin", "Hale"], expires_on: "2026-09-04", class_count: 3, title: "Portfolio renewal", client_name: "Orin & Hale" }),
        item("d1", { expires_on: null, brands: ["Vela"], class_count: 1, client_name: "Vela Athletics" }),
        item("b1", { blocking_issue: "Name the package.", offered: [], expires_on: "2026-09-30", brands: ["Birchwood"], class_count: 2, client_name: "Birchwood Coffee Co." }),
      ];
      const html = await go({}, { rows });
      const sent = rowOf(html, "Irina Vilarino");
      expect(sent).toContain("Trademark Proposal — ONEFORME PILATES");
      expect(sent).toContain("1 package offered · 5 classes");
      expect(sent).toContain(">Oct 28<");
      expect(sent).toContain("Drafted by the intake agent from the consult");
      const acc = rowOf(html, "Maison Petra");
      expect(acc).toContain("ENHANCED signed · 2 classes");
      expect(acc).toContain("Signed 9 Sep");
      const exp = rowOf(html, "Orin &amp; Hale");
      expect(exp).toContain("Portfolio renewal — ORIN &amp; HALE");
      expect(exp).toContain("Expired Sep 4");
      expect(exp).toContain("Stored status still says sent");
      const draft = rowOf(html, "Vela Athletics");
      expect(draft).toContain("Not sent");
      const blocked = rowOf(html, "Birchwood Coffee Co.");
      expect(blocked).toContain("no package offered · 2 classes");
      expect(blocked).toContain("No package offered yet");
      expect(blocked).toContain("Sep 30");
    });

    it("names who edited, from the member directory, and drops the name when it can't be read", async () => {
      const events = new Map([["d1", { type: "edited", actor: "staff", actor_user_id: "u1", created_at: "2026-10-20T13:00:00Z" }]]);
      const directory = [{ userId: "u1", displayName: "Taylor McGhee", email: "t@firm.example", role: "owner" }];
      const withName = await go({}, { rows: [item("d1")], events, directory });
      expect(rowOf(withName, "Client d1<")).toContain("Edited 3h ago · Taylor");
      vi.resetModules();
      const noDirectory = await go({}, { rows: [item("d1")], events, directory: "fail" });
      expect(rowOf(noDirectory, "Client d1<")).toContain("Edited 3h ago");
      expect(rowOf(noDirectory, "Client d1<")).not.toContain("·  Taylor");
      expect(rowOf(noDirectory, "Client d1<")).not.toContain("u1");
    });

    it("a failed events read still renders every Last activity cell, with a derived line", async () => {
      const html = await go({}, { events: "fail" });
      expect(html).toContain('class="wrap pq-activity pq-c-activity"');
      for (const id of ["a1", "a2", "s1"]) expect(rowOf(html, `Client ${id}<`)).toMatch(/pq-c-activity">Updated 1d ago</);
      expect(rowOf(html, "Client e1<")).toContain("Stored status still says sent");
      expect(rowOf(html, "Client b1<")).toContain("Add the pay link before creating the link.");
      expect(html).not.toContain('pq-activity"><');
    });

    it("shows 'Edited from' in the sub-line when a field was changed from the package", async () => {
      const html = await go({}, { rows: [item("d1", { package_basis: { name: "Enhanced", edited: ["price"] } })] });
      expect(rowOf(html, "Client d1<")).toContain("edited from ENHANCED");
    });
  });

  describe("footer and note", () => {
    it("All <n> proposals on Everything, <x> of <n> on a segment", async () => {
      expect(await go()).toContain("All 8 proposals");
      vi.resetModules();
      expect(await go({ segment: "drafts" })).toContain("3 of 8 proposals");
    });

    it("reads the default package's per-class and USPTO amounts from the settings", async () => {
      const html = await go({}, { settings: settingsWith(THREE) });
      expect(html).toContain("Government filing fees are $400 per class, paid before the application goes in.");
      expect(html).toContain("Legal fees and USPTO fees never add into one number. Every class past the package adds $900 legal and $400 government.");
    });

    it("the design's figures: $350 government and $825 legal for Concierge", async () => {
      const html = await go();
      expect(html).toContain("Government filing fees are $350 per class");
      expect(html).toContain("adds $825 legal and $350 government.");
    });

    it("a failed settings read drops the dollar figures instead of inventing defaults", async () => {
      const html = await go({}, { settings: "fail" });
      expect(html).toContain("Published packages, priced per class.");
      expect(html).not.toMatch(/\d+ published package/);
      expect(html).toContain("Government filing fees are paid before the application goes in.");
      expect(html).toContain("Legal fees and USPTO fees never add into one number.");
      expect(html).not.toContain("$825");
      expect(html).not.toContain("$350 per class");
      expect(html).not.toContain("adds $");
      // the page itself still works
      expect(html).toContain("Client a1");
    });
  });

  describe("states", () => {
    it("a failed proposals read says it couldn't load, not that there are none", async () => {
      const html = await go({}, { rows: "fail" });
      expect(html).toContain("Proposals couldn&#x27;t be loaded");
      expect(html).not.toContain("No proposals yet");
      expect(html).not.toContain("<tbody");
    });

    it("an empty successful read is the empty state", async () => {
      const html = await go({}, { rows: [] });
      expect(html).toContain("No proposals yet");
      expect(html).toContain("Start one from a consult above");
    });

    it("still lists every proposal under Everything, Closed included", async () => {
      const html = await go();
      expect(html.match(/<tr data-status/g)).toHaveLength(ROWS.length);
    });
  });

  describe("the consults strip is on the page", () => {
    it("renders the strip's header and rows from the loader", async () => {
      const html = await go({}, {
        strip: {
          header: { title: "Zoom consults", status: { kind: "connected", text: "connected · last sync 6 min ago" } },
          meetings: {
            status: "ok",
            more: 0,
            rows: [{ id: "m1", provider: "zoom", clientName: "Sana Okafor", company: "Northbound Supply", line: "Zoom consult · yesterday · 28 min · transcript synced", state: "ready", proposalId: null, leadId: "l1" }],
          },
        },
      });
      expect(html).toContain("Zoom consults");
      expect(html).toContain("connected · last sync 6 min ago");
      expect(html).toContain("Sana Okafor");
      expect(html).toContain("Draft the proposal");
    });

    it("a failed meetings read shows Couldn't load consults, and the rest of the page still works", async () => {
      const html = await go({}, { strip: { header: { title: "Consults", status: { kind: "connected", text: "connected · no import yet" } }, meetings: { status: "unavailable" } } });
      expect(html).toContain("Couldn&#x27;t load consults");
      expect(html).not.toContain("No consults in the last");
      expect(html).toContain("Client a1");
    });
  });
});
