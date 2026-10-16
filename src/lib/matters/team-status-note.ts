import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
import { requireMatterWriteRole } from "./matters";

/**
 * The "what did we say last time" reference (crm_team_status_note, 0044).
 * Deliberately the smallest possible thing: one row per firm per week
 * (Monday-keyed), a free-text note and an optional link — not a meeting-
 * notes system. See the migration header for the full reasoning.
 */
export type TeamStatusNote = Database["public"]["Tables"]["crm_team_status_note"]["Row"];

/** Fetches the note for one week (YYYY-MM-DD, a Monday), or null if none was ever saved. */
export async function getTeamStatusNote(weekStart: string): Promise<TeamStatusNote | null> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_team_status_note")
    .select("*")
    .eq("week_start", weekStart)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Fetches notes for several weeks in one round trip (the page wants "this
 * week" + "last week" together), keyed by week_start for easy lookup.
 */
export async function getTeamStatusNotes(weekStarts: string[]): Promise<Map<string, TeamStatusNote>> {
  if (weekStarts.length === 0) return new Map();
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_team_status_note")
    .select("*")
    .in("week_start", weekStarts);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.week_start, row]));
}

export type SaveTeamStatusNoteInput = {
  weekStart: string;
  note: string | null;
  linkUrl: string | null;
};

/**
 * Upserts this week's note. Staff-role-gated (MATTER_WRITE_ROLES — same set
 * as every other matters-lib write); RLS's unique (org_id, week_start) plus
 * the staff-write policy is the real boundary, this is the friendly refusal.
 * updated_by is read from the caller's own session, never from the form.
 */
export async function saveTeamStatusNote(input: SaveTeamStatusNoteInput): Promise<TeamStatusNote> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  const { data: orgId, error: orgError } = await supabase.rpc("current_org_id");
  if (orgError) throw orgError;
  if (!orgId) throw new Error("No active organization for the current session.");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("crm_team_status_note")
    .upsert(
      {
        org_id: orgId,
        week_start: input.weekStart,
        note: input.note,
        link_url: input.linkUrl,
        updated_by: user?.id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,week_start" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
