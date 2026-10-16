import { IntakeNotice } from "../../i/[slug]/_components/IntakeShell";
import "../../i/intake-public.css";

/**
 * Unknown, malformed, revoked and already-answered links all read the same:
 * a page that told them apart would be an oracle for someone walking tokens.
 */
export default function RequestNotFound() {
  return (
    <IntakeNotice
      title="This link isn't available"
      body="It may have been answered already or withdrawn. If you still need to send answers, ask the firm that sent it for a new link."
    />
  );
}
