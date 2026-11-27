"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Notice, type NoticeTone } from "@/components/ui/Notice";
import { APPROVED_TEXT_LABEL } from "@/lib/ui/words";

/**
 * Holds what the top card just said ("Approved. The draft is in ...") above the card. A Yes, Not this or Send back
 * revalidates the page, which can swap the card for the next one (and unmount the one that was clicked), so the
 * sentence the action returned lives here, in the one component that stays. It shows only what an action returned.
 */
export type StepNotice = {
  tone: NoticeTone;
  message: string;
  href?: string | null;
  hrefLabel?: string;
  /** The approved text, when an approval's draft failed or may have failed (shown to copy). */
  text?: string;
};
type Say = (n: StepNotice) => void;

const SayContext = createContext<Say | null>(null);

/** The notice setter, or null when a card is drawn outside the frame (the card then shows the sentence itself). */
export const useStepSay = (): Say | null => useContext(SayContext);

export function TopCardFrame({ children, initial = null }: { children: ReactNode; initial?: StepNotice | null }) {
  const [notice, setNotice] = useState<StepNotice | null>(initial);
  const say = useCallback<Say>((n) => setNotice(n), []);
  const value = useMemo(() => say, [say]);
  return (
    <SayContext.Provider value={value}>
      {notice && (
        <Notice tone={notice.tone} role={notice.tone === "risk" || notice.tone === "warn" ? "alert" : "status"}>
          {notice.message}
          {notice.href ? (
            <>
              {" "}
              <a className="lx-link" href={notice.href} {...(/^https:/i.test(notice.href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                {notice.hrefLabel}
              </a>
            </>
          ) : null}
          {notice.text ? (
            <>
              <span className="lx-note"> {APPROVED_TEXT_LABEL}</span>
              <pre className="lx-handed-text" style={{ whiteSpace: "pre-wrap" }}>
                {notice.text}
              </pre>
            </>
          ) : null}
        </Notice>
      )}
      {children}
    </SayContext.Provider>
  );
}
