import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { Lead, Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import { buildIntakeRows, parseIntakeFilters, parseIntakeViewState, type IntakeRow } from "@/lib/intake/rows";
import { intakeStages } from "@/lib/intake/scope";

/**
 * The workspace's handlers, driven without a browser.
 *
 * There is no DOM library in this repo, so React's hooks are replaced with a
 * tiny single-component shim (state lives in numbered slots that survive from
 * one call of the component to the next) and the component is CALLED, which
 * returns its element tree. The tree is then read for props, and the handlers
 * the children would be given are invoked directly. The row actions are mocked.
 * Static markup is checked in intake-workspace.test.tsx with real React.
 */

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  transitions: [] as Array<Promise<unknown>>,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const shim = {
    useState: (init: unknown) => {
      const at = hooks.cursor++;
      if (!(at in hooks.slots)) hooks.slots[at] = typeof init === "function" ? (init as () => unknown)() : init;
      return [
        hooks.slots[at],
        (next: unknown) => {
          hooks.slots[at] = typeof next === "function" ? (next as (v: unknown) => unknown)(hooks.slots[at]) : next;
        },
      ];
    },
    useRef: (init: unknown) => {
      const at = hooks.cursor++;
      if (!(at in hooks.slots)) hooks.slots[at] = { current: init };
      return hooks.slots[at];
    },
    useMemo: (compute: () => unknown) => compute(),
    useCallback: (fn: unknown) => fn,
    useEffect: () => {},
    useTransition: () => [
      false,
      (fn: () => unknown) => {
        hooks.transitions.push(Promise.resolve(fn()));
      },
    ],
  };
  return { ...actual, ...shim, default: { ...actual, ...shim } };
});

const actions = vi.hoisted(() => ({
  setLaneAction: vi.fn(),
  assignLeadAction: vi.fn(),
  moveStageAction: vi.fn(),
  setSourceAction: vi.fn(),
}));
vi.mock("@/app/dashboard/intake/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock("@/app/dashboard/leads/actions", () => ({ createLeadAction: vi.fn() }));
vi.mock("@/app/dashboard/intake/time-actions", () => ({ startTimerAction: vi.fn(), stopTimerAction: vi.fn(), logTimeAction: vi.fn() }));

const { default: IntakeWorkspace } = await import("@/app/dashboard/intake/_components/IntakeWorkspace");
const { default: IntakeTable } = await import("@/app/dashboard/intake/_components/IntakeTable");
const { default: IntakeBoard } = await import("@/app/dashboard/intake/_components/IntakeBoard");
const { default: IntakeControls } = await import("@/app/dashboard/intake/_components/IntakeControls");
const { ViewToggle } = await import("@/components/ViewToggle");

const NOW = new Date("2026-10-20T12:00:00.000Z");
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const STAGES = [
  { id: "s1", org_id: "o", name: "New enquiry", order_index: 1, category: "open", aging_threshold_days: 30 },
  { id: "s9", org_id: "o", name: "Signed", order_index: 9, category: "won", aging_threshold_days: null },
] as unknown as Stage[];
const MEMBERS: MemberIdentity[] = [];

const leadRow = (id: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    org_id: "o",
    first_name: id,
    last_name: "Tester",
    email: `${id}@example.com`,
    current_stage_id: "s1",
    stage_entered_at: daysBefore(2),
    assigned_to: null,
    temperature: null,
    lane: null,
    lane_set_by: null,
    lane_set_at: null,
    ai_summary: null,
    last_activity_at: null,
    last_outbound_at: null,
    last_inbound_at: null,
    ...over,
  }) as unknown as Lead;

/** l-1 replied yesterday (derived hot); l-2 has nothing recorded (Not rated). */
const LEADS = [leadRow("l-1", { last_inbound_at: daysBefore(1) }), leadRow("l-2")];

