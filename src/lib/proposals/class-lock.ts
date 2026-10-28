/**
 * "One class is always included" (Sprint 28 A). Pure: no database, safe in a
 * `"use client"` component, the accept path and `validateContent` alike.
 *
 * Every package includes at least one class per brand name. So a brand name
 * with exactly one class ticked cannot have it unticked: the control is shown
 * checked and disabled with the reason written next to it. Several ticked
 * classes are all free to change until one is left, and then that one locks.
 * (Read of the spec's "the LAST checked class cannot be unchecked": the last one
 * standing, not the last in the list.)
 *
 * The lock is advice to the page; the server does not rely on it. `repairSelection`
 * is what the accept path and the content check run, so a hand-built request that
 * ticks a mark and no class cannot be recorded.
 */

import type { ProposalContent, Selection } from "./types";

type NameShape = Pick<ProposalContent["names"][number], "marks" | "classes">;

export type ClassLock = {
  /** The class that cannot be unticked. */
  classId: string;
  /** The words shown beside the disabled box. */
  text: string;
};

export const CLASS_LOCK_ONLY_TEXT = "Included";
export const CLASS_LOCK_LAST_TEXT = "At least one class is included";

/** Which class of this brand name, if any, is locked on. At most one. */
export function classLock(name: NameShape, selection: Selection): ClassLock | null {
  const classes = Array.isArray(name?.classes) ? name.classes : [];
  const ticked = classes.filter((c) => selection?.[c.id] === true);
  if (ticked.length !== 1) return null;
  return { classId: ticked[0].id, text: classes.length === 1 ? CLASS_LOCK_ONLY_TEXT : CLASS_LOCK_LAST_TEXT };
}

/** The locks for a whole proposal, by brand name id. */
export function classLocks(content: ProposalContent, selection: Selection): Record<string, ClassLock> {
  const out: Record<string, ClassLock> = {};
  for (const nm of Array.isArray(content?.names) ? content.names : []) {
    const lock = classLock(nm, selection);
    if (lock) out[nm.id] = lock;
  }
  return out;
}

/** True when a brand name has a ticked mark and no ticked class. */
export function markWithoutClass(name: NameShape, selection: Selection): boolean {
  const marks = Array.isArray(name?.marks) ? name.marks : [];
  const classes = Array.isArray(name?.classes) ? name.classes : [];
  return marks.some((m) => selection?.[m.id] === true) && !classes.some((c) => selection?.[c.id] === true);
}

export type RepairedSelection =
  | { ok: true; selection: Selection; repaired: string[] }
  | { ok: false; nameId: string };

/**
 * A selection with no ticked mark left without a class: the first class of that
 * brand name is ticked. A brand name that has no class at all cannot be repaired
 * and is refused, so the caller never records a mark that buys nothing.
 */
export function repairSelection(content: ProposalContent, selection: Selection): RepairedSelection {
  const next: Selection = { ...selection };
  const repaired: string[] = [];
  for (const nm of Array.isArray(content?.names) ? content.names : []) {
    if (!markWithoutClass(nm, next)) continue;
    const first = (nm.classes ?? [])[0];
    if (!first) return { ok: false, nameId: nm.id };
    next[first.id] = true;
    repaired.push(nm.id);
  }
  return { ok: true, selection: next, repaired };
}

export type RepairedContent =
  | { ok: true; content: ProposalContent; repaired: string[] }
  | { ok: false; nameId: string };

/**
 * The same rule applied to a content document's "starts ticked" flags: a brand name
 * whose mark starts ticked and has no class that starts ticked gets its first class
 * ticked. One with no class at all cannot be repaired. Returns a copy.
 */
export function repairPreselections(content: ProposalContent): RepairedContent {
  const repaired: string[] = [];
  for (const nm of Array.isArray(content?.names) ? content.names : []) {
    const marks = Array.isArray(nm?.marks) ? nm.marks : [];
    const classes = Array.isArray(nm?.classes) ? nm.classes : [];
    if (!marks.some((m) => m.preselected === true) || classes.some((c) => c.preselected === true)) continue;
    if (classes.length === 0) return { ok: false, nameId: nm.id };
    repaired.push(nm.id);
  }
  if (repaired.length === 0) return { ok: true, content, repaired };
  return {
    ok: true,
    repaired,
    content: {
      ...content,
      names: content.names.map((nm) =>
        repaired.includes(nm.id) ? { ...nm, classes: nm.classes.map((c, i) => (i === 0 ? { ...c, preselected: true } : c)) } : nm,
      ),
    },
  };
}
