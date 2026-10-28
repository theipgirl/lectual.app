import type { ReactNode } from "react";
import { IntegrationHeader } from "./IntegrationHeader";
import type { IntegrationState } from "./states";
import "./integrations.css";

type Props = {
  /** The heading's id, for tests and links. */
  id?: string;
  title: string;
  state: IntegrationState;
  help?: ReactNode;
  icon: ReactNode;
  badge?: ReactNode;
  /** Buttons and links on the right of the header. */
  actions?: ReactNode;
  /** When present the row opens to show it (mailbox lists); without it the row is a plain header. */
  children?: ReactNode;
  defaultOpen?: boolean;
};

/**
 * THE row every integration is drawn with, so Lawmatics, LawPay, Meetings, Google and Microsoft look and
 * behave alike: the service's tile, its title with a status pill, one help line, and its action on the
 * right. A row with a body opens with a chevron; a row without one is just the header.
 */
export function IntegrationRow({ id, title, state, help, icon, badge, actions, children, defaultOpen = false }: Props) {
  const header = <IntegrationHeader id={id} size="row" title={title} state={state} help={help} icon={icon} badge={badge} />;
  if (children) {
    return (
      <details className="lx-int-row" open={defaultOpen}>
        <summary>
          {header}
          {actions ? <span className="lxi-actions">{actions}</span> : null}
          <span className="lx-int-chev" aria-hidden="true">
            ›
          </span>
        </summary>
        <div className="lx-int-body">{children}</div>
      </details>
    );
  }
  return (
    <div className="lx-int-row">
      <div className="lx-int-summary">
        {header}
        {actions ? <span className="lxi-actions">{actions}</span> : null}
      </div>
    </div>
  );
}

/** Small line-icons for the rows that aren't a mail provider. Same 22px tile, same stroke. */
export function RowIcon({ path }: { path: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

export const ROW_ICON = {
  lawmatics: "M4 6h16M4 12h16M4 18h10",
  lawpay: "M3 7h18v10H3zM3 10h18M7 15h3",
  meetings: "M15 10l5-3v10l-5-3zM3 7h12v10H3z",
} as const;