function mount(params: Record<string, string> = {}) {
  hooks.slots = [];
  hooks.transitions = [];
  const rows = buildIntakeRows({ leads: LEADS, stages: STAGES, members: MEMBERS, now: NOW });
  const props = {
    rows,
    stages: STAGES,
    intakeStages: intakeStages(STAGES),
    members: MEMBERS,
    initialFilters: parseIntakeFilters(params),
    initialViewState: parseIntakeViewState(params),
    time: null,
    now: NOW.toISOString(),
  };
  return {
    /** Calls the component again, as React would after a state change. */
    tree(): ReactElement {
      hooks.cursor = 0;
      return IntakeWorkspace(props) as ReactElement;
    },
    /** Waits for every transition the handlers started. */
    async settle() {
      await Promise.all(hooks.transitions);
    },
  };
}

function find<T = Record<string, unknown>>(tree: ReactNode, type: unknown): { props: T } | undefined {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = find<T>(child, type);
      if (found) return found;
    }
    return undefined;
  }
  if (!tree || typeof tree !== "object" || !("props" in tree)) return undefined;
  const el = tree as ReactElement<{ children?: ReactNode }>;
  if (el.type === type) return el as unknown as { props: T };
  const inChildren = find<T>(el.props.children, type);
  if (inChildren) return inChildren;
  // A slot prop (the toolbar's toggle / primary / more) holds an element too.
  for (const [key, value] of Object.entries(el.props as Record<string, unknown>)) {
    if (key === "children" || !value || typeof value !== "object") continue;
    const found = find<T>(value as ReactNode, type);
    if (found) return found;
  }
  return undefined;
}

type TableProps = {
  rows: IntakeRow[];
  pendingLeadId: string | null;
  errors: Record<string, string>;
  sortKey: string;
  sortDir: string;
  onSetLane: (leadId: string, lane: "hot" | "warm" | "cold" | null) => void;
  onSort: (key: string) => void;
};

const table = (tree: ReactElement) => find<TableProps>(tree, IntakeTable)!.props;
const rowOf = (tree: ReactElement, id: string) => table(tree).rows.find((r) => r.lead.id === id)!;

beforeEach(() => {
  actions.setLaneAction.mockReset();
});

describe("choosing a temperature in a row's menu", () => {
  it("calls the lane action and flips the chip at once, then keeps it when the write lands", async () => {
    actions.setLaneAction.mockResolvedValue({ ok: true });
    const view = mount();
    expect(rowOf(view.tree(), "l-1").temperature).toMatchObject({ value: "hot", source: "suggested" });

    table(view.tree()).onSetLane("l-1", "cold");

    // Optimistic: the chip is the person's cold already, and the row is marked busy.
    const during = view.tree();
    expect(rowOf(during, "l-1").temperature).toMatchObject({ value: "cold", source: "person", reason: "Set by a person" });
    expect(table(during).pendingLeadId).toBe("l-1");
    expect(actions.setLaneAction).toHaveBeenCalledWith("l-1", "cold");

    await view.settle();
    const after = view.tree();
    expect(rowOf(after, "l-1").temperature).toMatchObject({ value: "cold", source: "person" });
    expect(table(after).pendingLeadId).toBeNull();
    expect(table(after).errors["l-1"] ?? "").toBe("");
  });

  it("sets Hot, Warm and Cold, each through the lane action", async () => {
    actions.setLaneAction.mockResolvedValue({ ok: true });
    const view = mount();
    for (const lane of ["hot", "warm", "cold"] as const) {
      table(view.tree()).onSetLane("l-2", lane);
      expect(actions.setLaneAction).toHaveBeenLastCalledWith("l-2", lane);
      expect(rowOf(view.tree(), "l-2").temperature).toMatchObject({ value: lane, source: "person" });
      await view.settle();
    }
  });

  it("Clear falls back to the derived value", async () => {
    actions.setLaneAction.mockResolvedValue({ ok: true });
    const view = mount();
    table(view.tree()).onSetLane("l-1", "cold");
    await view.settle();
    table(view.tree()).onSetLane("l-1", null);
    expect(actions.setLaneAction).toHaveBeenLastCalledWith("l-1", null);
    expect(rowOf(view.tree(), "l-1").temperature).toMatchObject({ value: "hot", source: "suggested" });
    await view.settle();
    expect(rowOf(view.tree(), "l-1").temperature).toMatchObject({ value: "hot", source: "suggested" });
  });

  it("puts the row back and keeps the action's sentence when the write is refused", async () => {
    const sentence = "Your role can view leads but can't change them.";
    actions.setLaneAction.mockResolvedValue({ ok: false, error: sentence });
    const view = mount();

    table(view.tree()).onSetLane("l-1", "cold");
    expect(rowOf(view.tree(), "l-1").temperature.value).toBe("cold");

    await view.settle();
    const after = view.tree();
    expect(rowOf(after, "l-1").temperature).toMatchObject({ value: "hot", source: "suggested" });
    expect(table(after).errors["l-1"]).toBe(sentence);
    expect(table(after).pendingLeadId).toBeNull();
  });

  it("clears an earlier refusal when the next attempt starts", async () => {
    actions.setLaneAction.mockResolvedValueOnce({ ok: false, error: "No." }).mockResolvedValueOnce({ ok: true });
    const view = mount();
    table(view.tree()).onSetLane("l-1", "cold");
    await view.settle();
    expect(table(view.tree()).errors["l-1"]).toBe("No.");
    table(view.tree()).onSetLane("l-1", "warm");
    expect(table(view.tree()).errors["l-1"]).toBe("");
    await view.settle();
  });
});

