// Ported from lectual tests/matters/matters-page.test.ts (the pure list-utils
// blocks only; the table/kanban/timeline components were not ported).
import { describe, it, expect } from "vitest";
import type { Matter } from "@/lib/matters";
import {
  sortByOpenedDate,
  filterByStatus,
  statusCatalog,
  matterIdsNeedingReview,
  filterByReview,
  filterByStalled,
} from "../../src/app/dashboard/matters/list-utils";

function matter(overrides: Partial<Matter>): Matter {
  return {
    id: "matter-1",
    org_id: "org-1",
    lead_id: null,
    matter_number: "M-0001",
    title: "Acme Co. — Wordmark",
    type: "TM",
    package_name: null,
    practice_pipeline: null,
    status: "open",
    opened_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Matter;
}

describe("sortByOpenedDate", () => {
  it("orders matters by opened_at desc without mutating the input", () => {
    const oldest = matter({ id: "m-old", opened_at: "2026-01-01T00:00:00Z" });
    const newest = matter({ id: "m-new", opened_at: "2026-06-01T00:00:00Z" });
    const middle = matter({ id: "m-mid", opened_at: "2026-03-01T00:00:00Z" });
    const input = [oldest, newest, middle];

    const sorted = sortByOpenedDate(input);
    expect(sorted.map((m) => m.id)).toEqual(["m-new", "m-mid", "m-old"]);
    expect(input.map((m) => m.id)).toEqual(["m-old", "m-new", "m-mid"]);
  });
});

describe("filterByStatus", () => {
  it("returns all matters for a falsy or 'all' status", () => {
    const matters = [matter({ id: "a", status: "open" }), matter({ id: "b", status: "closed" })];
    expect(filterByStatus(matters)).toHaveLength(2);
    expect(filterByStatus(matters, "all")).toHaveLength(2);
  });

  it("filters to a single status", () => {
    const matters = [
      matter({ id: "a", status: "open" }),
      matter({ id: "b", status: "closed" }),
      matter({ id: "c", status: "open" }),
    ];
    const filtered = filterByStatus(matters, "open");
    expect(filtered.map((m) => m.id)).toEqual(["a", "c"]);
  });
});

describe("statusCatalog", () => {
  it("returns the defined vocabulary in lifecycle order, not whatever is in the data", () => {
    const matters = [
      matter({ status: "open" }),
      matter({ status: "closed" }),
      matter({ status: "open" }),
      matter({ status: "on_hold" }),
    ];
    expect(statusCatalog(matters)).toEqual(["open", "on_hold", "closed"]);
  });

  it("offers the full vocabulary even when the data only holds one status", () => {
    expect(statusCatalog([matter({ status: "open" })])).toEqual(["open", "on_hold", "closed"]);
  });

  it("keeps a legacy out-of-vocabulary status reachable, after the vocabulary", () => {
    const matters = [matter({ status: "open" }), matter({ status: "archived_2024" })];
    expect(statusCatalog(matters)).toEqual(["open", "on_hold", "closed", "archived_2024"]);
  });

  it("never duplicates a status that appears many times", () => {
    const matters = [
      matter({ status: "on_hold" }),
      matter({ status: "on_hold" }),
      matter({ status: "legacy" }),
      matter({ status: "legacy" }),
    ];
    expect(statusCatalog(matters)).toEqual(["open", "on_hold", "closed", "legacy"]);
  });
});

describe("matterIdsNeedingReview", () => {
  it("collects matter_id off queue-row-shaped objects, dropping nulls", () => {
    const ids = matterIdsNeedingReview([
      { matter_id: "m1" },
      { matter_id: null },
      { matter_id: "m2" },
      { matter_id: "m1" },
    ]);
    expect(ids).toEqual(new Set(["m1", "m2"]));
  });

  it("returns an empty set for no items", () => {
    expect(matterIdsNeedingReview([])).toEqual(new Set());
  });
});

describe("filterByReview", () => {
  const matters = [matter({ id: "a" }), matter({ id: "b" }), matter({ id: "c" })];
  const reviewIds = new Set(["b"]);

  it("is a no-op for a falsy, '0', or 'false' reviewOnly value", () => {
    expect(filterByReview(matters, reviewIds)).toHaveLength(3);
    expect(filterByReview(matters, reviewIds, null)).toHaveLength(3);
    expect(filterByReview(matters, reviewIds, "0")).toHaveLength(3);
    expect(filterByReview(matters, reviewIds, "false")).toHaveLength(3);
  });

  it("filters to only matters present in reviewIds when reviewOnly is set", () => {
    const filtered = filterByReview(matters, reviewIds, "1");
    expect(filtered.map((m) => m.id)).toEqual(["b"]);
  });

  it("returns an empty list when reviewOnly is set but nothing needs review", () => {
    expect(filterByReview(matters, new Set(), "1")).toHaveLength(0);
  });
});

describe("filterByStalled", () => {
  const matters = [matter({ id: "a" }), matter({ id: "b" }), matter({ id: "c" })];
  const stalledIds = new Set(["b"]);

  it("is a no-op for a falsy, '0', or 'false' stalledOnly value", () => {
    expect(filterByStalled(matters, stalledIds)).toHaveLength(3);
    expect(filterByStalled(matters, stalledIds, null)).toHaveLength(3);
    expect(filterByStalled(matters, stalledIds, "0")).toHaveLength(3);
    expect(filterByStalled(matters, stalledIds, "false")).toHaveLength(3);
  });

  it("filters to only matters present in stalledIds when stalledOnly is set", () => {
    const filtered = filterByStalled(matters, stalledIds, "1");
    expect(filtered.map((m) => m.id)).toEqual(["b"]);
  });

  it("returns an empty list when stalledOnly is set but nothing is stalled", () => {
    expect(filterByStalled(matters, new Set(), "1")).toHaveLength(0);
  });
});

