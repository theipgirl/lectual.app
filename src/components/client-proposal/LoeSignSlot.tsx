import { ESIGN_PAUSED_SENTENCE } from "@/lib/loe/client-words";
import { LoeSignPanel } from "./LoeSignPanel";
import type { AdobeSigning } from "./adobe-flow";
import type { LoeFlow } from "./loe-flow";

/**
 * Step 3's signing controls for either path. On the in-app path (no Adobe path given, or a fallback on this visit) it is exactly
 * the in-app `LoeSignPanel` (plus, after a fallback, the one fixed sentence saying why). On the Adobe path: the typed name only.
 * Paused: one sentence, no form.
 */
export function LoeSignSlot({ adobe, loeFlow }: { adobe: AdobeSigning; loeFlow: LoeFlow }) {
  return (
    <>
      {adobe.notice ? (
        <p className="cp-warn" role="status">
          {adobe.notice}
        </p>
      ) : null}
      {adobe.paused ? (
        <p className="cp-warn" role="status">
          {ESIGN_PAUSED_SENTENCE}
        </p>
      ) : (
        <LoeSignPanel
          typedName={loeFlow.typedName}
          onName={loeFlow.setTypedName}
          agree={loeFlow.agree}
          onAgree={loeFlow.setAgree}
          {...(adobe.active ? { adobe: true } : {})}
        />
      )}
    </>
  );
}
