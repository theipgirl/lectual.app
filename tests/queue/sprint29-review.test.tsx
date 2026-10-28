import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement, ReactNode } from "react";
import { parseReviewerSummary, splitForDisplay, REVIEWER_COLLAPSE_AFTER } from "@/lib/queue/reviewer-summary";
import { ReviewerSummary } from "@/components/queue/ReviewerSummary";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const useState = (init: unknown) => {
    const at = hooks.cursor++;
    if (!(at in hooks.slots)) hooks.slots[at] = typeof init === "function" ? (init as () => unknown)() : init;
    return [
      hooks.slots[at],
      (next: unknown) => {
        hooks.slots[at] = typeof next === "function" ? (next as (v: unknown) => unknown)(hooks.slots[at]) : next;
      },
    ];
  };
  const useActionState = (action: unknown) => [{}, action, false];
  return { ...actual, useState, useActionState, default: { ...actual, useState, useActionState } };
});
vi.mock("@/app/dashboard/queue/actions", () => ({ reviewQueueAction: vi.fn() }));

const { ReviewPanel } = await import("@/components/queue/ReviewPanel");

/** Sprint 29 D: the draft once with Edit / Done editing / Cancel, the aside as a definition list, "For the reviewer" as a list. */

const text = (html: string) => html.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'");

describe("parseReviewerSummary", () => {
  it("splits on line breaks and strips list markers", () => {
    expect(parseReviewerSummary("- First point\n* Second point\n• Third\n1. Fourth\n2) Fifth")).toEqual(
      ["First point", "Second point", "Third", "Fourth", "Fifth"].map((t) => ({ text: t, checkFirst: false })),
    );
  });

  it("puts CHECK FIRST items first, labelled off, in the writer's order within each group", () => {
    const items = parseReviewerSummary("Package is Essential.\nCHECK FIRST: second mark discount was 10 percent.\nUsed the call from Oct 23.\nCHECK FIRST - consult credit amount");
    expect(items).toEqual([
      { text: "second mark discount was 10 percent.", checkFirst: true },
      { text: "consult credit amount", checkFirst: true },
      { text: "Package is Essential.", checkFirst: false },
      { text: "Used the call from Oct 23.", checkFirst: false },
    ]);
  });

  it("splits a single run-on paragraph at each CHECK FIRST and at inline bullet dots", () => {
    const items = parseReviewerSummary("Drafted from the Oct 23 call. CHECK FIRST: the package. CHECK FIRST: the credit • Two marks found");
    expect(items.map((i) => [i.text, i.checkFirst])).toEqual([
      ["the package.", true],
      ["the credit", true],
      ["Drafted from the Oct 23 call.", false],
      ["Two marks found", false],
    ]);
  });

  it("a bare CHECK FIRST line marks the lines under it until a blank line", () => {
    const items = parseReviewerSummary("CHECK FIRST\n- the package\n- the credit\n\n- background one");
    expect(items.map((i) => [i.text, i.checkFirst])).toEqual([
      ["the package", true],
      ["the credit", true],
      ["background one", false],
    ]);
  });

  it("is case-insensitive about the label, keeps the writer's words, and handles CRLF", () => {
    expect(parseReviewerSummary("check first: Look at it\r\nPlain")).toEqual([
      { text: "Look at it", checkFirst: true },
      { text: "Plain", checkFirst: false },
    ]);
  });

  it("nothing in, nothing out; a word that merely contains the label is not a label", () => {
    expect(parseReviewerSummary(null)).toEqual([]);
    expect(parseReviewerSummary("   \n  ")).toEqual([]);
    expect(parseReviewerSummary("CHECK FIRSTLY the totals")).toEqual([{ text: "CHECK FIRSTLY the totals", checkFirst: false }]);
  });

  it("splitForDisplay holds everything past five", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ text: `n${i}`, checkFirst: false }));
    const { shown, hidden } = splitForDisplay(items);
    expect(REVIEWER_COLLAPSE_AFTER).toBe(5);
    expect(shown).toHaveLength(5);
    expect(hidden.map((i) => i.text)).toEqual(["n5", "n6", "n7"]);
  });
});

