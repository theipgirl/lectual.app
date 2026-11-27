import type { ListColumn } from "@/components/views/table/ViewTable";
import type { SheetColumn } from "./sheet-columns";

/** A review column (the registry's) as the shared List knows it. The key stays the registry id; the label is the firm's if its layout renamed it. */
export function listColumnOf(c: SheetColumn): ListColumn {
  return { key: c.id, label: c.header, title: c.title, width: c.width ?? null, pinned: c.pinned, editable: c.editable, kind: c.kind };
}
