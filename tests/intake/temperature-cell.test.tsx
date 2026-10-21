import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Lead, Stage } from "@/lib/pipeline";
import { buildIntakeRows } from "@/lib/intake/rows";
import type { EffectiveTemperature } from "@/lib/intake/effective-temperature";
import TemperatureCell from "@/app/dashboard/intake/_components/TemperatureCell";
import Popover, { PopoverItem } from "@/app/dashboard/intake/_components/Popover";
import IntakeTable from "@/app/dashboard/intake/_components/IntakeTable";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function elements(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((child) => elements(child, out));
  else if (node && typeof node === "object" && "props" in node) {
    out.push(node as ReactElement);
    elements((node as ReactElement<{ children?: ReactNode }>).props.children, out);
  }
  return out;
}

const SUGGESTED_HOT: EffectiveTemperature = { value: "hot", source: "suggested", reason: "Replied 1 day ago — waiting on us" };

describe("TemperatureCell's menu", () => {
  function menuOf(onSet: (lane: "hot" | "warm" | "cold" | null) => void) {
    // The cell has no hooks of its own, so it can be called for its element tree.
    const tree = TemperatureCell({ leadName: "Ana Ruiz", temperature: SUGGESTED_HOT, pending: false, onSet });
    const popover = elements(tree).find((el) => el.type === Popover)!;
    const close = vi.fn();
    const items = elements((popover.props as { children: (close: () => void) => ReactNode }).children(close)).filter((el) => el.type === PopoverItem);
    return { popover, items, close };
  }

  it("offers Hot, Warm, Cold and Clear, in that order", () => {
    const { items } = menuOf(() => {});
    expect(items.map((item) => (item.props as { children: ReactNode }).children)).toEqual(["Hot", "Warm", "Cold", "Clear"]);
  });

  it("calls the set handler with hot, warm, cold and null, closing the menu each time", () => {
    const onSet = vi.fn();
    const { items, close } = menuOf(onSet);
    for (const item of items) (item.props as { onSelect: () => void }).onSelect();
    expect(onSet.mock.calls).toEqual([["hot"], ["warm"], ["cold"], [null]]);
    expect(close).toHaveBeenCalledTimes(4);
  });

  it("checks the current choice only for a person's temperature", () => {
    const person = TemperatureCell({ leadName: "Ana", temperature: { value: "warm", source: "person", reason: "Set by a person" }, pending: false, onSet: () => {} });
    const popover = elements(person).find((el) => el.type === Popover)!;
    const items = elements((popover.props as { children: (c: () => void) => ReactNode }).children(() => {})).filter((el) => el.type === PopoverItem);
    expect(items.map((item) => (item.props as { checked: boolean }).checked)).toEqual([false, true, false, false]);
    const { items: suggested } = menuOf(() => {});
    expect(suggested.map((item) => (item.props as { checked: boolean }).checked)).toEqual([false, false, false, false]);
  });

  it("is a disabled chip while a write is pending", () => {
    const html = renderToStaticMarkup(<TemperatureCell leadName="Ana" temperature={SUGGESTED_HOT} pending onSet={() => {}} />);
    expect(html).toMatch(/<button[^>]*disabled/);
  });
});

describe("the table row's refusal", () => {
  it("shows the action's sentence under the row it belongs to", () => {
    const stage = { id: "s1", org_id: "o", name: "New", order_index: 1, category: "open", aging_threshold_days: 30 } as unknown as Stage;
    const lead = {
      id: "l-1", first_name: "Ana", last_name: "Ruiz", email: "a@x.test", current_stage_id: "s1", stage_entered_at: "2026-10-19T12:00:00Z",
      assigned_to: null, temperature: null, lane: null, ai_summary: null, last_activity_at: null, last_outbound_at: null, last_inbound_at: null,
    } as unknown as Lead;
    const now = new Date("2026-10-20T12:00:00Z");
    const rows = buildIntakeRows({ leads: [lead], stages: [stage], members: [], now });
    const html = renderToStaticMarkup(
      <IntakeTable
        rows={rows}
        totalCount={1}
        members={[]}
        sortKey="lastTouch"
        sortDir="desc"
        now={now}
        pendingLeadId={null}
        errors={{ "l-1": "Your role can view leads but can't change them." }}
        time={null}
        onSort={() => {}}
        onSetLane={() => {}}
        onAssign={() => {}}
        onSetSource={() => {}}
      />,
    );
    expect(html).toMatch(/role="status"[^>]*>Your role can view leads but can(&#x27;|')t change them\.</);
  });
});

describe("the merged control styling", () => {
  it("keeps the controlled-mode toggle rules in intake.css, built from the design's own tokens", () => {
    const css = read("src/app/dashboard/intake/intake.css");
    expect(css).toContain(".intake-root .lx-view-toggle button");
    expect(css).toContain(".intake-root .lx-view-toggle button.on");
    const block = css.slice(css.indexOf(".intake-root .lx-view-toggle button {"), css.indexOf(".intake-statusline {"));
    // Same pill as the link mode: the design's tokens, no new colour or font.
    expect(block).toContain("var(--card)");
    expect(block).toContain("var(--body)");
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(block).not.toMatch(/font-family/);
  });

  it("leaves the design-owned stylesheet's toggle rules untouched", () => {
    const globals = read("src/app/globals.css");
    expect(globals).toContain(".lx-view-toggle a.on { background: var(--card);");
    expect(globals).not.toContain(".lx-view-toggle button");
  });
});