describe("ReviewerSummary", () => {
  const html = (summary: string | null) => text(renderToStaticMarkup(<ReviewerSummary summary={summary} />));

  it("draws a list with the CHECK FIRST items first and marked", () => {
    const out = html("Background line\nCHECK FIRST: the package");
    expect(out).toContain("For the reviewer");
    expect(out.indexOf("the package")).toBeLessThan(out.indexOf("Background line"));
    expect(out).toContain('data-check-first="true"');
    expect(out).toContain('<span class="lx-rv-tag">Check first</span>the package');
    expect(out.match(/data-check-first/g)).toHaveLength(1);
    expect(out).not.toContain("<details");
  });

  it("collapses more than five behind 'Show all N'", () => {
    const out = html(Array.from({ length: 8 }, (_, i) => `- point ${i + 1}`).join("\n"));
    expect(out).toContain("<details");
    expect(out).toContain("Show all 8");
    const beforeDetails = out.slice(0, out.indexOf("<details"));
    expect(beforeDetails.match(/<li /g)).toHaveLength(5);
    expect(out.match(/<li /g)).toHaveLength(8);
    expect(out).not.toMatch(/<details[^>]*open/);
    // Exactly five is not collapsed.
    expect(html(Array.from({ length: 5 }, (_, i) => `- p${i}`).join("\n"))).not.toContain("<details");
  });

  it("draws nothing for no summary, and the raw text when it has no items", () => {
    expect(html(null)).toBe("");
    expect(html("   ")).toBe("");
    expect(html("•")).toContain("For the reviewer");
  });

  it("is tokens only and has no emoji", () => {
    const css = readFileSync("src/components/queue/review.css", "utf8");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    for (const file of ["src/components/queue/review.css", "src/components/queue/ReviewerSummary.tsx", "src/components/queue/ReviewPanel.tsx"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });
});

describe("ReviewPanel: the draft once, with Edit", () => {
  function mount(props: Record<string, unknown> = {}) {
    hooks.slots = [];
    const base = { id: "q1", initialBody: "Hi **Ana**,\n\nThanks.", canApprove: true, canEdit: true };
    return {
      tree(): ReactElement {
        hooks.cursor = 0;
        return ReviewPanel({ ...base, ...props } as never) as ReactElement;
      },
    };
  }
  function flat(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
    if (Array.isArray(node)) node.forEach((n) => flat(n, out));
    else if (node && typeof node === "object" && "props" in node) {
      const el = node as ReactElement<{ children?: ReactNode }>;
      out.push(el);
      flat(el.props.children, out);
    }
    return out;
  }
  const labelOf = (el: ReactElement) => [(el.props as { children?: ReactNode }).children].flat(4).filter((c) => typeof c === "string").join("").trim();
  const button = (tree: ReactElement, label: string) => flat(tree).find((e) => e.type === "button" && labelOf(e) === label);
  const has = (tree: ReactElement, type: string) => flat(tree).some((e) => e.type === type);
  const modeOf = (tree: ReactElement) => flat(tree).find((e) => (e.props as Record<string, unknown>)["data-draft-mode"])?.props as Record<string, unknown>;
  const click = (el: ReactElement | undefined) => (el!.props as { onClick: () => void }).onClick();
  const field = (tree: ReactElement, type: string) => flat(tree).find((e) => e.type === type)?.props as Record<string, unknown> | undefined;

  it("opens on the rendered view with Edit, and no editor", () => {
    const view = mount();
    const tree = view.tree();
    expect(modeOf(tree)["data-draft-mode"]).toBe("view");
    expect(button(tree, "Edit")).toBeTruthy();
    expect(has(tree, "textarea")).toBe(false);
    expect(button(tree, "Done editing")).toBeUndefined();
    expect(button(tree, "Approve")).toBeTruthy();
  });

  it("Edit swaps the view for the editor with Done editing and Cancel, never both at once", () => {
    const view = mount();
    click(button(view.tree(), "Edit"));
    const tree = view.tree();
    expect(modeOf(tree)["data-draft-mode"]).toBe("edit");
    expect(has(tree, "textarea")).toBe(true);
    expect(button(tree, "Done editing")).toBeTruthy();
    expect(button(tree, "Cancel")).toBeTruthy();
    expect(button(tree, "Edit")).toBeUndefined();
    expect(flat(tree).filter((e) => (e.props as Record<string, unknown>)["data-draft-mode"])).toHaveLength(1);
  });

  it("Done editing returns to the view with the edit kept, marked, and posted from the view", () => {
    const view = mount();
    click(button(view.tree(), "Edit"));
    (field(view.tree(), "textarea")!.onChange as (e: unknown) => void)({ target: { value: "Hi Ana, edited." } });
    expect(field(view.tree(), "textarea")!.name).toBe("body");
    click(button(view.tree(), "Done editing"));
    const tree = view.tree();
    expect(modeOf(tree)["data-draft-mode"]).toBe("view");
    expect(has(tree, "textarea")).toBe(false);
    expect(button(tree, "Approve with edits")).toBeTruthy();
    const hidden = flat(tree).find((e) => e.type === "input" && (e.props as Record<string, unknown>).type === "hidden" && (e.props as Record<string, unknown>).name === "body");
    expect((hidden!.props as Record<string, unknown>).value).toBe("Hi Ana, edited.");
  });

  it("Cancel returns to the view and puts back what the editor opened with", () => {
    const view = mount();
    click(button(view.tree(), "Edit"));
    (field(view.tree(), "textarea")!.onChange as (e: unknown) => void)({ target: { value: "Something else entirely" } });
    click(button(view.tree(), "Cancel"));
    const tree = view.tree();
    expect(modeOf(tree)["data-draft-mode"]).toBe("view");
    expect(button(tree, "Approve")).toBeTruthy();
    expect(flat(tree).some((e) => e.type === "input" && (e.props as Record<string, unknown>).name === "body")).toBe(false);
  });

  it("a second Edit then Cancel keeps the first edit", () => {
    const view = mount();
    click(button(view.tree(), "Edit"));
    (field(view.tree(), "textarea")!.onChange as (e: unknown) => void)({ target: { value: "First edit" } });
    click(button(view.tree(), "Done editing"));
    click(button(view.tree(), "Edit"));
    (field(view.tree(), "textarea")!.onChange as (e: unknown) => void)({ target: { value: "Second edit" } });
    click(button(view.tree(), "Cancel"));
    expect((flat(view.tree()).find((e) => e.type === "input" && (e.props as Record<string, unknown>).name === "body")!.props as Record<string, unknown>).value).toBe("First edit");
  });

  it("without edit rights there is no Edit button and no editor at all", () => {
    const tree = mount({ canEdit: false }).tree();
    expect(button(tree, "Edit")).toBeUndefined();
    expect(has(tree, "textarea")).toBe(false);
  });

  it("approve, reject, save edit and the stale confirmation are as before", () => {
    const tree = mount({ confirmStale: "This client signed since." }).tree();
    expect(button(tree, "Approve")).toBeTruthy();
    expect(button(tree, "Save edit")).toBeTruthy();
    expect(button(tree, "Reject")).toBeTruthy();
    const approve = button(tree, "Approve")!.props as Record<string, unknown>;
    expect(approve.disabled).toBe(true);
    expect(flat(tree).some((e) => (e.props as Record<string, unknown>).name === "confirm_stale")).toBe(true);
  });
});

describe("the page: Client, To, Subject, Send at and Queued as a definition list", () => {
  beforeEach(() => vi.resetModules());

  it("renders a <dl> with those terms in that order, and the reviewer list under it", async () => {
    vi.doMock("@/lib/queue/api", () => ({
      getQueueItem: vi.fn(async () => ({
        id: "q1",
        org_id: "o",
        matter_id: null,
        agent: "post-consult",
        type: "CLIENT_EMAIL",
        headline: "Follow up",
        summary: "CHECK FIRST: the package\n- background",
        draft_body: "Hi",
        final_body: null,
        status: "pending",
        created_at: "2026-10-27T12:00:00Z",
        client_name: "Ana Ruiz",
        recipient: "ana@example.com",
        subject: "Next steps",
        proposed_send_at: "2026-10-28T14:00:00Z",
        attachments: null,
        resolved_by: null,
        resolved_at: null,
        resolution_note: null,
      })),
    }));
    vi.doMock("@/lib/queue/org", () => ({ activeQueueOrgKey: vi.fn(async () => "rpb") }));
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({})) }));
    vi.doMock("@/lib/queue/roles", () => ({ QUEUE_APPROVE_ROLES: ["owner"], QUEUE_EDIT_ROLES: ["owner"], resolveQueueRole: vi.fn(async () => "owner") }));
    vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
    vi.doMock("@/lib/queue/stale", () => ({ checkDraftStaleness: vi.fn(async () => ({ status: "not_applicable" })) }));
    vi.doMock("@/lib/consult-proposal/link", () => ({ loadLinkedPanel: vi.fn(async () => ({ status: "none" })) }));
    vi.doMock("@/lib/queue/audit-context", () => ({ loadAuditContext: vi.fn(async () => ({ signOff: null, teamSignOff: null, memberNames: [] })) }));
    vi.doMock("@/app/dashboard/queue/actions", () => ({ reviewQueueAction: vi.fn() }));
    const { default: Page } = await import("../../src/app/dashboard/queue/[id]/page");
    const { createElement } = await import("react");
    const element = await Page({ params: Promise.resolve({ id: "q1" }), searchParams: Promise.resolve({}) });
    const html = text(renderToStaticMarkup(createElement("div", null, element)));
    const dl = html.slice(html.indexOf("<dl"), html.indexOf("</dl>"));
    expect([...dl.matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1])).toEqual(["Client", "To", "Subject", "Send at", "Queued"]);
    expect(dl).toContain("<dd>Ana Ruiz</dd>");
    expect(dl).toContain("<dd>ana@example.com</dd>");
    expect(html).toContain("data-reviewer-summary");
    expect(html.indexOf("</dl>")).toBeLessThan(html.indexOf("data-reviewer-summary"));
    // The draft, and the old stacked preview, are gone.
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain(">Preview<");
  });
});
