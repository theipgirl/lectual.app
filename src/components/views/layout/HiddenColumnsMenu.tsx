"use client";

import { useState } from "react";
import Popover from "@/components/list-page/Popover";
import { Icon } from "@/components/ui/Icon";
import type { ViewKey } from "@/lib/views/layout/types";
import { HIDDEN_COLUMN_SHOW, hiddenColumnShowLabel, hiddenColumnsLabel } from "@/lib/ui/words";
import { useLayoutChange } from "./useLayoutChange";
import "./layout-edit.css";

/**
 * The owner's "Hidden columns" control: the columns (or people's lanes) the firm's layout hides, each with Show. Drawn only for an
 * owner and only when something is hidden. Showing one is the same layout write as hiding it, for everyone.
 */
export function HiddenColumnsMenu({ view, rev, items }: { view: ViewKey; rev: number | null; items: readonly { key: string; label: string }[] }) {
  const [error, setError] = useState<string | null>(null);
  const change = useLayoutChange(view, rev);
  if (items.length === 0) return null;
  const heading = hiddenColumnsLabel(items.length);
  return (
    <Popover
      label={heading}
      align="right"
      width={240}
      trigger={({ onClick, ref, ...aria }) => (
        <button {...aria} ref={ref} type="button" onClick={onClick} className="lx-btn lx-btn-sec">
          <span>{heading}</span>
          <Icon name="chevron-down" size={14} />
        </button>
      )}
    >
      {(close) => (
        <>
          {items.map((c) => (
            <button
              key={c.key}
              type="button"
              role="menuitem"
              className="lp-pop-item"
              disabled={change.pending}
              aria-label={hiddenColumnShowLabel(c.label)}
              onClick={async () => {
                setError(null);
                const out = await change.run({ op: "show", key: c.key });
                if (out.ok) close();
                else setError(out.error);
              }}
            >
              <span className="lp-pop-text">{c.label}</span>
              <span className="cm-show">{HIDDEN_COLUMN_SHOW}</span>
            </button>
          ))}
          <p className="cm-error lx-note" role="alert" aria-live="assertive">
            {error ?? ""}
          </p>
        </>
      )}
    </Popover>
  );
}
