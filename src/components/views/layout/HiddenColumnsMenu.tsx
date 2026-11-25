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
 * owner and only when something is hidden. Showing one is the same layout write as hiding it, for everyone. A List has one layout per
 * section, so the items come in GROUPS (one per layout, each with its own rev); the Board has one.
 */
export type HiddenGroup = { view: ViewKey; rev: number | null; /** Said above the group's items when there is more than one group. */ title?: string; items: readonly { key: string; label: string }[] };

function Group({ group, showTitle, onShown, onError }: { group: HiddenGroup; showTitle: boolean; onShown: () => void; onError: (e: string) => void }) {
  const change = useLayoutChange(group.view, group.rev);
  if (group.items.length === 0) return null;
  return (
    <>
      {showTitle && group.title && (
        <p role="none" className="lx-label cm-group">
          {group.title}
        </p>
      )}
      {group.items.map((c) => (
        <button
          key={c.key}
          type="button"
          role="menuitem"
          className="lp-pop-item"
          disabled={change.pending}
          aria-label={hiddenColumnShowLabel(c.label)}
          onClick={async () => {
            const out = await change.run({ op: "show", key: c.key });
            if (out.ok) onShown();
            else onError(out.error);
          }}
        >
          <span className="lp-pop-text">{c.label}</span>
          <span className="cm-show">{HIDDEN_COLUMN_SHOW}</span>
        </button>
      ))}
    </>
  );
}

export function HiddenColumnsMenu({ groups }: { groups: readonly HiddenGroup[] }) {
  const [error, setError] = useState<string | null>(null);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (total === 0) return null;
  const heading = hiddenColumnsLabel(total);
  const shown = groups.filter((g) => g.items.length > 0);
  return (
    <span className="cm-hidden">
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
        {(close) =>
          shown.map((g) => (
            <Group
              key={g.view}
              group={g}
              showTitle={shown.length > 1}
              onShown={() => {
                setError(null);
                close();
              }}
              onError={setError}
            />
          ))
        }
      </Popover>
      {/* Outside the menu: an error is not a menu item. */}
      <span className="cm-error lx-note" role="alert" aria-live="assertive">
        {error ?? ""}
      </span>
    </span>
  );
}
