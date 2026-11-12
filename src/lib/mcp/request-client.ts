import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

/**
 * THE SEAM for the Claude connector (/api/mcp/). A tool call carries the person's OAuth access token
 * in a header, not a cookie, so the cookie-built client in getScopedClient() would see nobody. The
 * route verifies the token, builds a client that sends it (src/lib/mcp/token-client.ts) and runs the
 * call inside `runWithMcpClient`; getScopedClient() asks `currentMcpClient()` FIRST and returns that
 * client. RLS on the token's active_org_id claim is still what scopes every read and write.
 *
 * Outside that route the store is empty and getScopedClient() behaves exactly as before.
 * `runWithMcpClient` is lint-fenced: only src/app/api/mcp/** may import it (eslint.config.mjs and
 * tests/mcp/hygiene.test.ts).
 */
const store = new AsyncLocalStorage<SupabaseClient<Database>>();

/** The token client for the current tool call, or undefined everywhere else. */
export function currentMcpClient(): SupabaseClient<Database> | undefined {
  return store.getStore();
}

/** Run `fn` with `client` as getScopedClient()'s answer. The /api/mcp/ route only. */
export function runWithMcpClient<T>(client: SupabaseClient<Database>, fn: () => T): T {
  return store.run(client, fn);
}
