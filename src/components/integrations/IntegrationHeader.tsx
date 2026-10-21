import type { ReactNode } from "react";
import { HelpText } from "./HelpText";
import { StatusPill } from "./StatusPill";
import type { IntegrationState } from "./states";
import "./integrations.css";

type Props = {
  /** The heading's id, for the surrounding section's aria-labelledby. */
  id?: string;
  title: string;
  state: IntegrationState;
  /** One line under the title. */
  help?: ReactNode;
  /** A mark for the service, drawn in the same tile everywhere. */
  icon?: ReactNode;
  /** Heading level and size: "card" for the page's cards, "row" for a collapsible row. */
  size?: "card" | "row";
  /** Sits beside the status pill (for example Live/Test). */
  badge?: ReactNode;
  /** Buttons and links on the right of the header. */
  children?: ReactNode;
};

/**
 * One header for every integration card on Integrations and Meetings: the
 * title as a heading, a status pill with its own label, the help line, and
 * the card's actions. Nothing else draws an integration's title or status.
 */
export function IntegrationHeader({ id, title, state, help, icon, size = "card", badge, children }: Props) {
  const Heading = size === "row" ? "h3" : "h2";
  return (
    <div className="lxi-head">
      {icon ? (
        <span className="lx-int-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className="lxi-main">
        <div className="lxi-title-row">
          <Heading id={id} className={size === "row" ? "lxi-title lxi-title-row-size" : "lx-h2 lxi-title"}>
            {title}
          </Heading>
          <StatusPill state={state} />
          {badge}
        </div>
        {help ? <HelpText>{help}</HelpText> : null}
      </div>
      {children ? <div className="lxi-actions">{children}</div> : null}
    </div>
  );
}
