"use client";

import { useState } from "react";
import { checkSignerFields, cleanTypedName, fingerprintOf, type SignerDetails } from "@/lib/loe/signing";
import { ADOBE_SIGN_LABEL, ADOBE_SIGN_PENDING, ADOBE_SIGN_REQUIRED_NOTE, SIGN_MESSAGES } from "@/lib/loe/client-words";
import type { ClientClassInput } from "@/lib/proposals/client-classes";
import type { Selection } from "@/lib/proposals/types";
import type { LoeFlow } from "./loe-flow";

/**
 * Step 3 on the Adobe Acrobat Sign path (Sprint 5a, contract item 8). The page passes the path the SERVER chose
 * (`signingPathFor`); absent means the in-app signature (0106) and nothing here draws anything.
 *
 *  - `adobe` / `resume`: the client types their name (no tick: Adobe's signature act replaces it, D19) and presses
 *    "Continue to Adobe to sign". The browser then goes to Adobe's page TOP-LEVEL (never an iframe). The URL is never stored.
 *  - `paused`: the firm's Adobe connection needs attention while a letter is open: a sentence, no form, no button.
 *  - A failure on THIS visit (`fallback: "in_app"`) turns this page into the in-app form, with the typed name and details kept
 *    and the tick shown. Client state only: nothing is stored and a reload chooses the path again (D1).
 */

export type AdobeSigningPath = "adobe" | "resume" | "paused";

export type AdobeStartResult = { ok: true; url: string } | { ok: false; fallback?: "in_app"; message: string };

export type AdobeStart = (selection: Selection, clientClasses: ClientClassInput, details: SignerDetails, typedName: string, fingerprint: string) => Promise<AdobeStartResult>;

/** What the page does with the action's answer. Pure. */
export type AdobeOutcome = { navigate: string } | { fallback: string } | { error: string };

export function adobeStartOutcome(result: AdobeStartResult | null | undefined): AdobeOutcome {
  if (!result) return { error: SIGN_MESSAGES.generic };
  if (result.ok) return typeof result.url === "string" && result.url ? { navigate: result.url } : { error: SIGN_MESSAGES.generic };
  if (result.fallback === "in_app") return { fallback: result.message };
  return { error: result.message };
}

export function useAdobeSigning(input: {
  path: AdobeSigningPath | undefined;
  onStart: AdobeStart | undefined;
  loeFlow: LoeFlow;
  selection: Selection;
  clientClasses: ClientClassInput;
  /** Top-level navigation (injected for tests). */
  navigate?: (url: string) => void;
}) {
  const [fellBack, setFellBack] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = fellBack ? undefined : input.path;
  const active = (path === "adobe" || path === "resume") && typeof input.onStart === "function";
  const paused = path === "paused";
  const fields = checkSignerFields({ typedName: input.loeFlow.typedName, details: input.loeFlow.cleaned });
  const canStart = active && input.loeFlow.agreement !== null && fields.ok;

  async function start() {
    if (!active || !canStart || pending || !input.onStart || !input.loeFlow.agreement) return;
    setError(null);
    setPending(true);
    let keepPending = false;
    try {
      const fingerprint = await fingerprintOf(input.loeFlow.agreement);
      const outcome = adobeStartOutcome(
        await input.onStart(input.selection, input.clientClasses, input.loeFlow.cleaned, cleanTypedName(input.loeFlow.typedName), fingerprint),
      );
      if ("navigate" in outcome) {
        keepPending = true;
        (input.navigate ?? ((url: string) => window.location.assign(url)))(outcome.navigate);
      } else if ("fallback" in outcome) {
        setFellBack(true);
        setNotice(outcome.fallback);
      } else {
        setError(outcome.error);
      }
    } catch {
      setError(SIGN_MESSAGES.generic);
    } finally {
      if (!keepPending) setPending(false);
    }
  }

  return { active, paused, fellBack, notice, pending, error, canStart, start };
}

export type AdobeSigning = ReturnType<typeof useAdobeSigning>;

/**
 * The totals panel's step-3 props on the Adobe path, spread AFTER the in-app props. On the in-app path it is `{}`, so the panel
 * is drawn exactly as before.
 */
export function adobeSideProps(a: AdobeSigning): Partial<import("./LoeSideAction").LoeSideActionProps> {
  if (a.paused) return { hideSign: true };
  if (!a.active) return {};
  return {
    signLabel: ADOBE_SIGN_LABEL,
    pendingLabel: ADOBE_SIGN_PENDING,
    signNeedNote: ADOBE_SIGN_REQUIRED_NOTE,
    signable: a.canStart,
    pending: a.pending,
    onSign: () => void a.start(),
    ...(a.error ? { error: a.error } : {}),
  };
}
