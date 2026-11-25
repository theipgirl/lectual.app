"use server";

import { revalidatePath } from "next/cache";
import { previewSafe } from "@/lib/views/preview-safe";
import { getScopedClient } from "@/lib/db/scoped-client";
import { listStages } from "@/lib/pipeline/stages";
import { loadMatterStages } from "@/lib/matters/stages";
import { loadOwnerState } from "@/lib/views/layout/owner-load";
import { stopLeadSequencesAsStaff } from "@/lib/campaigns/stop-staff";
import { changeStage, type ManagedStage, type StageDeps, type StageKind, type StageResult } from "./manage";

/**
 * The owner's stage menu on the Leads and Matters boards, as ONE server action. A thin wrapper: the logic is `manage.ts`, and its
 * dependencies are built here from the caller's SCOPED client (never the service role). The stage functions (lectual 0119) are
 * SECURITY DEFINER and check the owner membership row themselves; `manage.ts` asks it first too.
 */

const PATHS: Record<StageKind, string[]> = {
  lead: ["/dashboard/intake/", "/dashboard/review/", "/dashboard/pipeline/"],
  matter: ["/dashboard/matters/", "/dashboard/review/"],
};

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

async function readStages(kind: StageKind): Promise<ManagedStage[] | null> {
  if (kind === "lead") {
    const rows = await listStages();
    return rows.map((s) => ({ id: s.id, name: s.name, order_index: s.order_index, category: s.category }));
  }
  const read = await loadMatterStages();
  if (read.status === "unavailable") return null;
  return read.stages.map((s) => ({ id: s.id, name: s.label, order_index: s.order_index, is_open: s.is_open, ...(s.phase !== undefined ? { phase: s.phase } : {}) }));
}

function deps(): StageDeps {
  return {
    owner: () => loadOwnerState(),
    readStages,
    rpc: async (fn, args) => {
      const db = (await getScopedClient()) as unknown as RpcClient;
      return db.rpc(fn, args);
    },
    // Exactly what a person's move into this stage does to sequences (moveLeadStage): only a WON destination stops them.
    stopSequences: async (leadIds, destination) => {
      if (destination.category !== "won") return true;
      const out = await stopLeadSequencesAsStaff({
        leadIds,
        reason: "client",
        factAt: new Date().toISOString(),
        evidence: { stage_id: destination.id, stage_name: destination.name },
      });
      return out.status === "ok";
    },
    revalidate: (kind) => {
      for (const path of PATHS[kind]) revalidatePath(path);
    },
  };
}

/** Rename, move, add, change the type of, or delete a lead or matter stage. The browser sends the operation; positions are worked out here. */
export const changeStageAction = previewSafe(async function changeStageAction(kind: string, op: unknown): Promise<StageResult> {
  return changeStage(deps(), kind, op);
}, "state");
