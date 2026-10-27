import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement, ReactNode } from "react";

/**
 * Sprint 29 B: the meeting link form. Static markup (real React) for each look; the Change / Update link / Cancel
 * and fold-back behaviour is driven with a small hook shim, as the Intake workspace tests do (no DOM library here).
 */

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  shim: false,
  actionState: {} as Record<string, unknown>,
  effects: [] as Array<() => void>,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const useState = (init: unknown) => {
    if (!hooks.shim) return actual.useState(init as never);
    const at = hooks.cursor++;
    if (!(at in hooks.slots)) hooks.slots[at] = typeof init === "function" ? (init as () => unknown)() : init;
    return [
      hooks.slots[at],
      (next: unknown) => {
        hooks.slots[at] = typeof next === "function" ? (next as (v: unknown) => unknown)(hooks.slots[at]) : next;
      },
    ];
  };
  const useEffect = (fn: () => void, deps?: unknown[]) => {
    if (!hooks.shim) return actual.useEffect(fn, deps);
    hooks.effects.push(fn);
  };
  const useActionState = (action: unknown, init: unknown) => {
    if (!hooks.shim) return actual.useActionState(action as never, init as never);
    return [hooks.actionState, action, false];
  };
  return { ...actual, useState, useEffect, useActionState, default: { ...actual, useState, useEffect, useActionState } };
});

vi.mock("@/app/dashboard/meetings/actions", () => ({ draftFollowUpAction: vi.fn(), draftProposalAction: vi.fn(), linkMeetingAction: vi.fn() }));
vi.mock("@/app/dashboard/settings/integrations/meetings/actions", () => ({
  connectFathomAction: vi.fn(),
  disconnectMeetingSourceAction: vi.fn(),
  importNowAction: vi.fn(),
}));

const { LinkMeetingForm } = await import("@/components/meetings/MeetingForms");

const leads = [
  { id: "lead-1", label: "Melvin Larry · melvin@x.test" },
  { id: "lead-2", label: "Rayn Other · rayn@x.test" },
];
const matters = [{ id: "m-1", label: "MELVIN MARK · TM-1001" }];
const base = { meetingId: "meet-1", leads, matters, suggestedLeadId: null, suggestedMatterId: null } as const;

const html = (props: Record<string, unknown>) =>
  renderToStaticMarkup(<LinkMeetingForm {...base} leadId={null} matterId={null} {...(props as object)} />)
    .replaceAll("<!-- -->", "")
    .replaceAll("&#x27;", "'");

beforeEach(() => {
  hooks.shim = false;
});

describe("a linked meeting", () => {
  const linked = html({ leadId: "lead-1", matterId: "m-1", leadLabel: "Melvin Larry", matterLabel: "MELVIN MARK · TM-1001" });

  it("reads 'Linked to <lead> · <matter>' as text with links, and offers Change", () => {
    expect(linked).toContain("Linked to ");
    expect(linked).toMatch(/<a href="\/dashboard\/leads\/lead-1\/?">Melvin Larry<\/a> · <a href="\/dashboard\/matters\/m-1\/?">MELVIN MARK · TM-1001<\/a>/);
    expect(linked).toMatch(/<button[^>]*type="button"[^>]*>Change<\/button>/);
  });

  it("hides the selects until Change, and says nothing like 'Save link'", () => {
    expect(linked).not.toContain("<select");
    expect(linked).not.toContain("Save link");
    expect(linked).not.toContain("Update link");
    expect(linked).toContain(">Unlink<");
    expect(linked).not.toMatch(/>Link<\/button>/);
  });

  it("a lead-only link names only the lead; a matter-only link only the matter", () => {
    const leadOnly = html({ leadId: "lead-1", leadLabel: "Melvin Larry" });
    expect(leadOnly).toContain("Linked to <a");
    expect(leadOnly).not.toContain("/dashboard/matters/");
    expect(leadOnly).not.toContain(" · <a");
    expect(html({ matterId: "m-1", matterLabel: "X" })).not.toContain("/dashboard/leads/");
  });

  it("a link whose name couldn't be read says Lead / Matter, never an id", () => {
    const h = html({ leadId: "lead-1", matterId: "m-1" });
    expect(h).toContain(">Lead</a>");
    expect(h).toContain(">Matter</a>");
  });

  it("carries the hidden meeting id and the current link, so Unlink can clear them", () => {
    expect(linked).toContain('name="meetingId"');
    expect(linked).toContain('type="hidden" name="leadId" value="lead-1"');
    expect(linked).toContain('type="hidden" name="matterId" value="m-1"');
  });

  it("shows the filing note under the text", () => {
    expect(html({ leadId: "lead-1", note: "Filed automatically from an attendee's email." })).toContain("Filed automatically from an attendee's email.");
  });
});

