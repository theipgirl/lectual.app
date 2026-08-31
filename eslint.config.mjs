import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "src/lib/db/types.generated.ts"]),
  {
    rules: {
      // Security fence, mirrored from the main repo: this app has no
      // service-role key and no admin module, so the raw client is banned
      // outright. Every server-side read goes through getScopedClient(),
      // which carries the user's JWT so RLS does the org scoping.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@supabase/supabase-js",
              importNames: ["createClient"],
              message:
                "Direct createClient is banned in lectual.app. Use getScopedClient() (src/lib/db/scoped-client.ts) — RLS scopes every read.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
