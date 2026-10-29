import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NOT_OPENED_YET,
  OPENS_UNAVAILABLE,
  opensKind,
  opensListText,
  opensPageText,
  summarizeOpens,
  type OpensRead,
} from "@/lib/proposals/opens";
import { buildProposalRowView, type ListRowInput } from "@/lib/proposals/list-rows";
import { ProposalsTable } from "@/components/proposal-list/ProposalsTable";
import { renderListPage, rowOf } from "./list-page-harness";

vi.mock("@/app/dashboard/proposals/[id]/paid-actions", () => ({ markPaidAction: vi.fn(), undoPaidAction: vi.fn() }));

/** Spec 7, Part B: "Opened" visible in Lectual, from the `viewed` events the client page already records. */

const TZ = "America/New_York";
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("<!-- -->", "");
// 19:12 UTC on Oct 29 is 3:12 PM in New York.
const OPENED: OpensRead = new Map([["p1", { count: 4, lastAt: "2026-10-29T19:12:00+00:00" }]]);

describe("summarizeOpens: only the client's viewed events count", () => {
  it("counts per version and keeps the newest time, in either timestamp shape", () => {
    const m = summarizeOpens([
      { proposal_id: "p1", type: "viewed", actor: "client", created_at: "2026-10-28 10:00:00+00" },
      { proposal_id: "p1", type: "viewed", actor: "client", created_at: "2026-10-29T19:12:00+00:00" },
      { proposal_id: "p1", type: "viewed", actor: "client", created_at: "2026-10-27T09:00:00Z" },
      { proposal_id: "p2", type: "viewed", actor: "client", created_at: "2026-10-20T09:00:00Z" },
    ]);
    expect(m.get("p1")).toEqual({ count: 3, lastAt: "2026-10-29T19:12:00+00:00" });
    expect(m.get("p2")?.count).toBe(1);
  });

  it("ignores staff, agent and system rows and every other event type", () => {
    const m = summarizeOpens([
      { proposal_id: "p1", type: "viewed", actor: "staff", created_at: "2026-10-29T19:12:00Z" },
      { proposal_id: "p1", type: "viewed", actor: "system", created_at: "2026-10-29T19:12:00Z" },
      { proposal_id: "p1", type: "accepted", actor: "client", created_at: "2026-10-29T19:12:00Z" },
      { proposal_id: "p1", type: "viewed", actor: "client", created_at: 5 },
    ]);
    expect(m.size).toBe(0);
  });
});

describe("the words, three states (and a dash before the link is live)", () => {
  it("opened: 'Opened Oct 29, 3:12 PM · 4 times' on the list, 'Opened by the client 4 times · last opened Oct 29, 3:12 PM' on the page", () => {
    expect(opensListText("sent", OPENED, "p1", TZ)).toBe("Opened Oct 29, 3:12 PM · 4 times");
    expect(opensPageText("sent", OPENED, "p1", TZ)).toBe("Opened by the client 4 times · last opened Oct 29, 3:12 PM");
    const once: OpensRead = new Map([["p1", { count: 1, lastAt: "2026-10-29T19:12:00Z" }]]);
    expect(opensListText("accepted", once, "p1", TZ)).toBe("Opened Oct 29, 3:12 PM · once");
    expect(opensPageText("accepted", once, "p1", TZ)).toBe("Opened by the client once · last opened Oct 29, 3:12 PM");
  });

  it("not opened: 'Not opened yet' for a live link", () => {
    expect(opensListText("sent", new Map(), "p1", TZ)).toBe(NOT_OPENED_YET);
    expect(opensPageText("sent", new Map(), "p1", TZ)).toBe("Not opened by the client yet");
    expect(opensListText("withdrawn", new Map(), "p1", TZ)).toBe("Not opened");
  });

  it("a failed read is 'Couldn't load opens', never 'Not opened yet'", () => {
    for (const status of ["sent", "accepted", "superseded", "withdrawn"]) {
      expect(opensListText(status, "unavailable", "p1", TZ)).toBe(OPENS_UNAVAILABLE);
      expect(opensPageText(status, "unavailable", "p1", TZ)).toBe(OPENS_UNAVAILABLE);
      expect(opensKind(status, "unavailable", "p1")).toBe("unavailable");
    }
    expect(OPENS_UNAVAILABLE).toBe("Couldn't load opens");
  });

  it("a draft or saved version (no live link) is a dash on the list and nothing on the page, even if the read failed", () => {
    for (const status of ["draft", "approved"]) {
      expect(opensListText(status, OPENED, "p1", TZ)).toBe("—");
      expect(opensListText(status, "unavailable", "p1", TZ)).toBe("—");
      expect(opensPageText(status, OPENED, "p1", TZ)).toBeNull();
    }
  });
});

