"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addColumnAction, changeLayoutAction, firmColumnAction } from "@/lib/views/layout/actions";
import type { FirmColumnResult } from "@/lib/views/layout/firm-column";
import type { AddColumnResult } from "@/lib/views/layout/add-column";
import type { LayoutOp, LayoutResult } from "@/lib/views/layout/save";
import { LAYOUT_SAVE_FAILED } from "@/lib/ui/words";
import type { ViewKey } from "@/lib/views/layout/types";

/**
 * The owner's column menu talks to the server through this. It holds the `rev` the view was drawn at and sends it with every change, so
 * a second owner's stale tab is refused ("Someone else changed this view") instead of overwriting. After a change it takes the new rev
 * and refreshes the page, so every control on it draws from the saved layout. It never sends a layout: only the operation.
 */
export function useLayoutChange(view: ViewKey, propRev: number | null) {
  const router = useRouter();
  // The page's rev is the truth: a fresh one (after a refresh) replaces what a change here set.
  const [seen, setSeen] = useState(propRev);
  const [rev, setRev] = useState(propRev);
  if (seen !== propRev) {
    setSeen(propRev);
    setRev(propRev);
  }
  const [pending, setPending] = useState(false);

  async function run(op: LayoutOp): Promise<LayoutResult> {
    setPending(true);
    try {
      const result = await changeLayoutAction(view, op, rev);
      if (result.ok) {
        setRev(result.rev);
        router.refresh();
      }
      return result;
    } catch {
      return { ok: false, error: LAYOUT_SAVE_FAILED };
    } finally {
      setPending(false);
    }
  }

  async function add(input: { relativeTo: string; side: "left" | "right"; label: string; section: string; kind: string; choices: string }): Promise<AddColumnResult> {
    setPending(true);
    try {
      const result = await addColumnAction({ view, rev, ...input });
      if (result.ok) {
        if (result.rev !== null) setRev(result.rev);
        router.refresh();
      }
      return result;
    } catch {
      return { ok: false, error: LAYOUT_SAVE_FAILED };
    } finally {
      setPending(false);
    }
  }

  /** Rename (the field itself), edit the choices of or archive a firm's own column. */
  async function firm(input: { op: "rename" | "options" | "archive"; key: string; label?: string; choices?: string }): Promise<FirmColumnResult> {
    setPending(true);
    try {
      const result = await firmColumnAction(input);
      if (result.ok) router.refresh();
      return result;
    } catch {
      return { ok: false, error: LAYOUT_SAVE_FAILED };
    } finally {
      setPending(false);
    }
  }

  return { run, add, firm, pending };
}
