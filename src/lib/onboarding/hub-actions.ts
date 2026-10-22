"use server";

import { getScopedClient } from "@/lib/db/scoped-client";
import { buildHubMeta, hideCard, isHubFlowId, markFlowDone, parseHubProgress, resetProgress, type HubProgress, type RecordPick } from "./hub";

export type HubSaveResult = { ok: true } | { ok: false; error: string };

const NOT_SAVED = "We couldn't save your progress.";
const NOT_SIGNED_IN = "You are not signed in.";

/**
 * Reads the signed-in person's own `user_metadata`, lets `change` produce the
 * next progress, and writes it back merged with every other key (the first-sign-in
 * tour's flag included). Session client only: no user id or org id is accepted,
 * and the flag decides what is drawn, never what anyone may see or do.
 */
async function saveProgress(change: (current: HubProgress) => HubProgress): Promise<HubSaveResult> {
  try {
    const supabase = await getScopedClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError) return { ok: false, error: NOT_SAVED };
    if (!user) return { ok: false, error: NOT_SIGNED_IN };

    const existing = (user.user_metadata ?? {}) as Record<string, unknown>;
    const next = change(parseHubProgress(existing));
    const { error } = await supabase.auth.updateUser({ data: { ...existing, lectual_hub: buildHubMeta(next) } });
    if (error) return { ok: false, error: NOT_SAVED };
    return { ok: true };
  } catch {
    return { ok: false, error: NOT_SAVED };
  }
}

/** Records a finished flow. Only a known flow id and the status "done" are accepted. */
export async function markHubFlowAction(flowId: unknown, status: unknown): Promise<HubSaveResult> {
  if (status !== "done" || !isHubFlowId(flowId)) return { ok: false, error: NOT_SAVED };
  return saveProgress((current) => markFlowDone(current, flowId));
}

/** Empties the finished list and brings the Today card back. */
export async function resetHubProgressAction(): Promise<HubSaveResult> {
  return saveProgress(() => resetProgress());
}

/** The Today card's Hide. */
export async function hideHubCardAction(): Promise<HubSaveResult> {
  return saveProgress((current) => hideCard(current));
}

export type HubRecordPicks = { lead: RecordPick; matter: RecordPick };

const UNAVAILABLE: HubRecordPicks = { lead: { status: "unavailable" }, matter: { status: "unavailable" } };

/**
 * The first lead and the first matter this person can see, for the flow steps
 * that open a record. Read-only and through the session client, so RLS is what
 * keeps another firm's id out; the order is the lead and matter lists' own.
 * Each kind ends in one of three states, and a failed read is never "none".
 */
export async function pickHubRecordsAction(): Promise<HubRecordPicks> {
  try {
    const supabase = await getScopedClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return UNAVAILABLE;

    const [leads, matters] = await Promise.all([
      supabase.from("crm_lead").select("id").order("last_activity_at", { ascending: false, nullsFirst: false }).limit(1),
      supabase.from("crm_matter").select("id").order("created_at", { ascending: false }).limit(1),
    ]);
    const pick = (read: { data: { id: string }[] | null; error: unknown }): RecordPick => {
      if (read.error) return { status: "unavailable" };
      const id = read.data?.[0]?.id;
      return id ? { status: "ok", id } : { status: "none" };
    };
    return { lead: pick(leads), matter: pick(matters) };
  } catch {
    return UNAVAILABLE;
  }
}
