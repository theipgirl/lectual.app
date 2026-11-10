"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveViewAction } from "@/lib/account/view-actions";
import { roleLabel } from "@/lib/auth/roles";
import type { ViewMenu } from "@/lib/views";
import "./account-menu.css";
import {
  PREVIEW_A_VIEW,
  TECHNICIAN_VIEW_NAME,
  TECHNICIAN_VIEW_SUB,
  VIEW_CURRENT_PILL,
  VIEW_GROUP_NAME,
  VIEW_NOT_SAVED,
  VIEW_PREVIEW_NOTE,
} from "@/lib/ui/words";

/**
 * The account menu's View group, drawn ONLY for Lectual staff acting inside a firm with role views (viewMenuFor).
 * "Technician view" (the default) and a chip per live view to preview. It saves the staff member's preview for this
 * firm only (saveViewAction keys it by the session's firm), which decides what is drawn; the page is then refreshed.
 */
export function ViewSwitch({ menu, onDone }: { menu: ViewMenu; onDone?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = (value: string) => {
    if (value === menu.pref) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveViewAction(value);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onDone?.();
        router.refresh();
      } catch {
        setError(VIEW_NOT_SAVED);
      }
    });
  };

  const technicianOn = menu.pref === "technician";

  return (
    <div role="group" aria-labelledby="lx-view-h" className="lx-am-menu">
      <div id="lx-view-h" className="lx-am-eyebrow lx-am-sep">
        {VIEW_GROUP_NAME}
      </div>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={technicianOn}
        className="lx-am-item"
        disabled={pending}
        onClick={() => save("technician")}
      >
        <span>{TECHNICIAN_VIEW_NAME}</span>
        {technicianOn ? <span className="lx-am-pill">{VIEW_CURRENT_PILL}</span> : <span className="lx-am-sub">{TECHNICIAN_VIEW_SUB}</span>}
      </button>
      {menu.previewRoles.length > 0 && (
        <>
          <div id="lx-preview-h" className="lx-am-eyebrow lx-am-eyebrow--tight">
            {PREVIEW_A_VIEW}
          </div>
          <div role="group" aria-labelledby="lx-preview-h" className="lx-am-chips">
            {menu.previewRoles.map((r) => (
              <button
                key={r}
                type="button"
                role="menuitemradio"
                aria-checked={menu.pref === `as:${r}`}
                className="lx-am-chip"
                disabled={pending}
                onClick={() => save(`as:${r}`)}
              >
                {roleLabel(r)}
              </button>
            ))}
          </div>
        </>
      )}
      <p className="lx-am-note">{VIEW_PREVIEW_NOTE}</p>
      {error && (
        <p role="alert" className="lx-am-error">
          {error}
        </p>
      )}
    </div>
  );
}
