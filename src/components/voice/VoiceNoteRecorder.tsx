"use client";

import { useEffect, useRef, useState, useTransition } from "react";
// Ported from lectual src/components/firm/VoiceNoteRecorder.tsx: recording
// logic unchanged, restyled onto the lx tokens.

function MicIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function StopIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

/** Keep in sync with VOICE_NOTE_MAX_SECONDS (src/lib/voice/notes.ts). */
const MAX_SECONDS = 600;

export type VoiceNoteActionState = { error?: string };
export type VoiceNoteAction = (
  prev: VoiceNoteActionState,
  formData: FormData,
) => Promise<VoiceNoteActionState>;

/** Which record the note hangs off. `kind` also picks the form field name. */
export type VoiceNoteTargetProp = { kind: "lead" | "matter"; id: string };

/**
 * First MediaRecorder container the current browser supports, in preference
 * order. Chrome/Firefox/Edge record webm+opus; Safari records mp4 (AAC). Both
 * are in the voice-notes bucket's allowed_mime_types.
 */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const candidate of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return undefined;
}

function formatClock(totalSeconds: number): string {
  const whole = Math.floor(totalSeconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const ghostButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  background: "var(--well)",
  color: "var(--body)",
  borderRadius: 999,
  padding: "8px 16px",
  fontWeight: 600,
  fontSize: 13,
  border: "1px solid var(--line)",
  cursor: "pointer",
};

type Phase = "idle" | "recording" | "recorded" | "unsupported" | "denied";

/**
 * In-browser voice-note recorder. Record → review → save; the blob goes to the
 * server action supplied by the route as ordinary form data.
 *
 * The action is a **prop** rather than an import because this component serves
 * both the lead and the matter timelines, and each route owns its own action
 * and role gate. A shared component cannot reach into `../actions`.
 *
 * The microphone stream is stopped the moment recording ends — never held open
 * — and nothing leaves the browser until the person explicitly saves. The
 * recording is kept in memory until the server confirms, so a failed save
 * returns to the review state with the audio intact rather than eating a
 * five-minute memo.
 */
export default function VoiceNoteRecorder({
  target,
  action,
}: {
  target: VoiceNoteTargetProp;
  action: VoiceNoteAction;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(0);
  // Mirrors `previewUrl` so the unmount cleanup can revoke the current URL
  // without taking previewUrl as a dependency — see the cleanup effect.
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  // True unmount cleanup: empty deps, reading the URL through a ref.
  //
  // Both details matter. With `[previewUrl]` deps this would re-run on every
  // recording rather than only on unmount. And `onstop` must be detached
  // BEFORE the tracks are stopped: stopping tracks makes the stream inactive,
  // which fires `stop` on the recorder, and the handler would then call
  // createObjectURL + setState on a component that no longer exists — leaking
  // a blob URL nothing will ever revoke.
  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state !== "inactive") recorder.stop();
        recorder.stream.getTracks().forEach((t) => t.stop());
        recorderRef.current = null;
      }
      if (timerRef.current) clearInterval(timerRef.current);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  async function startRecording() {
    const mimeType = pickMimeType();
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
      setPhase("unsupported");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setPhase("denied");
      return;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch {
      // Never leave the mic hot: without this the browser's recording
      // indicator stays lit with no UI left to turn it off.
      stream.getTracks().forEach((t) => t.stop());
      setPhase("unsupported");
      return;
    }

    recorderRef.current = recorder;
    chunksRef.current = [];
    secondsRef.current = 0;
    setSeconds(0);
    setError(null);

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const recorded = new Blob(chunksRef.current, { type: mimeType });
      setBlob(recorded);
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(recorded);
      });
      setPhase("recorded");
    };

    recorder.start(1000);
    setPhase("recording");
    timerRef.current = setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
      if (secondsRef.current >= MAX_SECONDS) stopRecording();
    }, 1000);
  }

  function stopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function discard() {
    setBlob(null);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    secondsRef.current = 0;
    setSeconds(0);
    setPhase("idle");
  }

  function save() {
    if (!blob) return;
    const mime = blob.type.split(";")[0] || "audio/webm";
    const ext = mime === "audio/mp4" ? "m4a" : (mime.split("/")[1] ?? "webm");
    const fd = new FormData();
    fd.set(target.kind === "lead" ? "leadId" : "matterId", target.id);
    fd.set("durationSeconds", String(secondsRef.current));
    fd.set("audio", new File([blob], `voice-note.${ext}`, { type: blob.type }));
    setError(null);
    startTransition(async () => {
      // Success clears the local copy and returns to idle (the page
      // revalidates and the note appears on the timeline). Failure keeps the
      // recording in the review state so nothing is lost to a network blip.
      const result = await action({}, fd);
      if (result.error) setError(result.error);
      else discard();
    });
  }

  const noun = target.kind === "lead" ? "client" : "matter";

  return (
    <section className="lx-voice" style={{ display: "grid", gap: 10 }} aria-label="Voice note">
      <div className="lx-label">Voice note</div>

      {phase === "unsupported" && (
        <p role="alert" style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
          This browser can&rsquo;t record audio — try Chrome, Edge, Firefox, or Safari.
        </p>
      )}
      {phase === "denied" && (
        <p role="alert" style={{ fontSize: 12, color: "var(--wine)", margin: 0 }}>
          Microphone access was blocked. Allow it in your browser&rsquo;s site settings, then try
          again.
        </p>
      )}

      {phase !== "recording" && phase !== "recorded" && (
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
        >
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            Record a quick update on this {noun} — saved to the timeline, never sent.
          </span>
          <button
            type="button"
            className="lx-btn lx-btn-sec lx-btn-sm"
            onClick={startRecording}
            disabled={pending}
          >
            <MicIcon size={15} />
            Record
          </button>
        </div>
      )}

      {phase === "recording" && (
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
        >
          {/* Announces the phase change, not each tick — a per-second live
              region would read the clock aloud sixty times a minute. */}
          <span
            role="status"
            className="lx-num"
            style={{ fontSize: 13, color: "var(--wine)" }}
          >
            Recording {formatClock(seconds)} / {formatClock(MAX_SECONDS)}
          </span>
          <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={stopRecording} disabled={pending}>
            <StopIcon size={15} />
            Stop
          </button>
        </div>
      )}

      {phase === "recorded" && blob && previewUrl && (
        <div style={{ display: "grid", gap: 10 }}>
          <audio
            controls
            src={previewUrl}
            aria-label={`Unsaved voice note, ${formatClock(seconds)}`}
            style={{ width: "100%", height: 36 }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {formatClock(seconds)} recorded. Listen back, then save or discard.
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={ghostButtonStyle} onClick={discard} disabled={pending}>
                Discard
              </button>
              <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save to timeline"}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" style={{ fontSize: 12, color: "var(--wine)", margin: 0 }}>
          {error}
        </p>
      )}
    </section>
  );
}
