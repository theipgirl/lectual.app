import { ADOBE_SIGN_NOTE, SIGN_AGREE_LABEL, SIGN_HEADING, SIGN_NAME_LABEL, SIGN_RECORDING_NOTICE } from "@/lib/loe/client-words";
import { MAX_CLIENT_TEXT_CHARS } from "@/lib/proposals/client-classes";

/**
 * Step 3's signing controls: the typed full legal name, the agreement tick and the recording notice. The button that signs is
 * the totals panel's own button (it changes with the step), disabled until both are given.
 */
export function LoeSignPanel({
  typedName,
  onName,
  agree,
  onAgree,
  readOnly,
  adobe,
}: {
  typedName: string;
  onName: (v: string) => void;
  agree: boolean;
  onAgree: (v: boolean) => void;
  readOnly?: boolean;
  /** Sprint 5a: the Adobe Acrobat Sign path. The typed name only: no tick (Adobe's signature replaces it) and no in-app recording notice. */
  adobe?: boolean;
}) {
  return (
    <section className="cp-sign" aria-labelledby="cp-sign-h">
      <h3 id="cp-sign-h">{SIGN_HEADING}</h3>
      <label className="cp-field cp-field-wide">
        <span>
          {SIGN_NAME_LABEL}
          <b aria-hidden="true"> *</b>
        </span>
        <input
          type="text"
          name="typed_name"
          value={typedName}
          maxLength={MAX_CLIENT_TEXT_CHARS}
          autoComplete="name"
          required
          aria-required={true}
          readOnly={readOnly}
          onChange={(e) => onName(e.target.value)}
        />
      </label>
      {adobe ? (
        <p className="cp-recording">{ADOBE_SIGN_NOTE}</p>
      ) : (
        <>
          <label className="cp-opt cp-agree">
            <input type="checkbox" name="agree" checked={agree} disabled={readOnly} required aria-required={true} onChange={(e) => onAgree(e.target.checked)} />
            <span className="cp-box" aria-hidden="true" />
            <span>
              {SIGN_AGREE_LABEL}
              <b aria-hidden="true"> *</b>
            </span>
          </label>
          <p className="cp-recording">{SIGN_RECORDING_NOTICE}</p>
        </>
      )}
    </section>
  );
}