describe("the Table | Board toggle", () => {
  it("is the controlled toggle, and its handler switches the view state", () => {
    const view = mount();
    const first = view.tree();
    expect(find(first, IntakeTable)).toBeDefined();
    expect(find(first, IntakeBoard)).toBeUndefined();
    const toggle = find<{ value: string; onChange: (v: string) => void; hrefFor?: unknown }>(first, ViewToggle)!;
    expect(toggle.props.value).toBe("table");
    expect(toggle.props.hrefFor).toBeUndefined();

    toggle.props.onChange("board");

    const second = view.tree();
    expect(find(second, IntakeBoard)).toBeDefined();
    expect(find(second, IntakeTable)).toBeUndefined();
    expect(find<{ value: string }>(second, ViewToggle)!.props.value).toBe("board");
    // Switching back lands on the table again.
    find<{ onChange: (v: string) => void }>(second, ViewToggle)!.props.onChange("table");
    expect(find(view.tree(), IntakeTable)).toBeDefined();
  });

  it("keeps the filters when the view changes", () => {
    const view = mount({ temp: "hot" });
    find<{ onChange: (v: string) => void }>(view.tree(), ViewToggle)!.props.onChange("board");
    const controls = find<{ filters: { temp: string }; view: string }>(view.tree(), IntakeControls)!;
    expect(controls.props.filters.temp).toBe("hot");
    expect(controls.props.view).toBe("board");
  });
});

describe("clicking a column header", () => {
  it("sorts by that column in its natural direction, then flips it", () => {
    const view = mount();
    expect(table(view.tree())).toMatchObject({ sortKey: "lastTouch", sortDir: "desc" });

    table(view.tree()).onSort("lead");
    expect(table(view.tree())).toMatchObject({ sortKey: "lead", sortDir: "asc" });
    table(view.tree()).onSort("lead");
    expect(table(view.tree())).toMatchObject({ sortKey: "lead", sortDir: "desc" });

    table(view.tree()).onSort("temperature");
    expect(table(view.tree())).toMatchObject({ sortKey: "temperature", sortDir: "desc" });
  });

  it("starts from the sort in the URL", () => {
    const view = mount({ sort: "lead", dir: "asc" });
    expect(table(view.tree())).toMatchObject({ sortKey: "lead", sortDir: "asc" });
  });

  it("orders the rows it hands the table by the sort", () => {
    const view = mount();
    expect(table(view.tree()).rows.map((r) => r.lead.id)).toEqual(["l-1", "l-2"]);
    table(view.tree()).onSort("temperature");
    // hot first, Not rated last
    expect(table(view.tree()).rows.map((r) => r.lead.id)).toEqual(["l-1", "l-2"]);
    table(view.tree()).onSort("temperature");
    expect(table(view.tree()).rows.map((r) => r.lead.id)).toEqual(["l-1", "l-2"]);
  });
});
