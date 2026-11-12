import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveFirmSession } from "@/lib/firm/session";
import { orgHasModule } from "@/lib/org/modules";
import { runGatedTool } from "./gate";
import { WHOAMI_FEATURES, whoamiText } from "./whoami";

/**
 * The Claude connector's MCP server: a fresh one per request (stateless), for one verified caller.
 * Tools call src/lib functions only (never "use server" action files) and every call goes through
 * runGatedTool. Phase 0 has one tool, `whoami`. No tool sends, approves, moves a stage or moves money.
 */
export function createLectualMcpServer(orgId: string): McpServer {
  const server = new McpServer({ name: "lectual", version: "0.1.0" });
  const deps = { resolveSession: () => resolveFirmSession(), hasConnector: () => orgHasModule("claude-connector") };

  server.registerTool(
    "whoami",
    {
      title: "Who am I in Lectual",
      description:
        "Shows which law firm in Lectual this connection answers for, your name and role there, and which features are switched on. Reads only; sends nothing.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      runGatedTool(
        "whoami",
        orgId,
        async (session) => {
          const on = await Promise.all(WHOAMI_FEATURES.map((f) => orgHasModule(f.key)));
          return { text: whoamiText(session, WHOAMI_FEATURES.map((f, i) => ({ name: f.name, on: on[i] }))) };
        },
        deps,
      ),
  );

  return server;
}
