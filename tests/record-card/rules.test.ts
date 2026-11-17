import { describe, expect, it, vi } from "vitest";

// The real role lists live beside the scoped client; nothing here touches a database.
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn() }));

import { ROLES, type Role } from "@/lib/auth/roles";
import { FILE_UPLOAD_ROLES } from "@/lib/files/roles";
import { MERGE_ROLES } from "@/lib/leads/merge";
import { MATTER_WRITE_ROLES } from "@/lib/matters/matters";
import { CAN_MOVE_STAGE, CAN_WRITE_LEAD } from "@/lib/pipeline/leads";
import { REFERRAL_SOURCES } from "@/lib/intake/referral-source";
import {
  CARD_CONTROLS,
  CARD_ROLE_LISTS,
  SOURCE_CHOICES,
  approvalsChip,
  cardEdits,
  cardMenu,
  moveTargets,
  savedMark,
  temperatureControl,
  type CardControl,
} from "@/lib/record-card/rules";

const sorted = (a: readonly string[]) => [...a].sort();

describe("the card's role lists are the actions' own lists", () => {
  it("each copy equals the list the action checks", () => {
    expect(sorted(CARD_ROLE_LISTS.writeLead)).toEqual(sorted(CAN_WRITE_LEAD));
    expect(sorted(CARD_ROLE_LISTS.writeMatter)).toEqual(sorted(MATTER_WRITE_ROLES));
    expect(sorted(CARD_ROLE_LISTS.moveStage)).toEqual(sorted(CAN_MOVE_STAGE));
    expect(sorted(CARD_ROLE_LISTS.upload)).toEqual(sorted(FILE_UPLOAD_ROLES));
    expect(sorted(CARD_ROLE_LISTS.merge)).toEqual(sorted(MERGE_ROLES));
  });
  it("the source pick is the firm's list only", () => {
    expect(SOURCE_CHOICES).toEqual(REFERRAL_SOURCES);
  });
});

/** The expected answer, derived straight from the action lists, control by control. */
function expected(role: Role, kind: "lead" | "matter"): Record<CardControl, boolean> {
  const wl = CAN_WRITE_LEAD.includes(role);
  const wm = MATTER_WRITE_ROLES.includes(role);
  const up = FILE_UPLOAD_ROLES.includes(role);
  if (kind === "lead") {
    return {
      temperature: wl, source: wl, owner: wl, stepAdd: wl, stepEdit: wm, stepDone: wm, stepSnooze: wm,
      stage: CAN_MOVE_STAGE.includes(role) && wl, tags: wl, rename: wl, title: false, noShow: wl,
      merge: MERGE_ROLES.includes(role), upload: up, notes: wl,
    };
  }
  return {
    temperature: false, source: wm, owner: wm, stepAdd: wm, stepEdit: wm, stepDone: wm, stepSnooze: wm,
    stage: wm, tags: false, rename: false, title: wm, noShow: false, merge: false, upload: up, notes: wm,
  };
}

describe("cardEdits: every role x kind x control", () => {
  it("covers all ten roles and every control", () => {
    expect(ROLES.length).toBe(10);
    expect(CARD_CONTROLS.length).toBe(15);
  });

  for (const role of ROLES) {
    for (const kind of ["lead", "matter"] as const) {
      it(`${role} on a ${kind}`, () => {
        const got = cardEdits({ role, kind, mergeAvailable: true, hasDuplicate: true });
        expect(got).toEqual(expected(role, kind));
      });
    }
  }

  it("viewer and social media get no control at all, on either kind", () => {
    for (const role of ["viewer", "social_media"] as const) {
      for (const kind of ["lead", "matter"] as const) {
        expect(Object.values(cardEdits({ role, kind, mergeAvailable: true, hasDuplicate: true })).some(Boolean)).toBe(false);
      }
    }
  });

  it("a paralegal edits a lead but gets no stage control on it", () => {
    const e = cardEdits({ role: "paralegal", kind: "lead" });
    expect(e.stage).toBe(false);
    expect(e.temperature && e.rename && e.tags && e.source && e.owner).toBe(true);
  });

  it("only owner, admin and senior admin see Merge, and only with 0107 there and a duplicate known", () => {
    for (const role of ROLES) {
      expect(cardEdits({ role, kind: "lead", mergeAvailable: true, hasDuplicate: true }).merge).toBe(["owner", "admin", "senior_admin"].includes(role));
    }
    expect(cardEdits({ role: "owner", kind: "lead", mergeAvailable: false, hasDuplicate: true }).merge).toBe(false);
    expect(cardEdits({ role: "owner", kind: "lead", mergeAvailable: true, hasDuplicate: false }).merge).toBe(false);
    expect(cardEdits({ role: "owner", kind: "lead" }).merge).toBe(false);
  });

  it("an unknown, null or made-up role draws nothing", () => {
    for (const role of [null, undefined, "", "superuser", "OWNER"]) {
      expect(Object.values(cardEdits({ role, kind: "lead", mergeAvailable: true, hasDuplicate: true })).some(Boolean)).toBe(false);
    }
  });

  it("an unreadable member list shows the owner read only; unreadable stages show the stage read only", () => {
    const e = cardEdits({ role: "owner", kind: "lead", readable: { members: false, stages: false } });
    expect(e.owner).toBe(false);
    expect(e.stage).toBe(false);
    expect(e.temperature).toBe(true);
    const m = cardEdits({ role: "owner", kind: "matter", readable: { members: false, stages: false } });
    expect(m.owner).toBe(false);
    expect(m.stage).toBe(false);
  });
});

