/**
 * Which items an owner's column menu offers, by what the column is. Pure.
 * The pinned column (the link to the record) can be renamed but never hidden or moved, and nothing is added to ITS left (it holds the first
 * place). A lane has no "add a column". The server refuses the same things again (`next.ts`).
 */
export type MenuItemId = "rename" | "hide" | "left" | "right" | "add-left" | "add-right";

export function menuItems({ pinned, allowAdd }: { pinned: boolean; allowAdd: boolean }): MenuItemId[] {
  const items: MenuItemId[] = ["rename"];
  if (!pinned) items.push("hide", "left", "right");
  if (allowAdd && !pinned) items.push("add-left");
  if (allowAdd) items.push("add-right");
  return items;
}
