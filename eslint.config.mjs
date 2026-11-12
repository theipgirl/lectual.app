import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noGluedJsxText from "./eslint-rules/no-glued-jsx-text.mjs";

const CREATE_CLIENT_BAN = {
  name: "@supabase/supabase-js",
  importNames: ["createClient"],
  message:
    "Direct createClient is banned outside the admin module. " +
    "Use getAdminClient() (src/lib/db/admin.ts) or getScopedClient() (src/lib/db/scoped-client.ts).",
};
const MCP_SETTER_MESSAGE =
  "runWithMcpClient is for the Claude connector route only (src/app/api/mcp/**).";
const MCP_SETTER_BAN = {
  name: "@/lib/mcp/request-client",
  importNames: ["runWithMcpClient"],
  message: MCP_SETTER_MESSAGE,
};
const MCP_SETTER_PATTERN = {
  group: ["**/request-client", "**/mcp/request-client"],
  importNames: ["runWithMcpClient"],
  message: MCP_SETTER_MESSAGE,
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Text that renders glued to the value beside it ("…gmail.comis signed in").
  // Includes a Next 16 compiler bug that silently drops a space. See the rule's
  // header and tests/lint/no-glued-jsx-text.test.ts.
  {
    plugins: { lectual: { rules: { "no-glued-jsx-text": noGluedJsxText } } },
    rules: { "lectual/no-glued-jsx-text": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Design prototypes — reference HTML, not app source.
    "design/**",
    // Design harness output (rendered HTML, screenshots, copied CSS).
    "scripts/design-harness/out/**",
  ]),
  // Security fence: only the admin module may call createClient with the
  // service-role key. Everything else must use getScopedClient() or
  // getAdminClient() — never reach for the raw primitives.
  //
  // Second fence: runWithMcpClient (src/lib/mcp/request-client.ts) makes
  // getScopedClient() answer with a token client. Only the Claude connector
  // route (src/app/api/mcp/**) may call it. tests/mcp/hygiene.test.ts repeats
  // both fences as a grep.
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [CREATE_CLIENT_BAN, MCP_SETTER_BAN],
          patterns: [MCP_SETTER_PATTERN],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[property.name='SUPABASE_SERVICE_ROLE_KEY']",
          message:
            "SUPABASE_SERVICE_ROLE_KEY may only be referenced in " +
            "src/lib/db/admin.ts, src/lib/env.ts, or tests/.",
        },
        {
          selector:
            "MemberExpression[property.value='SUPABASE_SERVICE_ROLE_KEY']",
          message:
            "SUPABASE_SERVICE_ROLE_KEY may only be referenced in " +
            "src/lib/db/admin.ts, src/lib/env.ts, or tests/.",
        },
      ],
    },
  },
  // admin.ts is the sanctioned location — lift both bans.
  {
    files: ["src/lib/db/admin.ts"],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-syntax": "off",
    },
  },
  // The Claude connector route is the one place that may set the token client.
  {
    files: ["src/app/api/mcp/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: [CREATE_CLIENT_BAN] }],
    },
  },
  // The connector's token client: createClient with the ANON key and the
  // caller's own Bearer token (never the service role; the
  // SUPABASE_SERVICE_ROLE_KEY ban above still applies here).
  {
    files: ["src/lib/mcp/token-client.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: [MCP_SETTER_BAN], patterns: [MCP_SETTER_PATTERN] }],
    },
  },
  // env.ts parses the raw key once; allow the member-expression access there.
  {
    files: ["src/lib/env.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  // Test helpers seed the DB with service-role directly — lift both bans.
  {
    files: ["tests/**"],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-syntax": "off",
    },
  },
  // Operator CLI scripts run under bare tsx, outside Next.js. They cannot use
  // getAdminClient(): it imports src/lib/env.ts, which imports "server-only",
  // which throws ("cannot be imported from a Client Component module") the
  // moment it is loaded outside a React Server Component graph. Provisioning a
  // tenant is inherently a service-role operation, so — as with tests/ — the
  // ban is lifted here rather than worked around. These files never ship to a
  // browser bundle; they are invoked by hand from a terminal.
  {
    files: ["scripts/**"],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-syntax": "off",
    },
  },
]);

export default eslintConfig;
