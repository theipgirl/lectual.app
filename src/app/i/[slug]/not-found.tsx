import { IntakeNotice } from "./_components/IntakeShell";
import "../intake-public.css";

/**
 * One answer for every kind of nothing: an unknown slug, a malformed one, and
 * a form still in draft all land here and read the same, so the page can't be
 * used to learn which firms have an intake in progress.
 */
export default function IntakeNotFound() {
  return (
    <IntakeNotice
      title="This intake isn't available"
      body="If you followed a link from a firm's website, contact the firm directly and let them know."
    />
  );
}
