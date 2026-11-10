"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveViewAction } from "@/lib/account/view-actions";
import { roleLabel } from "@/lib/auth/roles";
import type { ViewMenu } from "@/lib/views";
import "./owner-shell.css";
import { BACK_TO_MY_VIEW, OWNER_VIEW_NAME, PREVIEW_A_VIEW, VIEW_GROUP_NAME, VIEW_NOT_SAVED } from "@/lib/ui/words";


/**
 * The account menu's View group: "Owner view" on/off (auto vs technician) and "Preview a view". It only saves the
 * person's own preference, which decides what is drawn; the page is then refreshed so the shell follows.
 */
export function ViewSwitch({ menu, onDone }: { menu: ViewMenu; onDone?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = (value: string) => {
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

  const previewing = menu.pref.startsWith("as:");

  return (
    <div role="group" aria-labelledby="lx-view-h" style={{ display: "grid", gap: 8 }}>
      <div id="lx-view-h" className="lx-label" style={{ fontSize: 11 }}>
        {VIEW_GROUP_NAME}
      </div>
      {menu.ownViewLive && (
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={menu.ownViewOn}
          className="lx-btn lx-btn-sec lx-btn-sm lx-view-toggle"
          style={{ width: "100%" }}
          disabled={pending}
          onClick={() => save(menu.ownViewOn ? "technician" : "auto")}
        >
          <span>{OWNER_VIEW_NAME}</span>
          <span className="lx-view-state" aria-hidden="true">
            {menu.ownViewOn ? "On" : "Off"}
          </span>
        </button>
      )}
      {menu.previewRoles.length > 0 && (
        <div role="group" aria-label={PREVIEW_A_VIEW} style={{ display: "grid", gap: 6 }}>
          <div className="lx-note" style={{ fontSize: 12.5 }}>
            {PREVIEW_A_VIEW}
          </div>
          {menu.previewRoles.map((r) => (
            <button
              key={r}
              type="button"
              role="menuitemradio"
              aria-checked={menu.pref === `as:${r}`}
              className="lx-btn lx-btn-sec lx-btn-sm"
              style={{ width: "100%" }}
              disabled={pending}
              onClick={() => save(`as:${r}`)}
            >
              {roleLabel(r)}
            </button>
          ))}
        </div>
      )}
      {previewing && (
        <button type="button" role="menuitemradio" aria-checked={false} className="lx-btn lx-btn-ghost lx-btn-sm" style={{ width: "100%" }} disabled={pending} onClick={() => save("auto")}>
          {BACK_TO_MY_VIEW}
        </button>
      )}
      {error && (
        <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
