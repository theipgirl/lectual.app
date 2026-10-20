import { describe, it, expect } from "vitest";
import { preview } from "@/components/queue/format";
import type { QueueItem } from "@/lib/queue/api";

function item(overrides: Partial<QueueItem>): QueueItem {
  return { id: "q1", draft_body: "", final_body: null, ...overrides } as QueueItem;
}

describe("preview() (F6)", () => {
  it("reads as a sentence, with no Markdown marks", () => {
    const out = preview(item({ draft_body: "**Hi** there\n## Next" }));
    expect(out).not.toContain("**");
    expect(out).not.toContain("##");
    expect(out).toContain("Hi there");
    expect(out).toBe("Hi there Next");
  });

  it("keeps the length limit and adds an ellipsis only when truncated", () => {
    expect(preview(item({ draft_body: "**Hi** there" }), 20)).toBe("Hi there");
    const cut = preview(item({ draft_body: "**Hello** there my friend, welcome aboard" }), 20);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBe(21);
    expect(cut).not.toContain("**");
  });

  it("prefers final_body over draft_body", () => {
    expect(preview(item({ draft_body: "old", final_body: "**new**" }))).toBe("new");
  });

  it("flattens a table to a line", () => {
    const out = preview(item({ draft_body: "| A | B |\n|---|---|\n| 1 | 2 |" }));
    expect(out).toBe("A B 1 2");
  });
});
