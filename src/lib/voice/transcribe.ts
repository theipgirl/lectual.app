import "server-only";
import { env } from "@/lib/env";

export type TranscriptResult =
  | { status: "done"; text: string }
  | { status: "skipped" }
  | { status: "failed" };

const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";

/**
 * Best-effort speech-to-text for a voice note. Whisper via the OpenAI REST API
 * — the one capability the Anthropic-routed gateway doesn't cover. Optional by
 * design: without OPENAI_API_KEY the note simply saves without a transcript
 * ('skipped'), and an API failure degrades the same way ('failed') rather than
 * blocking the save. The caller records the status in the activity payload so
 * the timeline never implies a transcript exists when it doesn't.
 */
export async function transcribeAudio(
  bytes: Uint8Array,
  mime: string,
  filename: string,
): Promise<TranscriptResult> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return { status: "skipped" };

  try {
    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("file", new Blob([bytes as BlobPart], { type: mime }), filename);

    const res = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      console.error(`[voice-note] transcription HTTP ${res.status}: ${await res.text()}`);
      return { status: "failed" };
    }

    const json = (await res.json()) as { text?: unknown };
    const text = typeof json.text === "string" ? json.text.trim() : "";
    return text ? { status: "done", text } : { status: "failed" };
  } catch (err) {
    console.error("[voice-note] transcription failed", err);
    return { status: "failed" };
  }
}
