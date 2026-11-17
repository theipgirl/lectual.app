import { describe, expect, it } from "vitest";
import { parseOpenParam } from "@/lib/review/open";
import { closeHref, openHref, parseCardOpen } from "@/lib/record-card/open";

const INTAKE_PATH = "/dashboard/intake/";
const MATTERS_PATH = "/dashboard/matters/";

const ID = "11111111-1111-4111-8111-111111111111";

describe("?open= for Intake and Matters: the review's grammar, not a second one", () => {
  it("parses exactly what the review parses", () => {
    for (const raw of [`lead:${ID}`, `matter:${ID}`, `LEAD:${ID.toUpperCase()}`, ` lead:${ID} `, [`lead:${ID}`, "matter:x"], "lead:", "lead:not-a-uuid", `person:${ID}`, `lead:${ID}x`, "", null, undefined]) {
      expect(parseCardOpen(raw as never)).toEqual(parseOpenParam(raw as never));
    }
    expect(parseCardOpen(`lead:${ID}`)).toEqual({ kind: "lead", id: ID });
    expect(parseCardOpen(`matter:${ID.toUpperCase()}`)).toEqual({ kind: "matter", id: ID });
    expect(parseCardOpen("lead:../../etc")).toBeNull();
  });

  it("openHref keeps every other key (view, set, filters, show, repeated keys) and sets open", () => {
    const params = { view: "board", set: "working", source: ["UGW", "Event"], show: "50", q: "maya & co" };
    const href = openHref(INTAKE_PATH, params, { kind: "lead", id: ID });
    const url = new URL(href, "https://x.test");
    expect(url.pathname).toBe("/dashboard/intake/");
    expect(url.searchParams.get("view")).toBe("board");
    expect(url.searchParams.get("set")).toBe("working");
    expect(url.searchParams.getAll("source")).toEqual(["UGW", "Event"]);
    expect(url.searchParams.get("show")).toBe("50");
    expect(url.searchParams.get("q")).toBe("maya & co");
    expect(url.searchParams.getAll("open")).toEqual([`lead:${ID}`]);
  });

  it("replaces an earlier open rather than adding a second", () => {
    const href = openHref(MATTERS_PATH, new URLSearchParams(`view=list&open=lead:${ID}`), { kind: "matter", id: ID });
    expect(new URL(href, "https://x.test").searchParams.getAll("open")).toEqual([`matter:${ID}`]);
  });

  it("closeHref drops only open, and gives the bare path when nothing else is left", () => {
    expect(closeHref(INTAKE_PATH, { view: "board", open: `lead:${ID}`, set: "lost" })).toBe("/dashboard/intake/?view=board&set=lost");
    expect(closeHref(MATTERS_PATH, { open: `matter:${ID}` })).toBe("/dashboard/matters/");
    expect(closeHref(MATTERS_PATH, {})).toBe("/dashboard/matters/");
  });

  it("open then close returns to the same address", () => {
    const start = new URLSearchParams("view=board&set=working&show=50");
    const opened = new URL(openHref(INTAKE_PATH, start, { kind: "lead", id: ID }), "https://x.test");
    expect(closeHref(INTAKE_PATH, opened.searchParams)).toBe(`${INTAKE_PATH}?${start.toString()}`);
  });

  it("keeps the Matters group, so the closed list is the same group", () => {
    const href = openHref(MATTERS_PATH, { group: "all", view: "board" }, { kind: "matter", id: ID });
    expect(href).toBe(`/dashboard/matters/?group=all&view=board&open=matter%3A${ID}`);
    expect(closeHref(MATTERS_PATH, new URL(href, "https://x.test").searchParams)).toBe("/dashboard/matters/?group=all&view=board");
  });

  it("ignores undefined values", () => {
    expect(closeHref(INTAKE_PATH, { view: undefined, set: "working" })).toBe("/dashboard/intake/?set=working");
  });
});
