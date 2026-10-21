/**
 * Which record the person is looking at when they open the copilot drawer.
 *
 * Pure and client-safe: the launcher parses the pathname to decide what to
 * send, and the server parses the SAME pathname again to decide what to read.
 * The browser's own id is never what the server reads — see
 * @/lib/agents/copilot-context.
 */

export type CopilotContext = { kind: "lead" | "matter"; id: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// /dashboard/leads/<uuid> or /dashboard/matters/<uuid>, optionally followed by a
// trailing slash or a sub-path (a tab). Anything else — a list page, another
// section, an id in the query string — is no context.
const CONTEXT_PATH = new RegExp(`^/dashboard/(leads|matters)/(${UUID})(?:/.*)?$`, "i");

export function parseCopilotContext(pathname: string): CopilotContext | null {
  const match = CONTEXT_PATH.exec(pathname);
  if (!match) return null;
  return { kind: match[1].toLowerCase() === "leads" ? "lead" : "matter", id: match[2].toLowerCase() };
}

/** The copilot page itself (with or without a trailing slash, and any sub-path). */
export function isCopilotPath(pathname: string): boolean {
  return pathname === "/dashboard/copilot" || pathname.startsWith("/dashboard/copilot/");
}

/** What the browser sends for the page it is on: the pathname plus the id it parsed from it. */
export type CopilotContextBody = { pathname: string; leadId?: string; matterId?: string };

export function contextBodyFor(pathname: string): CopilotContextBody {
  const parsed = parseCopilotContext(pathname);
  if (!parsed) return { pathname };
  return parsed.kind === "lead" ? { pathname, leadId: parsed.id } : { pathname, matterId: parsed.id };
}
