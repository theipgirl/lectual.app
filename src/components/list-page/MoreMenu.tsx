"use client";

import Link from "next/link";
import Popover from "./Popover";
import { Icon } from "@/components/ui/Icon";
import { MORE_NAME } from "@/lib/ui/words";

/** A link item (Import, Reconcile stages) or an action item (a button that does something, optionally a danger one). */
export type MoreItem =
  | { label: string; href: string }
  | { label: string; onSelect: () => void; tone?: "danger"; disabled?: boolean };

/**
 * "More": the rare actions of a page. A link item is a plain link, so its URL and its role gating stay exactly where the page
 * decided them. An action item is a button. Always labelled "More", always the same secondary button. An empty list draws nothing.
 */
export function MoreMenu({ items, label = MORE_NAME, align = "right" }: { items: readonly MoreItem[]; label?: string; align?: "left" | "right" }) {
  if (items.length === 0) return null;
  return (
    <Popover
      label="More actions"
      align={align}
      width={200}
      trigger={({ onClick, ref, ...aria }) => (
        <button {...aria} ref={ref} type="button" onClick={onClick} className="lx-btn lx-btn-sec lp-more">
          <span className="lp-btn-icon" aria-hidden>
            <Icon name="more" />
          </span>
          <span className="lp-label-long">{label}</span>
          <span className="lp-label-short" aria-hidden>
            {label}
          </span>
          <span aria-hidden className="lp-label-long">
            <Icon name="chevron-down" size={14} />
          </span>
        </button>
      )}
    >
      {(close) =>
        items.map((item) =>
          "href" in item ? (
            <Link key={item.href} href={item.href} role="menuitem" className="lp-pop-item" onClick={close}>
              <span className="lp-pop-text">{item.label}</span>
            </Link>
          ) : (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={`lp-pop-item${item.tone === "danger" ? " lp-pop-item-danger" : ""}`}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              <span className="lp-pop-text">{item.label}</span>
            </button>
          ),
        )
      }
    </Popover>
  );
}
