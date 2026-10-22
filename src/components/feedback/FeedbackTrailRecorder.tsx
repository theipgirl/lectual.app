"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { loadTrail, recordError, recordRoute, saveTrail, withEnvironment, type Trail } from "@/lib/feedback/trail";

/** `https://host/_next/chunk.js?x=1` -> `https://host/_next/chunk.js:LINE`; never a query string. */
function sourceOf(file: string | undefined, line: number | undefined): string {
  const bare = (file ?? "").split("?")[0].split("#")[0];
  return bare ? `${bare}${line ? `:${line}` : ""}` : "";
}

/**
 * Keeps the trail Send feedback attaches: route paths, client errors, viewport, user agent, build. It
 * renders nothing and reads nothing but the router path, the error events and the window's size and
 * user agent; never page text, form values or records. See src/lib/feedback/trail.ts.
 */
export function FeedbackTrailRecorder() {
  const pathname = usePathname();
  const trail = useRef<Trail | null>(null);

  const update = (change: (t: Trail) => Trail) => {
    const base = trail.current ?? loadTrail(window.sessionStorage);
    const next = change(base);
    trail.current = next;
    saveTrail(window.sessionStorage, next);
  };

  useEffect(() => {
    if (!pathname) return;
    update((t) =>
      recordRoute(
        withEnvironment(t, {
          width: window.innerWidth,
          height: window.innerHeight,
          userAgent: navigator.userAgent,
          build: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? null,
        }),
        pathname,
        new Date().toISOString(),
      ),
    );
  }, [pathname]);

  useEffect(() => {
    const onError = (e: ErrorEvent) =>
      update((t) => recordError(t, { message: e.message, source: sourceOf(e.filename, e.lineno), at: new Date().toISOString() }));
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason: unknown = e.reason;
      const message = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "Unhandled promise rejection";
      update((t) => recordError(t, { message, source: "", at: new Date().toISOString() }));
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}

