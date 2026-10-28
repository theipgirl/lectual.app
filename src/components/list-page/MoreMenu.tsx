"use client";

import Link from "next/link";
import Popover from "./Popover";

export type MoreItem = { label: string; href: string };

/**
 * "More": the rare actions of a list page (Import, Reconcile stages). Each is a plain link, so its URL
 * and its role gating stay exactly where the page decided them. An empty list draws nothing.
 */
export function MoreMenu({ items }: { items: readonly MoreItem[] }) {
  if (items.length === 0) return null;
  return (
    <Popover
      label="More actions"
      align="right"
      width={200}
      trigger={({ onClick, ref, ...aria }) => (
        <button {...aria} ref={ref} type="button" onClick={onClick} className="lp-btn">
          <span className="lp-btn-icon" aria-hidden>
            ⋯
          </span>
          <span className="lp-label-long">More</span>
          <span className="lp-label-short" aria-hidden>
            More
          </span>
          <span aria-hidden className="lp-label-long">
            ▾
          </span>
        </button>
      )}
    >
      {(close) =>
        items.map((item) => (
          <Link key={item.href} href={item.href} role="menuitem" className="lp-pop-item" onClick={close}>
            <span className="lp-pop-text">{item.label}</span>
          </Link>
        ))
      }
    </Popover>
  );
}
