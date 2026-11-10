import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NeedsReviewCard } from "@/components/today/NeedsReviewCard";
import { needsReviewItems, type NeedsReviewItem } from "@/lib/today/needs-review";
import type { UpcomingDeadline } from "@/lib/matters";

process.env.__NEXT_TRAILING_SLASH = "true";

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&apos;", "'").replaceAll("<!-- -->", "");
const item = (over: Partial<NeedsReviewItem> = {}): NeedsReviewItem => ({ key: "n1", href: "/dashboard/matters/m9/", name: "Response to office action", matter: "TM-9 · Old Mark", dueDate: "2025-01-15", daysPastDue: 299, ...over });
const row = (over: Partial<UpcomingDeadline> = {}) =>
  ({ id: "d1", matter_id: "m1", kind: "office_action_response", title: null, due_date: "2025-01-15", status: "open", attorney_confirmed: false, source: "manual", matter_number: "TM-1", matter_title: "The Fold", ...over }) as UpcomingDeadline;

describe("technician Today: Needs review card", () => {
  it("renders the items with matter, days past due and a matter link", () => {
    const html = text(renderToStaticMarkup(<NeedsReviewCard items={[item(), item({ key: "n2", daysPastDue: 1 })]} />));
    expect(html).toContain("Needs review");
    expect(html).toContain("Response to office action");
    expect(html).toContain("TM-9 · Old Mark");
    expect(html).toContain("299 days past due");
    expect(html).toContain("1 day past due");
    expect(html).toContain('href="/dashboard/matters/m9/"');
  });
  it("renders nothing for an ok read with no items", () => {
    expect(renderToStaticMarkup(<NeedsReviewCard items={[]} />)).toBe("");
  });
  it("says it couldn't load on a failed read", () => {
    const html = text(renderToStaticMarkup(<NeedsReviewCard items={null} />));
    expect(html).toContain("Needs review");
    expect(html).toContain("Couldn't load the dates to review.");
  });
});

describe("needsReviewItems", () => {
  it("keeps only old unconfirmed manual open dates, oldest first, with the kind label as name", () => {
    const out = needsReviewItems(
      [
        row({ id: "a", due_date: "2025-06-01" }),
        row({ id: "b", due_date: "2025-01-15" }),
        row({ id: "c", due_date: "2025-01-15", attorney_confirmed: true }),
        row({ id: "d", due_date: "2025-01-15", source: "calculated" }),
        row({ id: "e", due_date: "2026-11-01" }),
      ],
      "2026-11-10",
    );
    expect(out.map((o) => o.key)).toEqual(["b", "a"]);
    expect(out[0].daysPastDue).toBe(664);
    expect(out[0].matter).toBe("TM-1 · The Fold");
    expect(out[0].href).toBe("/dashboard/matters/m1/");
    expect(out[0].name.length).toBeGreaterThan(0);
  });
});

describe("page wiring", () => {
  it("the technician page passes null on a failed deadline read", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/app/dashboard/page.tsx", "utf8");
    expect(page).toContain("<NeedsReviewCard items={deadlines ? needsReviewItems(deadlines, civilDate(now)) : null} />");
  });
});
