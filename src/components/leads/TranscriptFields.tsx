import { ACCEPTED_TRANSCRIPT_TYPES } from "@/lib/consult-proposal/upload";

/**
 * The two ways to hand the consult agent a transcript: paste it, or upload a
 * .txt, .vtt, .srt or .docx. Shared by the lead page and the proposals page so
 * both offer the same thing. The file wins when both are given; neither is stored.
 */
export function TranscriptFields({ maxChars, disabled }: { maxChars: number; disabled: boolean }) {
  return (
    <>
      <label className="lx-field">
        <span className="lx-label">Consult transcript</span>
        <textarea
          className="lx-input"
          name="transcript"
          rows={8}
          maxLength={maxChars}
          spellCheck={false}
          placeholder="Paste what was said on the call. Speaker names help."
          disabled={disabled}
        />
      </label>
      <label className="lx-field">
        <span className="lx-label">Or upload the transcript ({ACCEPTED_TRANSCRIPT_TYPES})</span>
        <input className="lx-input" type="file" name="file" accept=".txt,.vtt,.srt,.docx" disabled={disabled} />
      </label>
      <p className="lx-note" style={{ margin: 0 }}>
        The agent drafts the proposal from what was recommended on the call, at the firm&apos;s standard prices, and writes the email with its link. The
        transcript and any file are not saved: only the short quotes it relied on are kept on the proposal. Nothing is sent.
      </p>
    </>
  );
}
