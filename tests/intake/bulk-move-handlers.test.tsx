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
  bulkMoveStageAction: vi.fn(),
  setSourceAction: vi.fn(),
}));
vi.mock("@/app/dashboard/intake/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock("@/app/dashboard/leads/actions", () => ({ createLeadAction: vi.fn() }));
vi.mock("@/app/dashboard/intake/time-actions", () => ({ startTimerAction: vi.fn(), stopTimerAction: vi.fn(), logTimeAction: vi.fn() }));

const { default: IntakeWorkspace } = await import("@/app/dashboard/intake/_components/IntakeWorkspace");
const { default: IntakeBoard } = await import("@/app/dashboard/intake/_components/IntakeBoard");
const { default: BulkMoveBar } = await import("@/app/dashboard/intake/_components/BulkMoveBar");

const NOW = new Date("2026-10-20T12:00:00.000Z");
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const STAGES = [
  { id: "s1", org_id: "o", name: "New enquiry", order_index: 1, category: "open", aging_threshold_days: 30 },
  { id: "s2", org_id: "o", name: "Consultation Scheduled", order_index: 2, category: "open", aging_threshold_days: 30 },
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
const LEADS = [leadRow("l-1", { last_inbound_at: daysBefore(1) }), leadRow("l-2"), leadRow("l-3")];

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
  return find<T>(el.props.children, type);
}


type BoardProps = {
  rows: IntakeRow[];
  selectedIds: ReadonlySet<string>;
  errors: Record<string, string>;
  onToggleSelect: (leadId: string) => void;
};
type BarProps = {
  selectedCount: number;
  shownCount: number;
  pending: boolean;
  message: { tone: string; text: string } | null;
  onSelectShown: () => void;
  onClear: () => void;
  onMove: (stageId: string) => void;
};
const board = (tree: ReactElement) => find<BoardProps>(tree, IntakeBoard)!.props;
const bar = (tree: ReactElement) => find<BarProps>(tree, BulkMoveBar)!.props;
const stageOf = (tree: ReactElement, id: string) => board(tree).rows.find((r) => r.lead.id === id)!.lead.current_stage_id;

beforeEach(() => {
  actions.bulkMoveStageAction.mockReset();
});

describe("Move to... for ticked cards", () => {
  it("ticking cards selects them, and Select shown ticks up to the cap", () => {
    const view = mount({ view: "board" });
    expect(bar(view.tree())).toMatchObject({ selectedCount: 0, shownCount: 3 });
    board(view.tree()).onToggleSelect("l-1");
    board(view.tree()).onToggleSelect("l-2");
    expect([...board(view.tree()).selectedIds].sort()).toEqual(["l-1", "l-2"]);
    expect(bar(view.tree()).selectedCount).toBe(2);
    board(view.tree()).onToggleSelect("l-1");
    expect([...board(view.tree()).selectedIds]).toEqual(["l-2"]);
    bar(view.tree()).onSelectShown();
    expect(bar(view.tree()).selectedCount).toBe(3);
    bar(view.tree()).onClear();
    expect(bar(view.tree()).selectedCount).toBe(0);
  });

  it("sends the ticked ids and the stage to the action, shows it busy, then moves the cards and clears the ticks", async () => {
    actions.bulkMoveStageAction.mockResolvedValue({ ok: true, stageId: "s2", moved: ["l-1", "l-2"], skipped: [], failed: [] });
    const view = mount({ view: "board" });
    board(view.tree()).onToggleSelect("l-1");
    board(view.tree()).onToggleSelect("l-2");
    bar(view.tree()).onMove("s2");
    expect(actions.bulkMoveStageAction).toHaveBeenCalledWith(["l-1", "l-2"], "s2");
    expect(bar(view.tree()).pending).toBe(true);
    await view.settle();
    const after = view.tree();
    expect(stageOf(after, "l-1")).toBe("s2");
    expect(stageOf(after, "l-2")).toBe("s2");
    expect(stageOf(after, "l-3")).toBe("s1");
    expect(bar(after)).toMatchObject({ pending: false, selectedCount: 0 });
    expect(bar(after).message).toEqual({ tone: "ok", text: "Moved 2 leads to 2 · Consultation Scheduled." });
  });

  it("a partial failure moves the rest, keeps the failed card ticked with its own reason, and says so", async () => {
    actions.bulkMoveStageAction.mockResolvedValue({
      ok: true,
      stageId: "s2",
      moved: ["l-1"],
      skipped: [],
      failed: [{ leadId: "l-2", error: "You don't have permission to move this lead to that stage." }],
    });
    const view = mount({ view: "board" });
    board(view.tree()).onToggleSelect("l-1");
    board(view.tree()).onToggleSelect("l-2");
    bar(view.tree()).onMove("s2");
    await view.settle();
    const after = view.tree();
    expect(stageOf(after, "l-1")).toBe("s2");
    expect(stageOf(after, "l-2")).toBe("s1");
    expect([...board(after).selectedIds]).toEqual(["l-2"]);
    expect(board(after).errors["l-2"]).toBe("You don't have permission to move this lead to that stage.");
    expect(bar(after).message).toMatchObject({ tone: "warn" });
    expect(bar(after).message?.text).toContain("1 lead couldn't be moved");
  });

  it("a refused request (a won stage, a viewer) moves nothing and says why", async () => {
    actions.bulkMoveStageAction.mockResolvedValue({ ok: false, error: "That stage opens a matter, so leads can't be moved there in bulk. Open the lead and move it from there." });
    const view = mount({ view: "board" });
    board(view.tree()).onToggleSelect("l-1");
    bar(view.tree()).onMove("s9");
    await view.settle();
    const after = view.tree();
    expect(stageOf(after, "l-1")).toBe("s1");
    expect(bar(after).message).toMatchObject({ tone: "error" });
    expect([...board(after).selectedIds]).toEqual(["l-1"]);
  });

  it("an action that throws is said, and nothing moves on screen", async () => {
    actions.bulkMoveStageAction.mockRejectedValue(new Error("network"));
    const view = mount({ view: "board" });
    board(view.tree()).onToggleSelect("l-1");
    bar(view.tree()).onMove("s2");
    await view.settle();
    expect(stageOf(view.tree(), "l-1")).toBe("s1");
    expect(bar(view.tree())).toMatchObject({ pending: false });
    expect(bar(view.tree()).message).toMatchObject({ tone: "error" });
  });
});