function input(over: Partial<ListRowInput> = {}): ListRowInput {
  return {
    id: "p1",
    family_id: "ab12cd34-0000-4000-8000-000000000000",
    version: 1,
    client_name: "Danielle Milton",
    title: "Trademark package",
    status: "sent",
    source: "manual",
    expires_on: "2026-11-28",
    accepted_at: null,
    updated_at: "2026-10-26T13:00:00Z",
    legal_total_cents: 547_000,
    gov_total_cents: 140_000,
    blocking_issue: null,
    brands: ["The Fold"],
    offered: [{ name: "Enhanced", legalAtSigningCents: 325_000, usptoAtFilingCents: 70_000 }],
    class_count: 2,
    signed_package: null,
    package_basis: null,
    ...over,
  };
}
const ctx = (opens?: OpensRead) => ({ today: "2026-10-29", tz: TZ, now: Date.parse("2026-10-29T20:00:00Z"), events: new Map(), names: new Map(), ...(opens !== undefined ? { opens } : {}) });

describe("the list cell, rendered", () => {
  const cell = (over: Partial<ListRowInput>, opens?: OpensRead) => {
    const html = text(renderToStaticMarkup(<ProposalsTable rows={[buildProposalRowView(input(over), ctx(opens))]} footerLeft="" footerRight="" />));
    const m = /<div class="pq-mono pq-sub pq-opens" data-opens="([a-z_]+)">([^<]*)<\/div>/.exec(html);
    return m ? { kind: m[1], text: m[2], html } : { kind: null, text: null, html };
  };

  it("opened", () => {
    expect(cell({}, OPENED)).toMatchObject({ kind: "opened", text: "Opened Oct 29, 3:12 PM · 4 times" });
  });

  it("not opened yet", () => {
    expect(cell({}, new Map())).toMatchObject({ kind: "not_opened", text: "Not opened yet" });
  });

  it("couldn't load", () => {
    expect(cell({}, "unavailable")).toMatchObject({ kind: "unavailable", text: "Couldn't load opens" });
  });

  it("a draft is a dash", () => {
    expect(cell({ status: "draft" }, OPENED)).toMatchObject({ kind: "no_link", text: "—" });
  });

  it("no line at all when the opens weren't asked for", () => {
    expect(cell({}).kind).toBeNull();
  });
});

describe("the list page reads opens once and shows them per row", () => {
  beforeEach(() => vi.resetModules());

  it("an opened live row, a live row not opened, a draft", async () => {
    const html = text(await renderListPage({}, { opens: new Map([["s1", { count: 2, lastAt: "2026-10-29T19:12:00Z" }]]) }));
    expect(rowOf(html, "Client s1")).toContain("Opened Oct 29, 3:12 PM · 2 times");
    expect(rowOf(html, "Client e1")).toContain("Not opened yet");
    expect(rowOf(html, "Client a1")).toContain('data-opens="no_link"');
  });

  it("a failed read says so on every live row, and never 'Not opened yet'", async () => {
    const html = text(await renderListPage({}, { opens: "fail" }));
    expect(rowOf(html, "Client s1")).toContain("Couldn't load opens");
    expect(html).not.toContain("Not opened yet");
  });
});

describe("guards", () => {
  it("the store reads only the client's viewed events and never selects the payload", () => {
    const src = readFileSync("src/lib/proposals/store.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function listProposalOpens"), src.indexOf("export type ProposalLatestEvent"));
    expect(fn).toContain('.select("proposal_id, type, actor, created_at")');
    expect(fn).toContain('.eq("type", "viewed")');
    expect(fn).toContain('.eq("actor", "client")');
    expect(fn).toContain("getScopedClient()");
    expect(fn).not.toMatch(/payload|getAdminClient|console\./);
  });
});
