import { leadRoleFitsCategory, matterRoleFitsOpen, isLeadStageRole, isMatterStageRole } from "./roles";
import type { StageKind } from "./manage";

/**
 * What the owner's stage menu offers for ONE Board column, as data. Pure (the Leads board is a client component). The database
 * decides every rule again; this only keeps the menu from offering what it would refuse, and says why.
 *
 * - Change type (a lead stage's category, a matter stage's open/closed): only while the stage holds NOTHING, and only when its
 *   holdings were READ (an unread stage is never treated as empty).
 * - Delete: offered only when the holdings were read (the dialog must send the exact record ids it shows). Destinations: lead stages
 *   other than this one that are open, lost or nurture; from a WON stage only another won stage (0119: those leads already had their
 *   handoff). Matter stages: any other, with the same open/closed unless "Also change open/closed" is ticked.
 * - A stage holding a role asks which stage takes it: another stage with no role whose category (lead) or open/closed (matter) the
 *   role allows. "Drop the role" is offered where 0119 allows it: never for `new_enquiry`; a lead `signed_loe` only on the last won
 *   stage (with the "No won stage" tick); a matter `signed_loe` never.
 * - The last open lead stage cannot be deleted (said, not offered).
 */
export type MenuStage = { id: string; name: string; category?: string | null; isOpen?: boolean | null; role?: string | null };

export type StageMenuModel = {
  stage: MenuStage;
  kind: StageKind;
  prevId: string | null;
  nextId: string | null;
  /** null: the holdings couldn't be read. */
  holds: string[] | null;
  canChangeType: boolean;
  /** A lead stage that is the firm's only won stage (changing its type or deleting it needs the "No won stage" tick). */
  lastWon: boolean;
  delete:
    | { available: false; reason: "unreadable" | "last-open" }
    | {
        available: true;
        ids: string[];
        destinations: MenuStage[];
        /** Matter: destinations allowed only with "Also change open/closed" ticked. */
        otherOpenDestinations: MenuStage[];
        lastWon: boolean;
        role: { role: string; targets: MenuStage[]; canDrop: boolean } | null;
      };
};

export function stageMenuModel(input: {
  kind: StageKind;
  stage: MenuStage;
  /** Every stage of this kind the firm has (not only the drawn columns). */
  all: readonly MenuStage[];
  prevId: string | null;
  nextId: string | null;
  /** stage id -> record ids; null = couldn't be read. */
  holdings: Readonly<Record<string, readonly string[]>> | null;
}): StageMenuModel {
  const { kind, stage, all } = input;
  const holds = input.holdings ? [...(input.holdings[stage.id] ?? [])] : null;
  const others = all.filter((s) => s.id !== stage.id);
  const lastWonStage = kind === "lead" && stage.category === "won" && !others.some((s) => s.category === "won");
  const base = { stage, kind, prevId: input.prevId, nextId: input.nextId, holds, canChangeType: holds !== null && holds.length === 0, lastWon: lastWonStage };
  if (holds === null) return { ...base, delete: { available: false, reason: "unreadable" } };

  if (kind === "lead") {
    if (stage.category === "open" && !others.some((s) => s.category === "open")) return { ...base, delete: { available: false, reason: "last-open" } };
    const lastWon = lastWonStage;
    const destinations = stage.category === "won" ? others.filter((s) => s.category === "won") : others.filter((s) => s.category === "open" || s.category === "lost" || s.category === "nurture");
    const held = stage.role;
    const role = isLeadStageRole(held)
      ? {
          role: held,
          targets: others.filter((s) => !s.role && leadRoleFitsCategory(held, s.category)),
          canDrop: held !== "new_enquiry" && (held !== "signed_loe" || lastWon),
        }
      : null;
    return { ...base, delete: { available: true, ids: holds, destinations, otherOpenDestinations: [], lastWon, role } };
  }

  const open = stage.isOpen !== false;
  const same = others.filter((s) => (s.isOpen !== false) === open);
  const flip = others.filter((s) => (s.isOpen !== false) !== open);
  const held = stage.role;
  const role = isMatterStageRole(held) ? { role: held, targets: others.filter((s) => !s.role && matterRoleFitsOpen(held, s.isOpen)), canDrop: held !== "signed_loe" } : null;
  return { ...base, delete: { available: true, ids: holds, destinations: same, otherOpenDestinations: flip, lastWon: false, role } };
}

/** The visible neighbours of each column, in the order the Board draws them (Move left / right go BESIDE these). */
export function neighbours(order: readonly string[], id: string): { prevId: string | null; nextId: string | null } {
  const at = order.indexOf(id);
  if (at < 0) return { prevId: null, nextId: null };
  return { prevId: order[at - 1] ?? null, nextId: order[at + 1] ?? null };
}
