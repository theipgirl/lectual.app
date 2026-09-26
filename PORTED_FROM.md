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
| `src/lib/matters/board.ts` | same path | none (pure; kept for a board view) |
| `src/app/dashboard/matters/{list-utils,labels}.ts` | `src/app/(firm)/dashboard/matters/_components/{list-utils,labels}.ts` | list-utils none; labels drops `MATTER_TYPE_TONE` |
| `src/app/dashboard/matters/[id]/actions.ts` | `src/app/(firm)/dashboard/matters/[id]/actions.ts` + `team-status/actions.ts` (`assignMatterOwnerAction`) | validation and role gates unchanged; errors go through `friendlyMatterError` so no raw database message reaches the screen (**lectual should take this fix**); litigation, voice notes, welcome email and filing follow-up not yet ported |
| `tests/matters/{list-utils,actions}.test.ts` | `tests/matters/matters-page.test.ts` (pure list-utils and mocked role-gating blocks) | retargeted; adds owner, stage-error and LIT-gate cases |
| `src/app/dashboard/calendar/page.tsx` | `src/app/(firm)/dashboard/calendar/page.tsx` | same sources, merge and grouping; re-skinned; marks unconfirmed docket dates |
| `src/app/dashboard/page.tsx` (Today) | `src/app/(firm)/dashboard/page.tsx` (ops home) | same independent reads and "a failed read is never a zero" rule; priority weighting kept (`src/lib/today/priorities.ts`), with stalled matters and unclaimed hot leads in place of stalled leads; reports and the matters copilot not ported |
| `src/app/dashboard/documents/**` | reads `crm_document_draft` (0045) | new list over Document Center's table; the per-firm generators (`document-center/[matterId]/*`, `src/lib/documents/*`) are not ported |
| `src/lib/lawmatics/{client,jsonapi,normalize,import-plan,stage-map,matters-normalize,matters-import-plan}.ts`, `src/lib/intake/referral-source.ts` | same paths | none |
| `src/lib/lawmatics/{import,matters-import}.ts` | same paths | the client comes from the calling firm's own token (`connection.ts`, lectual 0059) instead of `LAWMATICS_TOKEN`; the env readers and `connectionStatus` are gone |
| `src/app/dashboard/settings/integrations/lawmatics/actions.ts` | `src/app/(firm)/dashboard/import/actions.ts` | preview/confirm/fingerprint unchanged; no `lawmatics-import` module gate (the token is per firm); adds connect/disconnect; a 401 marks the connection invalid; coded DB errors don't reach the screen |
| `tests/lawmatics/*`, `tests/__fixtures__/lawmatics.fixture.ts` | same paths | `apply-budget` and `import-actions` mock the firm connection instead of env/module; `pull-source` fixture gains `includeDropped` (was a type error in lectual too) |
| `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `pnpm-workspace.yaml` | same paths | lint ignores `design/` |

New in this repo: `src/lib/lawmatics/connection.ts` and the Lawmatics import UI (`src/components/lawmatics/*`), `src/lib/matters/worklist.ts` (the design's whose-move-is-it bands), `src/lib/mailbox/*` (except the apply port above), `src/lib/nav.ts`, `src/lib/fonts`, `src/components/shell/*`, `src/app/dashboard/*`,
`src/app/globals.css` (design tokens).
