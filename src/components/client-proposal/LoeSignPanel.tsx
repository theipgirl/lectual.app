import { SIGN_AGREE_LABEL, SIGN_HEADING, SIGN_NAME_LABEL, SIGN_RECORDING_NOTICE } from "@/lib/loe/client-words";
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
}: {
  typedName: string;
  onName: (v: string) => void;
  agree: boolean;
  onAgree: (v: boolean) => void;
  readOnly?: boolean;
}) {
  return (
    <section className="cp-sign" aria-labelledby="cp-sign-h">
      <h3 id="cp-sign-h">{SIGN_HEADING}</h3>
      <label className="cp-field cp-field-wide">
        <span>{SIGN_NAME_LABEL}</span>
        <input
          type="text"
          name="typed_name"
          value={typedName}
          maxLength={MAX_CLIENT_TEXT_CHARS}
          autoComplete="name"
          readOnly={readOnly}
          onChange={(e) => onName(e.target.value)}
        />
      </label>
      <label className="cp-opt cp-agree">
        <input type="checkbox" checked={agree} disabled={readOnly} onChange={(e) => onAgree(e.target.checked)} />
        <span className="cp-box" aria-hidden="true" />
        <span>{SIGN_AGREE_LABEL}</span>
      </label>
      <p className="cp-recording">{SIGN_RECORDING_NOTICE}</p>
    </section>
  );
}
