import { ALLOWED_TYPES_TEXT, FILE_PICKER_ACCEPT, MAX_FILE_LABEL } from "@/lib/files/rules";

/**
 * What the upload control draws, with no state of its own so it renders (and is
 * checked) without a browser: idle, busy and a plain error sentence. The
 * behaviour is in UploadControl.
 */
export function UploadView({
  busy,
  busyName,
  error,
  onPick,
  inputKey,
}: {
  busy: boolean;
  busyName?: string | null;
  error: string | null;
  onPick?: (file: File | null) => void;
  inputKey?: number;
}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label className="lx-label" htmlFor="client-file-input">
        Add a file
      </label>
      <input
        key={inputKey}
        id="client-file-input"
        className="lx-input"
        type="file"
        accept={FILE_PICKER_ACCEPT}
        disabled={busy}
        onChange={onPick ? (e) => onPick(e.currentTarget.files?.[0] ?? null) : undefined}
      />
      <p className="lx-note" style={{ margin: 0 }}>
        {`Allowed: ${ALLOWED_TYPES_TEXT}. Up to ${MAX_FILE_LABEL} each.`}
      </p>
      {busy && (
        <p role="status" className="lx-note" style={{ margin: 0, color: "var(--ink)" }}>
          {busyName ? `Uploading ${busyName}…` : "Uploading…"}
        </p>
      )}
      {error && (
        <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
