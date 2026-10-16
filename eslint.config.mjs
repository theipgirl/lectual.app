import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Design prototypes — reference HTML, not app source.
    "design/**",
  ]),
  // Security fence: only the admin module may call createClient with the
  // service-role key. Everything else must use getScopedClient() or
  // getAdminClient() — never reach for the raw primitives.
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@supabase/supabase-js",
              importNames: ["createClient"],
              message:
                "Direct createClient is banned outside the admin module. " +
                "Use getAdminClient() (src/lib/db/admin.ts) or getScopedClient() (src/lib/db/scoped-client.ts).",
            },
          ],
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
