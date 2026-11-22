"use client";

import { useState, useTransition } from "react";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { disconnectAdobeAction } from "@/app/dashboard/settings/integrations/actions";
import { ADOBE_CONNECT, ADOBE_DISCONNECT, ADOBE_DISCONNECT_QUESTION, ADOBE_RECONNECT, SWITCH_ON_WORDS } from "@/lib/ui/words";

/**
 * The Adobe Acrobat Sign row's buttons. Connect / Reconnect is a plain link to the OAuth route (which checks the admin tier
 * itself); Disconnect asks first (InlineConfirm) and shows the action's own fixed sentences.
 */
export function AdobeSignActions({ connect, disconnect }: { connect: "connect" | "reconnect" | "disabled" | null; disconnect: boolean }) {
  const [pending, start] = useTransition();
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {connect === "connect" || connect === "reconnect" ? (
        <a href="/api/esign/connect/" className="lx-btn lx-btn-pri">
          {connect === "connect" ? ADOBE_CONNECT : ADOBE_RECONNECT}
        </a>
      ) : null}
      {connect === "disabled" ? (
        <span className="lx-btn lx-btn-sec" aria-disabled="true" aria-describedby="switch-on-adobe" style={{ opacity: 0.55, cursor: "not-allowed" }}>
          {ADOBE_CONNECT}
          <span id="switch-on-adobe" className="lx-sr">
            {SWITCH_ON_WORDS}
          </span>
        </span>
      ) : null}
      {disconnect ? (
        <InlineConfirm
          label={ADOBE_DISCONNECT}
          question={ADOBE_DISCONNECT_QUESTION}
          pending={pending}
          onConfirm={() =>
            start(async () => {
              const r = await disconnectAdobeAction();
              setError(r.error ?? null);
              setLines(r.lines ?? []);
            })
          }
        />
      ) : null}
      {error ? (
        <span role="alert" className="lx-note">
          {error}
        </span>
      ) : null}
      {lines.map((l) => (
        <span key={l} role="status" className="lx-note">
          {l}
        </span>
      ))}
    </>
  );
}
