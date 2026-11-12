import type { FirmSession } from "@/lib/firm/session";
import { MCP_TOOL_FAILED, MCP_TOOL_REFUSED } from "@/lib/ui/words";

/**
 * Every Claude connector tool call, in order: (token already verified by the route) ->
 * resolveFirmSession is `ok` -> the firm holds `claude-connector` -> the tool's own gate -> the tool.
 * A refusal is ONE fixed sentence; it never says which firms have what. Logging is the tool name,
 * org id, outcome and duration, never arguments or results. Dependencies are passed in so this is
 * testable without a database.
 */
export type OkSession = Extract<FirmSession, { kind: "ok" }>;

export type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

export type GateDeps = {
  resolveSession: () => Promise<FirmSession>;
  hasConnector: () => Promise<boolean>;
  log?: (line: string) => void;
  now?: () => number;
};

export type ToolBody = (session: OkSession) => Promise<{ text: string } | { refused: true }>;

function text(t: string, isError = false): ToolResult {
  return isError ? { content: [{ type: "text", text: t }], isError: true } : { content: [{ type: "text", text: t }] };
}

export async function runGatedTool(tool: string, orgId: string, body: ToolBody, deps: GateDeps): Promise<ToolResult> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.info(line));
  const started = now();
  const finish = (outcome: "ok" | "refused" | "failed", result: ToolResult): ToolResult => {
    log(`[mcp] tool=${tool} org=${orgId} outcome=${outcome} ms=${Math.max(0, now() - started)}`);
    return result;
  };
  try {
    const session = await deps.resolveSession();
    if (session.kind !== "ok") return finish("refused", text(MCP_TOOL_REFUSED, true));
    // The token's claim and the session's firm must agree; RLS reads the same claim, so a mismatch
    // means something is off and nothing is answered.
    if (session.org.id !== orgId) return finish("refused", text(MCP_TOOL_REFUSED, true));
    if (!(await deps.hasConnector())) return finish("refused", text(MCP_TOOL_REFUSED, true));
    const result = await body(session);
    if ("refused" in result) return finish("refused", text(MCP_TOOL_REFUSED, true));
    return finish("ok", text(result.text));
  } catch {
    return finish("failed", text(MCP_TOOL_FAILED, true));
  }
}
