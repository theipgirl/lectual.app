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
| `tests/roles.test.ts`, `tests/queue/{queue-load,create-draft}.test.ts` | same paths | roles test checks `QUEUE_APPROVE_ROLES` instead of Firm Brain's `CLAIM_REVIEW_ROLES`; the `queueUnavailableCopy` block now lives in `tests/queue/queue-unavailable.test.ts` (step 6) |
| `src/lib/intake/{email-match,email-threads,initials}.ts`, `src/lib/matters/tracker-import.ts` | same paths | none (pure modules) |
| `tests/intake/email-match.test.ts`, `tests/fixtures/intake/{mail-threads.json,README.md}` | same paths | none |
| `src/lib/mailbox/apply.ts` (write half) | `scripts/sync-intake-email.ts` `applyEvidence()` | same rules (dedupe on message_id, advance-only timestamps, placeholder-only address recovery, one bell per reply); adds matter rows, source `mailbox-sync`, returns counts instead of logging |
| `src/app/dashboard/queue/**`, `src/components/queue/*` | `src/app/(firm)/dashboard/queue/**` | logic and role gates unchanged; re-skinned; approve adds a draft in the approver's own mailbox when the queue has no send channel; Document Center post-approve hook not ported (Document Center isn't in this app yet) |
| `src/lib/{pipeline,matters,automation,members,mentions,notifications,time}/**` | same paths | none — copied as the import closure of `@/lib/pipeline` and `@/lib/matters` |
| `src/app/dashboard/leads/{actions,errors}.ts` | `src/app/(firm)/dashboard/pipeline/{actions,errors}.ts` | paths only |
| `src/app/dashboard/leads/[id]/actions.ts` | `src/app/(firm)/dashboard/leads/[id]/actions.ts` | role gate, assign, move stage, edit, note unchanged; tags, founder link, prep-consult, voice notes not yet ported; adds `reviewProposalAction` |
| `tests/pipeline/*`, `tests/matters/*`, `tests/mentions/*`, `tests/time/*` | same paths | `lead-actions.test.ts` retargeted at the new action paths |
| `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `pnpm-workspace.yaml` | same paths | lint ignores `design/` |

New in this repo: `src/lib/mailbox/*` (except the apply port above), `src/lib/nav.ts`, `src/lib/fonts`, `src/components/shell/*`, `src/app/dashboard/*`,
`src/app/globals.css` (design tokens).
