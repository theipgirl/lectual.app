/**
 * The third state — "we could not check", which is not "there is nothing here".
 * Rendering `notFound()` on an unreachable database would tell a client the
 * proposal their lawyer sent does not exist. This says the true thing, without
 * naming a cause neither the client nor the firm's receptionist can act on.
 */
export function Unavailable() {
  return (
    <div className="lx-card" style={{ padding: "40px 32px", textAlign: "center", display: "grid", gap: 10 }}>
      <h1 className="lx-h2">We can&rsquo;t load this proposal right now</h1>
      <p className="lx-note" style={{ margin: 0, fontSize: 15 }}>
        Your link is fine — something on our side is not responding. Please try again in a few minutes. Nothing has
        been signed.
      </p>
    </div>
  );
}
