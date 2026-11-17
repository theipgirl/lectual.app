import { Notice } from "@/components/ui/Notice";

/**
 * The file picker. CSV only: Excel workbooks are refused with a sentence on the server too, so the
 * `accept` hint is a courtesy and not the check.
 */
export function UploadPanel({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onSubmit?: (form: HTMLFormElement) => void;
}) {
  return (
    <section className="lx-card rc-panel" aria-label="Upload the sheet">
      <form
        className="rc-file"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.(e.currentTarget);
        }}
      >
        <div className="lx-field">
          <label className="lx-label" htmlFor="reconcile-sheet">
            Intake sheet (CSV, up to 5 MB)
          </label>
          <input id="reconcile-sheet" className="lx-input" name="sheet" type="file" accept=".csv,text/csv" required />
        </div>
        <button type="submit" className="lx-btn lx-btn-pri" disabled={busy}>
          {busy ? "Reading the sheet" : "Compare with the app"}
        </button>
      </form>
      <p className="lx-note">Reading changes nothing. You choose what to move on the next screen.</p>
      {error ? (
        <Notice tone="risk" role="alert">
          {error}
        </Notice>
      ) : null}
    </section>
  );
}