describe("an unlinked meeting", () => {
  it("shows the selects and 'Link', with no Change or Unlink", () => {
    const h = html({});
    expect(h).toContain("<select");
    expect(h).toMatch(/<button[^>]*type="submit"[^>]*>Link<\/button>/);
    expect(h).not.toContain("Change");
    expect(h).not.toContain("Unlink");
    expect(h).not.toContain("Save link");
  });

  it("a suggestion reads 'Suggested: <name> · Link', with Choose another, and hides the selects", () => {
    const h = html({ suggestedLeadId: "lead-2", suggestedLeadLabel: "Rayn Other" });
    expect(h).toContain("Suggested: Rayn Other · ");
    expect(h).toMatch(/<button[^>]*type="submit"[^>]*>Link<\/button>/);
    expect(h).toContain("Choose another");
    expect(h).not.toContain("<select");
    // Linking the suggestion posts the suggested ids.
    expect(h).toContain('type="hidden" name="leadId" value="lead-2"');
    expect(h).toContain("More than one client shares an attendee");
  });

  it("a suggested lead and matter read as one line", () => {
    expect(html({ suggestedLeadId: "lead-2", suggestedMatterId: "m-1", suggestedLeadLabel: "Rayn Other", suggestedMatterLabel: "MARK · TM-1" })).toContain("Suggested: Rayn Other · MARK · TM-1 · ");
  });
});

describe("Change, Update link, Cancel and the fold back", () => {
  function mount(props: Record<string, unknown>) {
    hooks.shim = true;
    hooks.slots = [];
    hooks.actionState = {};
    return {
      tree(): ReactElement {
        hooks.cursor = 0;
        hooks.effects = [];
        const el = LinkMeetingForm({ ...base, leadId: "lead-1", matterId: null, leadLabel: "Melvin Larry", ...(props as object) } as never) as ReactElement;
        // Effects run after a render, as React would: a saved change folds the form back.
        for (const effect of hooks.effects) effect();
        return el;
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
  const text = (el: ReactElement): string => {
    const kids = (el.props as { children?: ReactNode }).children;
    return [kids].flat(5).filter((k) => typeof k === "string").join("");
  };
  const buttons = (tree: ReactElement) => flat(tree).filter((e) => e.type === "button");
  const byLabel = (tree: ReactElement, label: string) => buttons(tree).find((b) => text(b) === label);
  const selects = (tree: ReactElement) => flat(tree).filter((e) => e.type === "select");

  it("Change reveals the selects with 'Update link' and Cancel; Cancel hides them again", () => {
    const view = mount({});
    expect(selects(view.tree())).toHaveLength(0);
    (byLabel(view.tree(), "Change")!.props as { onClick: () => void }).onClick();
    const open = view.tree();
    expect(selects(open)).toHaveLength(2);
    expect(byLabel(open, "Update link")).toBeTruthy();
    expect(byLabel(open, "Cancel")).toBeTruthy();
    expect(byLabel(open, "Link")).toBeUndefined();
    expect(buttons(open).some((b) => text(b) === "Save link")).toBe(false);
    expect(byLabel(open, "Unlink")).toBeTruthy();
    (byLabel(open, "Cancel")!.props as { onClick: () => void }).onClick();
    const closed = view.tree();
    expect(selects(closed)).toHaveLength(0);
    expect(byLabel(closed, "Change")).toBeTruthy();
  });

  it("after a successful save it folds back to the linked text", () => {
    const view = mount({});
    (byLabel(view.tree(), "Change")!.props as { onClick: () => void }).onClick();
    expect(selects(view.tree())).toHaveLength(2);
    hooks.actionState = { ok: true, notice: "Linked." };
    view.tree(); // the render that sees the saved state runs the effect
    expect(selects(view.tree())).toHaveLength(0);
    expect(byLabel(view.tree(), "Change")).toBeTruthy();
  });

  it("Unlink clears both fields of the form it submits, with the selects shown or hidden", () => {
    const view = mount({});
    const fake = { elements: { namedItem: (n: string) => fields[n] } } as never;
    const fields: Record<string, { value: string }> = { leadId: { value: "lead-1" }, matterId: { value: "m-1" } };
    (byLabel(view.tree(), "Unlink")!.props as { onClick: (e: unknown) => void }).onClick({ currentTarget: { form: fake } });
    expect(fields.leadId.value).toBe("");
    expect(fields.matterId.value).toBe("");
  });
});

describe("the wording lives nowhere else", () => {
  it("'Save link' is in no source file under src", () => {
    for (const file of ["src/components/meetings/MeetingForms.tsx", "src/app/dashboard/meetings/[id]/page.tsx", "src/app/dashboard/meetings/actions.ts"]) {
      expect(readFileSync(file, "utf8"), file).not.toContain("Save link");
    }
  });
});
