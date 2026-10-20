import { MAX_PASTED_TRANSCRIPT_CHARS, MIN_TRANSCRIPT_CHARS } from "./types";
import { MAX_TRANSCRIPT_FILE_BYTES, transcriptFromUpload } from "./upload";

/**
 * The transcript text out of a "Draft from a transcript" form: an uploaded
 * `file` if one was chosen (it wins), else the pasted `transcript` box. The one
 * implementation behind both the lead page and the proposals page, so a rule
 * (the 200-character minimum, the size limit) cannot differ between them.
 * Nothing here stores the text.
 */

export type FormTranscript = { ok: true; text: string } | { ok: false; error: string };

export async function transcriptTextFromForm(formData: FormData): Promise<FormTranscript> {
  const file = formData.get("file");
  if (typeof file === "object" && file !== null && "arrayBuffer" in file && file.size > 0) {
    if (file.size > MAX_TRANSCRIPT_FILE_BYTES) {
      return { ok: false, error: `That file is too large. The most that can be uploaded is ${Math.round(MAX_TRANSCRIPT_FILE_BYTES / 1_000_000)} MB; paste the text instead.` };
    }
    const read = await transcriptFromUpload(file.name, new Uint8Array(await file.arrayBuffer()));
    if (!read.ok) return read;
    if (read.text.length < MIN_TRANSCRIPT_CHARS) return { ok: false, error: "That file has too little text to draft from (at least a few sentences)." };
    return read;
  }

  const raw = formData.get("transcript");
  const text = typeof raw === "string" ? raw.replace(/\0/g, "").trim() : "";
  if (text.length < MIN_TRANSCRIPT_CHARS) return { ok: false, error: "Paste the call's transcript first (at least a few sentences), or upload a file." };
  if (text.length > MAX_PASTED_TRANSCRIPT_CHARS) {
    return { ok: false, error: `That transcript is too long. The most that can be pasted is ${MAX_PASTED_TRANSCRIPT_CHARS.toLocaleString("en-US")} characters.` };
  }
  return { ok: true, text };
}
