import type { SheetStatus } from "@/lib/review/sheet-edit";

/**
 * One tiny store joining the Sheet's table (which saves) to the "Saved · <client>, <field>" line in the page header (which
 * says so). Browser-only state; on the server it is only ever the empty value (a preview harness may set a sample first).
 */
let current: SheetStatus | null = null;
const listeners = new Set<() => void>();

export const sheetStatusStore = {
  get: (): SheetStatus | null => current,
  set(next: SheetStatus | null) {
    current = next;
    for (const l of listeners) l();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
