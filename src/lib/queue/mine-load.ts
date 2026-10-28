import "server-only";
import type { QueueLoad } from "@/lib/queue/load";
import { loadApprovalRouting } from "@/lib/queue/routing-load";
import { mineItems } from "@/lib/queue/mine";
import type { Viewer } from "@/lib/queue/routing";

/** The queue load with its items narrowed to the viewer's own. Any state but `ok` passes through untouched (three states kept). */
export async function mineQueue(load: QueueLoad, viewer: Viewer | null): Promise<QueueLoad> {
  if (load.status !== "ok" || load.items.length === 0) return load;
  const routed = await loadApprovalRouting();
  return { ...load, items: mineItems(load.items, routed.status === "ok" ? routed.routing : null, viewer) };
}