describe("moveTargets", () => {
  const stages = [
    { id: "s-new", name: "New", category: "open" },
    { id: "s-held", name: "Consult held", category: "open" },
    { id: "s-won", name: "Signed LOE", category: "won" },
    { id: "s-won2", name: "Hired", category: "won" },
    { id: "s-lost", name: "Lost", category: "lost" },
    { id: "s-nur", name: "Long-Term Nurture", category: "nurture" },
  ];
  it("never offers a won stage for a lead, and leaves out the current stage", () => {
    const t = moveTargets(stages, "lead", "s-new");
    expect(t.map((s) => s.id)).toEqual(["s-held", "s-lost", "s-nur"]);
    expect(t.some((s) => s.id.startsWith("s-won"))).toBe(false);
  });
  it("offers a matter's docket stages", () => {
    expect(moveTargets([{ id: "a", label: "Filed" }, { id: "b", label: "Registered" }], "matter", "a")).toEqual([{ id: "b", name: "Registered" }]);
  });
});

describe("temperatureControl", () => {
  it("a person's level is a FILLED pill; the menu has no Accept line", () => {
    const c = temperatureControl({ value: "hot", source: "person", reason: "Set by a person" }, { canEdit: true });
    expect(c.pill).toMatchObject({ value: "hot", label: "Hot", style: "filled", mark: null });
    expect(c.menu.map((m) => m.label)).toEqual(["Hot", "Warm", "Cold", "Not rated"]);
    expect(c.menu.find((m) => m.current)?.value).toBe("hot");
  });
  it("a suggested level is an OUTLINED pill with the small mark, and Accept comes first", () => {
    const c = temperatureControl({ value: "warm", source: "suggested", reason: "Replied 2 days ago" }, { canEdit: true });
    expect(c.pill).toMatchObject({ value: "warm", style: "outlined", mark: "suggested" });
    expect(c.menu[0]).toEqual({ kind: "accept", value: "warm", label: "Lectual suggests Warm · Accept", current: false });
    expect(c.menu.slice(1).map((m) => m.label)).toEqual(["Hot", "Warm", "Cold", "Not rated"]);
    expect(c.menu.find((m) => m.label === "Not rated")).toMatchObject({ value: null, current: true });
  });
  it("Not rated: no pill colour, no Accept", () => {
    const c = temperatureControl({ value: null, source: "suggested", reason: "x" }, { canEdit: true });
    expect(c.pill).toMatchObject({ value: null, label: "Not rated", style: "none" });
    expect(c.menu.some((m) => m.kind === "accept")).toBe(false);
  });
  it("with the suggestion off or unreadable there is no suggestion line; a person's level still shows", () => {
    for (const suggestion of ["off", "unavailable"] as const) {
      const s = temperatureControl({ value: "warm", source: "suggested", reason: "x" }, { canEdit: true, suggestion });
      expect(s.pill.style).toBe("none");
      expect(s.menu.some((m) => m.kind === "accept")).toBe(false);
      const p = temperatureControl({ value: "cold", source: "person", reason: "x" }, { canEdit: true, suggestion });
      expect(p.pill).toMatchObject({ value: "cold", style: "filled" });
    }
  });
  it("a role that can't set it gets the pill and no menu", () => {
    expect(temperatureControl({ value: "warm", source: "suggested", reason: "x" }, { canEdit: false }).menu).toEqual([]);
  });
});

