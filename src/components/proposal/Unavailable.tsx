import { FirmHeader } from "./FirmHeader";

/**
 * The third state — "we could not check", which is not "there is nothing here".
 * Rendering `notFound()` on an unreachable database would tell a client the
 * proposal their lawyer sent does not exist. This says the true thing, without
 * naming a cause neither the client nor the firm's receptionist can act on.
 */
export function Unavailable() {
  return (
    <>
      <FirmHeader firmName={null} note="Sent to you by link. No account, no login." />
      <div className="qp-locked">
        <div className="qp-locked-mark" aria-hidden="true" />
        <h1>We can&rsquo;t load this proposal right now.</h1>
        <p>Your link is fine — something on our side is not responding. Please try again in a few minutes. Nothing has been signed.</p>
      </div>
    </>
  );
}
