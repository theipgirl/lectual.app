/**
 * Which items an owner's column menu offers, by what the column is. Pure.
 * The pinned column (the link to the record) can be renamed but never hidden or moved, and nothing is added to ITS left (it holds the first
 * place). A move needs a visible neighbour on that side (`prev` / `next`, null when there is none or it is the pinned one). A lane has no
 * "add a column". A firm's own column can also have its choices edited (Choice kind) and be archived. The server refuses the same
 * things again (`next.ts`, the field logic).
 */
export type MenuItemId = "rename" | "hide" | "left" | "right" | "add-left" | "add-right" | "choices" | "archive";

export function menuItems({ pinned, allowAdd, hasPrev = true, hasNext = true, firm = null, hideOnly = false }: { pinned: boolean; allowAdd: boolean; hasPrev?: boolean; hasNext?: boolean; firm?: { kind: string } | null; /** A stage column on a Matters or Contracts Board: the layout only hides it (its name and place are the stage's own). */ hideOnly?: boolean }): MenuItemId[] {
  if (hideOnly) return ["hide"];
  const items: MenuItemId[] = ["rename"];
  if (!pinned) {
    items.push("hide");
    if (hasPrev) items.push("left");
    if (hasNext) items.push("right");
  }
  if (allowAdd && !pinned) items.push("add-left");
  if (allowAdd) items.push("add-right");
  if (firm?.kind === "choice") items.push("choices");
  if (firm) items.push("archive");
  return items;
}
