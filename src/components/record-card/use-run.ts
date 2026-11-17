"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savedMark, type SavedMark } from "@/lib/record-card/rules";

/**
 * Runs one card action and keeps what it answered. "Saved" comes ONLY from the action's own success shape
 * (`savedMark`); a refusal shows the action's fixed sentence; anything else shows nothing. A success refreshes the page's
 * server data (the Intake and Matters pages are dynamic), and the mark fades after a moment.
 */
export function useRun(onSaved?: () => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mark, setMark] = useState<SavedMark | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const run = useCallback(
    (act: () => Promise<unknown>) => {
      setMark(null);
      start(async () => {
        let result: unknown;
        try {
          result = await act();
        } catch {
          result = { error: "That didn't go through. Nothing was changed. Refresh to try again." };
        }
        const m = savedMark(result);
        setMark(m);
        if (m.saved) {
          onSaved?.();
          router.refresh();
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setMark(null), 3000);
        }
      });
    },
    [router, onSaved],
  );
  return { pending, mark, run };
}

/** An action that takes (prev, FormData), called with the given fields. */
export function viaForm<S>(action: (prev: S, fd: FormData) => Promise<S>, fields: Record<string, string>) {
  return () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return action({} as S, fd);
  };
}
