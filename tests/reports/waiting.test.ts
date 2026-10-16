import { describe, it, expect } from "vitest";
import { oldestFirst } from "@/lib/reports/waiting";

type Row = { id: string; at: string | null };
const row = (id: string, at: string | null): Row => ({ id, at });

describe("oldestFirst", () => {
  it("sorts ascending by date (oldest, i.e. longest-waiting, first)", () => {
    const rows = [row("new", "2026-09-26T00:00:00Z"), row("old", "2026-09-01T00:00:00Z"), row("mid", "2026-09-15T00:00:00Z")];
    expect(oldestFirst(rows, (r) => r.at).map((r) => r.id)).toEqual(["old", "mid", "new"]);
  });

  it("drops rows with no date to sort by", () => {
    const rows = [row("a", null), row("b", "2026-09-01T00:00:00Z")];
    expect(oldestFirst(rows, (r) => r.at).map((r) => r.id)).toEqual(["b"]);
  });

  it("drops rows with an unparseable date", () => {
    const rows = [row("a", "not-a-date"), row("b", "2026-09-01T00:00:00Z")];
    expect(oldestFirst(rows, (r) => r.at).map((r) => r.id)).toEqual(["b"]);
  });

  it("caps to `limit`", () => {
    const rows = [row("a", "2026-09-01T00:00:00Z"), row("b", "2026-09-02T00:00:00Z"), row("c", "2026-09-03T00:00:00Z")];
    expect(oldestFirst(rows, (r) => r.at, 2).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("does not mutate its input", () => {
    const rows = [row("b", "2026-09-02T00:00:00Z"), row("a", "2026-09-01T00:00:00Z")];
    const copy = [...rows];
    oldestFirst(rows, (r) => r.at);
    expect(rows).toEqual(copy);
  });
});
