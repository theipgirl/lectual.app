"use server";

import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { StopDb } from "@/lib/campaigns/stop-db";
import { mergedSetFor, resolveLeadId } from "@/lib/leads/live";
import { cardCaller, readCardItem, staffPreviewRefusal } from "@/lib/queue/card-moves";
import { groupPendingByLead } from "@/lib/queue/lead-pending";
import { loadApprovalRouting } from "@/lib/queue/routing-load";
import { runQueueReview } from "@/lib/queue/review-core";
import { closerLookFor } from "./load";
import {
  runLeadStepEdit,
  runLeadStepNotThis,
  runLeadStepYes,
  type EditResult,
  type LeadStepActionDeps,
  type NotThisResult,
  type YesResult,
} from "./actions-core";

/**
 * The lead page top card's Yes / Edit / Not this. Thin wiring over `actions-core.ts` (the order of the checks and
 * every sentence live there) and the EXISTING approve core (`runQueueReview`, `src/lib/queue/review-core.ts`), with no
 * wrapper of its own around it. Not wired to any page yet (Sprint 9 Part 2 draws the card).
 *
 * Every export is its own POST endpoint: each takes only the lead id, the queue item id and (for Edit / Not this) the
 * text. The caller, role and firm come from the session; reads go through the signed-in client; nothing sends. Yes is
 * posted only after the page's 5-second hold ends (the browser's Undo inside the hold posts nothing).
 */

const deps: LeadStepActionDeps = {
  staffPreview: staffPreviewRefusal,
  caller: async () => {
    const c = await cardCaller();
    return c ? { userId: c.userId, role: c.role } : null;
  },
  readItem: readCardItem,
  leadIdsOf: async (item) => {
    try {
      const db = (await getScopedClient()) as unknown as StopDb;
      // The lead page's own grouping (the queue's resolver), for this one item.
      return Object.keys(await groupPendingByLead(db, [item]));
    } catch {
      return null;
    }
  },
  leadSet: async (leadId) => {
    try {
      const db = await getScopedClient();
      const keeper = await resolveLeadId(db, leadId);
      if (keeper.status !== "ok") return null;
      const set = await mergedSetFor(db, keeper.id);
      return set.ids;
    } catch {
      return null;
    }
  },
  routing: async () => {
    const r = await loadApprovalRouting();
    return r.status === "ok" ? { status: "ok", routing: r.routing, members: r.members } : { status: "failed" };
  },
  closerLook: async (item) => (await closerLookFor(item)).reasons,
  review: runQueueReview,
  revalidate: (leadId) => {
    revalidatePath(`/dashboard/leads/${leadId}/`);
    revalidatePath("/dashboard/queue/");
  },
};

export async function leadStepYesAction(leadId: unknown, itemId: unknown): Promise<YesResult> {
  return runLeadStepYes(deps, leadId, itemId);
}

export async function leadStepNotThisAction(leadId: unknown, itemId: unknown, reason: unknown): Promise<NotThisResult> {
  return runLeadStepNotThis(deps, leadId, itemId, reason);
}

export async function leadStepEditAction(leadId: unknown, itemId: unknown, body: unknown): Promise<EditResult> {
  return runLeadStepEdit(deps, leadId, itemId, body);
}