describe("savedMark: Saved only from the action's own success", () => {
  it("reads { saved: true } and { ok: true } as Saved", () => {
    expect(savedMark({ saved: true })).toEqual({ saved: true, error: null });
    expect(savedMark({ ok: true })).toEqual({ saved: true, error: null });
  });
  it("a refusal shows its own sentence, never Saved", () => {
    expect(savedMark({ error: "You don't have permission to change this." })).toEqual({ saved: false, error: "You don't have permission to change this." });
    expect(savedMark({ ok: false, error: "That isn't a temperature." })).toEqual({ saved: false, error: "That isn't a temperature." });
    expect(savedMark({ saved: true, error: "The lead was moved, but the reason couldn't be saved as a note." }).saved).toBe(false);
  });
  it("nothing, {} or an unknown shape is not Saved", () => {
    for (const r of [undefined, null, {}, "ok", { saved: "yes" }]) expect(savedMark(r)).toEqual({ saved: false, error: null });
  });
});

describe("approvalsChip (Needs attorney · N)", () => {
  const Q = "00000000-0000-4000-8000-0000000000aa";
  it("one waiting approval links straight to it", () => {
    expect(approvalsChip({ status: "ok", queueIds: [Q] }, "/open")).toEqual({ text: "Needs attorney · 1", href: `/dashboard/queue/${Q}/`, tone: "warn" });
  });
  it("more than one opens the card", () => {
    expect(approvalsChip({ status: "ok", queueIds: [Q, "b"] }, "/dashboard/intake/?open=lead%3Ax")).toMatchObject({ text: "Needs attorney · 2", href: "/dashboard/intake/?open=lead%3Ax" });
  });
  it("none or an unconfigured queue draws no chip; a failed read says so and is never 0", () => {
    expect(approvalsChip({ status: "ok", queueIds: [] }, "/o")).toBeNull();
    expect(approvalsChip({ status: "unconfigured" }, "/o")).toBeNull();
    const failed = approvalsChip({ status: "unavailable" }, "/o");
    expect(failed).toEqual({ text: "Approvals couldn't load", href: null, tone: "muted" });
    expect(failed?.text).not.toMatch(/0/);
  });
});

describe("cardMenu", () => {
  const ID = "00000000-0000-4000-8000-000000000001";
  const DUP = "00000000-0000-4000-8000-000000000002";
  it("an owner on a lead with a duplicate: move, step, no-show, merge (the existing screen), open", () => {
    const edits = cardEdits({ role: "owner", kind: "lead", mergeAvailable: true, hasDuplicate: true });
    const m = cardMenu({ kind: "lead", id: ID, edits, targets: [{ id: "s", name: "S" }], duplicateOf: DUP });
    expect(m.map((i) => i.id)).toEqual(["move", "step", "noShow", "merge", "open"]);
    expect(m.find((i) => i.id === "merge")?.href).toBe(`/dashboard/intake/merge/?a=${ID}&b=${DUP}`);
    expect(m.find((i) => i.id === "open")?.href).toBe(`/dashboard/leads/${ID}/`);
  });
  it("a viewer gets only Open full page", () => {
    const edits = cardEdits({ role: "viewer", kind: "lead" });
    expect(cardMenu({ kind: "lead", id: ID, edits, targets: [], duplicateOf: DUP }).map((i) => i.id)).toEqual(["open"]);
  });
  it("an attorney never sees Merge, even with a duplicate", () => {
    const edits = cardEdits({ role: "attorney", kind: "lead", mergeAvailable: true, hasDuplicate: true });
    expect(cardMenu({ kind: "lead", id: ID, edits, targets: [{ id: "s", name: "S" }], duplicateOf: DUP }).some((i) => i.id === "merge")).toBe(false);
  });
  it("a matter has no no-show and no merge, and opens the matter page", () => {
    const edits = cardEdits({ role: "owner", kind: "matter" });
    const m = cardMenu({ kind: "matter", id: ID, edits, targets: [{ id: "s", name: "S" }] });
    expect(m.map((i) => i.id)).toEqual(["move", "step", "open"]);
    expect(m.at(-1)?.href).toBe(`/dashboard/matters/${ID}/`);
  });
});
