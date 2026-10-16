import { getScopedClient } from "@/lib/db/scoped-client";
import type { Role } from "@/lib/auth/roles";
import { logActivity } from "@/lib/matters";
import { CAN_WRITE_LEAD, resolveCurrentRole } from "./leads";
import { validateNote, type NoteKind } from "./lead-input";
import { LeadWriteError, forbiddenLeadWrite } from "./errors";
import { listMemberDirectory } from "@/lib/members/directory";
import { resolveMentions } from "@/lib/mentions/parse";
import { notify } from "@/lib/notifications";

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

/**
 * Same per-call role resolution as the other lead writes: `current_org_role()`
 * every time, never cached. crm_activity_insert_staff RLS is the real boundary;
 * this check exists so a refusal is a sentence rather than a Postgres error.
 */
async function requireNoteWriteRole(supabase: ScopedClient): Promise<Role> {
  const role = await resolveCurrentRole(supabase);
  if (!CAN_WRITE_LEAD.includes(role)) {
    throw forbiddenLeadWrite(role, "add notes to a lead");
  }
  return role;
}

export type AddLeadNoteInput = {
  /** 'note' | 'call_logged' | 'email_sent' — all pre-existing crm_activity_type values. */
  kind?: NoteKind | string | null;
  body?: string | null;
  /** Optional heading, used as the timeline summary for logged emails. */
  subject?: string | null;
};

/**
 * Writes a human-authored entry onto a lead's timeline.
 *
 * Unlike the audit rows attached to lead mutations, here the activity row IS
 * the mutation — so this calls `logActivity` directly (never logActivitySafe):
 * a failed insert must surface to the person who typed the note, not vanish
 * into a server log while the UI claims it saved.
 *
 * Nothing is sent anywhere. 'email_sent' / 'call_logged' record that a human
 * already did those things outside the product; the approval queue remains the
 * only path by which anything reaches a client.
 */
export async function addLeadNote(leadId: string, input: AddLeadNoteInput): Promise<void> {
  if (!leadId) throw new LeadWriteError("Missing lead.");

  const validated = validateNote({
    kind: typeof input.kind === "string" ? input.kind : "note",
    body: input.body,
    subject: input.subject,
  });
  if (!validated.ok) {
    const first = Object.values(validated.fieldErrors)[0] ?? "Check the note.";
    throw new LeadWriteError(first, { fieldErrors: validated.fieldErrors });
  }

  const supabase = await getScopedClient();
  await requireNoteWriteRole(supabase);

  const { kind, body, subject } = validated.value;

  // §13.2: @-mentions are a plain-note thing — a logged call or email records
  // something that already happened outside the product, not a message to a
  // teammate, so text there is never scanned for @names or paged on.
  // Resolution failure (directory RPC down, 0031 not applied) must never
  // block the note from saving, so it is swallowed here exactly the way
  // notify() swallows its own failures below.
  let mentionedUserIds: string[] = [];
  if (kind === "note") {
    try {
      const directory = await listMemberDirectory();
      mentionedUserIds = resolveMentions(body, directory).userIds;
    } catch (err) {
      console.warn(
        `[notes] could not resolve @mentions: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Payload keys match what summarizeActivity() in
  // src/components/firm/ActivityTimeline.tsx already reads per type, so these
  // entries render with a real one-line summary rather than a bare chip.
  const payload: Record<string, unknown> =
    kind === "call_logged"
      ? { summary: subject ?? body, notes: body }
      : kind === "email_sent"
        ? { subject: subject ?? body.slice(0, 120), body, logged_manually: true }
        : {
            note: body,
            ...(subject ? { subject } : {}),
            // Validated ids only, resolved above against the org's member
            // directory — never the raw "@Whoever" text a form could send.
            ...(mentionedUserIds.length ? { mentions: mentionedUserIds } : {}),
          };

  await logActivity({ type: kind, leadId, actorType: "user", payload });

  if (mentionedUserIds.length === 0) return;

  // The note has already saved — everything from here is best-effort. A
  // notification that fails to raise must never look like a failed save,
  // the same "never breaks the write path" rule notify() itself follows.
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;

    // logActivity has no RETURNING (it's the one shared insert helper every
    // activity writer uses, and none of them need their row's id back), so
    // the just-written row is looked up by its own shape instead of adding
    // one to thread an id through a helper nobody else needs it from.
    let activityId: string | null = null;
    if (actorId) {
      const { data: latest } = await supabase
        .from("crm_activity")
        .select("id")
        .eq("lead_id", leadId)
        .eq("type", "note")
        .eq("actor_id", actorId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      activityId = latest?.id ?? null;
    }

    // The lead's NAME is what §13.3's sentence quotes ("Dawn tagged you on
    // Mireille Toussaint"). Without it `subjectName` in
    // src/lib/notifications/sentences.ts falls through to `preview` and the
    // bell reads "tagged you on <the first words of the note>", which is the
    // wrong noun. Read through the scoped client, so a lead outside the
    // caller's org is simply absent and the sentence degrades to "a lead"
    // rather than carrying a name across the tenant boundary.
    let leadName: string | null = null;
    try {
      const { data: lead } = await supabase
        .from("crm_lead")
        .select("first_name, last_name, email")
        .eq("id", leadId)
        .maybeSingle();
      if (lead) {
        const full = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim();
        leadName = full || lead.email || null;
      }
    } catch {
      // best-effort: the sentence falls back to the preview.
    }

    const preview = body.slice(0, 120);
    for (const mentionedUserId of mentionedUserIds) {
      // notify() itself drops a self-mention (actorId === userId) and any
      // userId that isn't a member of the active org — both checked again
      // there against the same directory, so this loop does not repeat them.
      await notify({
        userId: mentionedUserId,
        kind: "mentioned",
        leadId,
        activityId,
        actorId,
        payload: { preview, ...(leadName ? { lead_name: leadName } : {}) },
      });
    }
  } catch (err) {
    console.warn(
      `[notes] could not raise @mention notifications: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
