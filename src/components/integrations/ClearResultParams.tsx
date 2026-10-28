"use client";

import { useEffect } from "react";
import { urlWithoutResultParams } from "@/lib/integrations/clear-params";

/**
 * After the first paint, takes `?connected=` / `?reconnected=` / `?error=` out of the address bar so a refresh
 * or a shared link does not replay the banner. It rewrites the URL in place (history.replaceState), so the
 * banner already on the page stays until the person leaves it. Draws nothing.
 */
export function ClearResultParams() {
  useEffect(() => {
    const next = urlWithoutResultParams(window.location.pathname, window.location.search);
    if (next) window.history.replaceState(window.history.state, "", next);
  }, []);
  return null;
}
