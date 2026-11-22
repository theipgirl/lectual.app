/**
 * Which way a client signs on step 3 of `/p/<token>` (Sprint 5a, contract item 8). PURE: the facts are read by `path.ts`.
 *
 * First match wins:
 *  1. (the read itself first closes this proposal's `creating` rows older than 10 minutes: `creation_interrupted`);
 *  2. an open request whose connection is revoked, missing, or whose `connection_id` is null → close it (`cancelled`,
 *     `cancel_failed`), then in-app;
 *  3. an open request and the connection `active` → resume (even with the switch off, so nothing open is stranded);
 *  4. an open request and the connection `reauth` or unreadable → paused: no in-app, no Adobe call;
 *  5. the request read failed → in-app (the database still refuses an in-app signing while a request is open);
 *  6. (a failure on this visit: client state only, in the page);
 *  7. switch off, env unset, no row, revoked, reauth, the connection read failed, or 0113 missing → in-app, no mention of Adobe;
 *  8. active → Adobe.
 */

export type SigningPathKind = "in_app" | "adobe" | "resume" | "paused";

export type OpenRequestFact = { id: string; status: "creating" | "out_for_signature"; connectionId: string | null };

export type PathFacts = {
  setupReady: boolean;
  switchOn: boolean;
  requests: { state: "ok"; open: OpenRequestFact | null } | { state: "not-set-up" } | { state: "unavailable" };
  connection: { state: "ok"; id: string | null; status: "active" | "reauth" | "revoked" | null } | { state: "not-set-up" } | { state: "unavailable" };
};

export type PathDecision = { kind: SigningPathKind; close?: OpenRequestFact };

export function decideSigningPath(f: PathFacts): PathDecision {
  if (f.requests.state !== "ok") return { kind: "in_app" };
  const open = f.requests.open;
  if (open) {
    const conn = f.connection;
    const gone =
      open.connectionId === null ||
      (conn.state === "ok" && (conn.status === null || conn.status === "revoked" || conn.id !== open.connectionId));
    if (gone) return { kind: "in_app", close: open };
    if (conn.state === "ok" && conn.status === "active") return { kind: "resume" };
    return { kind: "paused" };
  }
  if (!f.switchOn || !f.setupReady) return { kind: "in_app" };
  if (f.connection.state !== "ok" || f.connection.status !== "active") return { kind: "in_app" };
  return { kind: "adobe" };
}

/** The page shows the Adobe button for these. */
export function isAdobeKind(kind: SigningPathKind | null | undefined): kind is "adobe" | "resume" {
  return kind === "adobe" || kind === "resume";
}
