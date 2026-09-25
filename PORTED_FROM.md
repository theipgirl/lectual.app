# Ported from `theipgirl/lectual`

Source commit: `610c206` (main, 2026-09-25). Copy, don't import: when a ported file changes in
`lectual`, re-port it here and bump the commit above.

| lectual.app | From lectual | Changes |
|---|---|---|
| `src/lib/db/{admin,scoped-client}.ts` | same paths | none |
| `src/lib/db/types.ts` | same path | copied after lectual's 0057/0058 commit; the three new tables were hand-added there until dev is unpaused and types can be regenerated |
| `src/lib/auth/{roles,actions}.ts` | same paths | none |
| `src/lib/org/modules.ts` | same path | adds modules `mailbox`, `agents` |
| `src/lib/queue/{api,load,org,roles}.ts` | same paths | none |
| `src/lib/firm/session.ts` | same path | per-firm theme read removed (one design system) |
| `src/lib/env.ts` | same path | trimmed to vars this app reads; adds mailbox OAuth, token key, cron secret |
| `src/lib/site-origin.ts`, `src/lib/legal/disclaimer.ts` | same paths | none |
| `src/proxy.ts`, `src/app/auth/callback/route.ts`, `src/app/sign-in/actions.ts` | same paths | none |
| `src/app/sign-in/{page,LoginForm}.tsx` | same paths | restyled to the Lectual design; logic unchanged |
| `tests/roles.test.ts`, `tests/queue/{queue-load,create-draft}.test.ts` | same paths | roles test checks `QUEUE_APPROVE_ROLES` instead of Firm Brain's `CLAIM_REVIEW_ROLES`; the `queueUnavailableCopy` block moves over with the queue page (step 6) |
| `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `pnpm-workspace.yaml` | same paths | lint ignores `design/` |

New in this repo: `src/lib/nav.ts`, `src/lib/fonts`, `src/components/shell/*`, `src/app/dashboard/*`,
`src/app/globals.css` (design tokens).
