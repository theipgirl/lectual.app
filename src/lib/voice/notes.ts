import { getScopedClient } from "@/lib/db/scoped-client";
import type { Role } from "@/lib/auth/roles";
import { logActivity, type Activity } from "@/lib/matters";
import { CAN_WRITE_LEAD, resolveCurrentRole } from "@/lib/pipeline/leads";
import { LeadWriteError, forbiddenLeadWrite } from "@/lib/pipeline/errors";
import { transcribeAudio } from "./transcribe";

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

export const VOICE_NOTES_BUCKET = "voice-notes";

/** Mirrors the bucket's allowed_mime_types (supabase/migrations/0036_voice_notes.sql). */
export const VOICE_NOTE_MIME_EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
};

/** Mirrors the bucket's 8 MB file_size_limit, minus form overhead headroom. */
export const VOICE_NOTE_MAX_BYTES = 7 * 1024 * 1024;
/** The recorder auto-stops here; anything longer arrives truncated, never rejected late. */
export const VOICE_NOTE_MAX_SECONDS = 600;

export type AddVoiceNoteInput = {
  bytes: Uint8Array;
  mime: string;
  durationSeconds: number;
};

/**
 * Which record a voice note hangs off. Mirrors `LogActivityInput`'s shape
 * (src/lib/matters/activity.ts) so the two stay readable side by side, and
 * carries the same "at least one" rule.
 */
export type VoiceNoteTarget = { leadId?: string; matterId?: string };

/**
 * Same per-call role resolution as addLeadNote (src/lib/pipeline/notes.ts):
 * `current_org_role()` every time, never cached. The real boundaries are
 * crm_activity_insert_staff and the voice_notes_insert_staff storage policy
 * (0036) — this check exists so a refusal is a sentence, not a Postgres error.
 *
 * One list serves both targets on purpose: MATTER_WRITE_ROLES
 * (src/lib/matters/matters.ts) is element-for-element identical to
 * CAN_WRITE_LEAD, and both match the role list written into the 0036 storage
 * policy. Only the refusal wording differs, so that a matter refusal doesn't
 * tell the reader they can't write to a lead.
 */
async function requireVoiceNoteRole(supabase: ScopedClient, noun: string): Promise<Role> {
  const role = await resolveCurrentRole(supabase);
  if (!CAN_WRITE_LEAD.includes(role)) {
    throw forbiddenLeadWrite(role, `add voice notes to a ${noun}`);
  }
  return role;
}

/**
 * Records a voice note onto a lead's or a matter's timeline: uploads the audio
 * to the private 'voice-notes' bucket at
 * `{org_id}/{lead_id|matter_id}/{note_id}.{ext}`, transcribes it best-effort,
 * then appends a 'voice_note' crm_activity row whose payload carries the
 * storage path, duration and transcript status.
 *
 * **The org id is the FIRST path segment, and that is the whole storage RLS
 * predicate** (`(storage.foldername(name))[1] = current_org_id()`, migration
 * 0036). The middle segment is free-form, which is why hanging notes off
 * matters as well as leads needed no migration and no new policy.
 *
 * Ordering matters: upload first, activity row second — the append-only
 * timeline must never reference audio that failed to land. If the activity
 * insert fails after a successful upload, the orphaned object is removed
 * best-effort before the error surfaces, so storage doesn't accumulate audio
 * no timeline row points at.
 *
 * Nothing is sent anywhere. A voice note is an internal team memo on the
 * client record — it never reaches the client.
 */
export async function addVoiceNote(
  target: VoiceNoteTarget,
  input: AddVoiceNoteInput,
): Promise<void> {
  const { leadId, matterId } = target;
  if (!leadId && !matterId) throw new LeadWriteError("Missing lead or matter.");

  const ext = VOICE_NOTE_MIME_EXT[input.mime];
  if (!ext) throw new LeadWriteError("That audio format isn't supported.");
  if (input.bytes.byteLength === 0) throw new LeadWriteError("The recording is empty.");
  if (input.bytes.byteLength > VOICE_NOTE_MAX_BYTES) {
    throw new LeadWriteError("That recording is too large — keep voice notes under 10 minutes.");
  }
  const durationSeconds = Math.round(input.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1) {
    throw new LeadWriteError("The recording is too short to save.");
  }
  if (durationSeconds > VOICE_NOTE_MAX_SECONDS + 5) {
    throw new LeadWriteError("Keep voice notes under 10 minutes.");
  }

  const supabase = await getScopedClient();
  await requireVoiceNoteRole(supabase, leadId ? "lead" : "matter");

  // org_id is read off the parent row (a scoped read — RLS already limits it
  // to the caller's own org), never taken from the caller: the storage path's
  // org prefix must match the parent's real org or the table RLS and the
  // storage RLS would be keyed on different tenants. Same lead-then-matter
  // branch logActivity uses, for the same reason.
  const parent = leadId
    ? await supabase.from("crm_lead").select("org_id").eq("id", leadId).single()
    : await supabase.from("crm_matter").select("org_id").eq("id", matterId!).single();
  if (parent.error) throw parent.error;

  const noteId = crypto.randomUUID();
  const storagePath = `${parent.data.org_id}/${leadId ?? matterId}/${noteId}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(VOICE_NOTES_BUCKET)
    .upload(storagePath, input.bytes, { contentType: input.mime });
  if (uploadError) throw uploadError;

  const transcript = await transcribeAudio(input.bytes, input.mime, `note.${ext}`);

  try {
    await logActivity({
      type: "voice_note",
      leadId,
      matterId,
      actorType: "user",
      payload: {
        storage_path: storagePath,
        mime: input.mime,
        size_bytes: input.bytes.byteLength,
        duration_seconds: durationSeconds,
        transcript_status: transcript.status,
        ...(transcript.status === "done" ? { transcript: transcript.text } : {}),
      },
    });
  } catch (err) {
    await supabase.storage
      .from(VOICE_NOTES_BUCKET)
      .remove([storagePath])
      .catch((cleanupErr: unknown) =>
        console.error(`[voice-note] orphan cleanup failed for ${storagePath}`, cleanupErr),
      );
    throw err;
  }
}

const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Mints playback URLs for the voice notes in an activity feed — a map of
 * activity id → short-lived signed URL. Minting goes through the caller's
 * scoped client, so the voice_notes_select_own storage policy is the gate: a
 * URL can only ever be produced for audio in the caller's own org. Rows whose
 * URL can't be minted (missing object, policy denial) are simply absent from
 * the map — the timeline shows the note without a player rather than erroring.
 */
export async function voiceNotePlaybackUrls(
  items: Pick<Activity, "id" | "type" | "payload">[],
): Promise<Record<string, string>> {
  const voiceItems = items.filter((i) => (i.type as string) === "voice_note");
  if (voiceItems.length === 0) return {};

  const supabase = await getScopedClient();
  const urls: Record<string, string> = {};

  await Promise.all(
    voiceItems.map(async (item) => {
      const payload = (item.payload ?? {}) as Record<string, unknown>;
      const path = typeof payload.storage_path === "string" ? payload.storage_path : null;
      if (!path) return;
      const { data, error } = await supabase.storage
        .from(VOICE_NOTES_BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (error || !data?.signedUrl) {
        console.error(`[voice-note] could not sign ${path}`, error);
        return;
      }
      urls[item.id] = data.signedUrl;
    }),
  );

  return urls;
}
